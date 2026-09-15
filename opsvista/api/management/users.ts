import { readSession, type ServerRole } from '../../server/authSession.js';
import { authorize } from '../../server/authorization.js';
import { createInvitation, listInvitations } from '../../server/accountStore.js';
import { getManagedUser, listManagedUsers, saveManagedUser, type ManagedDirectoryUser, type StoredAuditEvent } from '../../server/managementStore.js';
import { getOrganizationMembership } from '../../server/organizationStore.js';

type ApiRequest = {
  method?: string;
  query?: Record<string,string|string[]>;
  headers?: { cookie?: string; host?: string; 'x-forwarded-proto'?: string; origin?: string };
  body?: { user?: ManagedDirectoryUser; events?: StoredAuditEvent[]; userId?: string };
};

type ApiResponse = {
  status: (code:number) => ApiResponse;
  json: (body:unknown) => void;
  setHeader?: (name:string,value:string) => void;
};

const roles: ServerRole[] = ['Founder','Corporate','Location Manager','Kitchen','HR','Administration','Maintenance'];
const queryValue=(req:ApiRequest,key:string)=>typeof req.query?.[key]==='string'?(req.query[key] as string).trim():'';

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

export default async function handler(req:ApiRequest,res:ApiResponse) {
  const session = readSession(req.headers?.cookie);
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
