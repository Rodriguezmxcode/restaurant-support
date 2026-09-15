import { readSession, type ServerRole, type SessionUser } from '../../server/authSession.js';
import { authorize } from '../../server/authorization.js';
import { createInvitation, listInvitations } from '../../server/accountStore.js';
import { getManagedUser, listManagedUsers, saveManagedUser, type ManagedDirectoryUser, type StoredAuditEvent } from '../../server/managementStore.js';
import { getOrganizationMembership } from '../../server/organizationStore.js';
import { hasLegacyWorkspace } from '../../shared/tenantAccess.js';
import { authorizationUrl, createOAuthState, exchangeAuthorizationCode, googleBusinessRedirectUri, publicOrigin, verifyOAuthState } from '../../server/googleBusinessOAuth.js';
import { disconnectGoogleBusiness, getGoogleBusinessCredentials, saveGoogleBusinessAuthorization, saveGoogleBusinessClient } from '../../server/integrationStore.js';

type ApiRequest = {
  method?: string;
  query?: Record<string,string|string[]>;
  headers?: Record<string,string|string[]|undefined> & { cookie?: string; host?: string; 'x-forwarded-proto'?: string; 'x-forwarded-host'?: string; origin?: string };
  body?: Record<string,unknown> & { user?: ManagedDirectoryUser; events?: StoredAuditEvent[]; userId?: string };
};

type ApiResponse = {
  status: (code:number) => ApiResponse;
  json: (body:unknown) => void;
  setHeader?: (name:string,value:string) => void;
  end?: () => void;
};

const roles: ServerRole[] = ['Founder','Corporate','Location Manager','Kitchen','HR','Administration','Maintenance'];
const queryValue=(req:ApiRequest,key:string)=>typeof req.query?.[key]==='string'?(req.query[key] as string).trim():'';
const text=(value:unknown)=>typeof value==='string'?value.trim():'';
const userOrganization=(user:SessionUser)=>user.organizationId||'org-puerto-vallarta';

async function invitations(req:ApiRequest,res:ApiResponse,auth:ReturnType<typeof authorize> & {ok:true}) {
  if(!req.method||req.method==='GET') {
    const allowed=new Set((await listManagedUsers()).map(user=>user.id));
    return res.status(200).json({invitations:(await listInvitations()).filter(invitation=>allowed.has(invitation.userId))});
  }
  if(req.method==='POST'){
    const userId=req.body?.userId?.trim();
    if(!userId) return res.status(400).json({error:'userId is required'});
    const user=await getManagedUser(userId);
    if(user && auth.user.role!=='Founder' && (await getOrganizationMembership(user.id))?.organizationId!==auth.user.organizationId) return res.status(404).json({error:'User not found'});
    if(!user||!user.email) return res.status(404).json({error:'User with email not found'});
    if(!user.active) return res.status(400).json({error:'Cannot invite an inactive user'});
    if(user.role==='Founder'&&auth.user.role!=='Founder') return res.status(403).json({error:'Founder invitations require Founder access'});
    const invitation=await createInvitation(user.id,user.email,auth.user.id);
    const base=process.env.OPSVISTA_APP_URL || req.headers?.origin || `${req.headers?.['x-forwarded-proto']||'https'}://${req.headers?.host||''}`;
    const inviteUrl=`${String(base).replace(/\/$/,'')}/?invite=${encodeURIComponent(invitation.token)}`;
    return res.status(201).json({invitation:{id:invitation.id,userId:user.id,email:user.email,expiresAt:invitation.expiresAt,inviteUrl,delivery:'manual-link'}});
  }
  res.setHeader?.('Allow','GET, POST');
  return res.status(405).json({error:'Method not allowed'});
}

async function googleBusinessIntegration(req:ApiRequest,res:ApiResponse,user:SessionUser){
  const permission=authorize(user,'integrations:manage');
  if(!permission.ok)return res.status(permission.status).json({error:permission.error});
  const organizationId=userOrganization(user);
  const platformClientId=process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_ID?.trim()||'';
  const platformClientSecret=process.env.GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET?.trim()||'';
  const platformManaged=Boolean(platformClientId&&platformClientSecret);
  let saved=await getGoogleBusinessCredentials(organizationId);
  const redirectUri=googleBusinessRedirectUri(req.headers||{});

  if(!req.method||req.method==='GET'){
    if(queryValue(req,'action')==='authorize'){
      if((!saved?.clientId||!saved.clientSecret)&&platformManaged){
        await saveGoogleBusinessClient(organizationId,platformClientId,platformClientSecret);
        saved=await getGoogleBusinessCredentials(organizationId);
      }
      if(!saved?.clientId||!saved.clientSecret)return res.status(400).json({error:'Google OAuth client is not configured for OpsVista'});
      if(!res.setHeader||!res.end)return res.status(500).json({error:'Google redirect is unavailable'});
      res.setHeader('Location',authorizationUrl(saved,redirectUri,createOAuthState(organizationId,user.id)));
      res.status(302).end();
      return;
    }
    return res.status(200).json({provider:'google-business-profile',configured:Boolean((saved?.clientId&&saved.clientSecret)||platformManaged),connected:Boolean(saved?.refreshToken),clientId:saved?.clientId||platformClientId,connectedEmail:saved?.connectedEmail,connectedAt:saved?.connectedAt,redirectUri,platformManaged});
  }

  if(req.method==='POST'){
    const action=text(req.body?.action);
    if(action==='save'){
      if(!hasLegacyWorkspace(user))return res.status(403).json({error:'Google OAuth client configuration is managed by OpsVista for customer organizations'});
      const clientId=text(req.body?.clientId),clientSecret=text(req.body?.clientSecret);
      if(!clientId.endsWith('.apps.googleusercontent.com')||!clientSecret.startsWith('GOCSPX-'))return res.status(400).json({error:'A valid Google OAuth Client ID and Client Secret are required'});
      await saveGoogleBusinessClient(organizationId,clientId,clientSecret);
      return res.status(200).json({saved:true});
    }
    if(action==='disconnect'){
      await disconnectGoogleBusiness(organizationId);
      return res.status(200).json({disconnected:true});
    }
    return res.status(400).json({error:'Unknown integration action'});
  }
  res.setHeader?.('Allow','GET, POST');
  return res.status(405).json({error:'Method not allowed'});
}

