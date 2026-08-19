import { readSession } from '../../server/authSession';
import { authorize } from '../../server/authorization';
import { createInvitation, listInvitations } from '../../server/accountStore';
import { getManagedUser } from '../../server/managementStore';

type ApiRequest={method?:string;headers?:{cookie?:string;host?:string;'x-forwarded-proto'?:string;origin?:string};body?:{userId?:string}};
type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};

export default async function handler(req:ApiRequest,res:ApiResponse){
  const session=readSession(req.headers?.cookie);
  const auth=authorize(session,'users:manage');
  if(!auth.ok) return res.status(auth.status).json({error:auth.error});
  res.setHeader?.('Cache-Control','private, no-store');
  try{
    if(!req.method||req.method==='GET') return res.status(200).json({invitations:await listInvitations()});
    if(req.method==='POST'){
      const userId=req.body?.userId?.trim();
      if(!userId) return res.status(400).json({error:'userId is required'});
      const user=await getManagedUser(userId);
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
  }catch(error){
    console.error('[OpsVista Invitations]',error instanceof Error?error.message:error);
    return res.status(503).json({error:'Invitation service unavailable'});
  }
}