async function googleBusinessCallback(req:ApiRequest,res:ApiResponse,user:SessionUser){
  const permission=authorize(user,'integrations:manage');
  if(!permission.ok)return res.status(permission.status).json({error:permission.error});
  const origin=publicOrigin(req.headers||{});
  const redirect=(status:'connected'|'error',message?:string)=>{
    if(!res.setHeader||!res.end)throw new Error('Google callback redirect is unavailable');
    const suffix=message?`&message=${encodeURIComponent(message)}`:'';
    res.setHeader('Location',`${origin}/?integration=google-business&status=${status}${suffix}`);
    res.status(302).end();
  };
  try{
    const providerError=queryValue(req,'error');
    if(providerError)throw new Error(queryValue(req,'error_description')||providerError);
    const state=verifyOAuthState(queryValue(req,'state'));
    if(state.userId!==user.id)throw new Error('Google authorization belongs to a different OpsVista session');
    const credential=await getGoogleBusinessCredentials(state.organizationId);
    if(!credential)throw new Error('Google OAuth client is not saved in OpsVista');
    const result=await exchangeAuthorizationCode(credential,queryValue(req,'code'),googleBusinessRedirectUri(req.headers||{}));
    await saveGoogleBusinessAuthorization(state.organizationId,result.refreshToken,result.email);
    redirect('connected');
    return;
  }catch(error){
    redirect('error',error instanceof Error?error.message:'Google authorization failed');
    return;
  }
}

export default async function handler(req:ApiRequest,res:ApiResponse) {
  const session = readSession(req.headers?.cookie);
  if(!session)return res.status(401).json({error:'Authentication required'});
  const resource=queryValue(req,'resource');
  if(resource==='google_business_integration')return await googleBusinessIntegration(req,res,session);
  if(resource==='google_business_callback')return await googleBusinessCallback(req,res,session);

  const auth = authorize(session,'users:manage');
  if (!auth.ok) return res.status(auth.status).json({ error:auth.error });
  res.setHeader?.('Cache-Control','private, no-store');

  try {
    if(queryValue(req,'view')==='invitations') return await invitations(req,res,auth);
    if (!req.method || req.method === 'GET') {
      return res.status(200).json({ users:await listManagedUsers() });
    }
    if (req.method === 'PUT') {
      const user = req.body?.user;
      const events = req.body?.events ?? [];
      if (!user?.id || !user.name || !roles.includes(user.role)) return res.status(400).json({ error:'Valid user payload required' });
      if (user.email && !/^\S+@\S+\.\S+$/.test(user.email)) return res.status(400).json({ error:'Valid email required' });
      if (!events.length || events.some(event => !event.reason?.trim())) return res.status(400).json({ error:'At least one audited change with management reason is required' });
      if (events.some(event => event.targetUserId !== user.id)) return res.status(400).json({ error:'Audit target must match edited user' });

      const existing = await getManagedUser(user.id);
      if (existing && auth.user.role !== 'Founder' && (await getOrganizationMembership(existing.id))?.organizationId !== auth.user.organizationId) return res.status(404).json({error:'User not found'});
      const actorIsFounder = auth.user.role === 'Founder';
      if (existing?.role === 'Founder' && !actorIsFounder) return res.status(403).json({ error:'Founder accounts can only be managed by a Founder' });
      if (user.role === 'Founder' && !actorIsFounder) return res.status(403).json({ error:'Only a Founder can assign Founder access' });
      if (auth.user.id === user.id && existing?.role === 'Founder' && (!user.active || user.role !== 'Founder')) {
        return res.status(400).json({ error:'A Founder cannot deactivate or remove their own Founder access' });
      }

      await saveManagedUser(user,events,auth.user);
      return res.status(200).json({ user });
    }
    res.setHeader?.('Allow','GET, PUT');
    return res.status(405).json({ error:'Method not allowed' });
  } catch (error) {
    console.error('[OpsVista Management Users]', error instanceof Error ? error.message : error);
    return res.status(503).json({ error:queryValue(req,'view')==='invitations'?'Invitation service unavailable':'Central management store unavailable' });
  }
}
