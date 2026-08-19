import { bootstrapFounderCredential } from '../../server/accountStore.js';
import { authenticateUser, issueSession, sessionCookie } from '../../server/authSession.js';

type ApiRequest={method?:string;body?:{email?:string;password?:string;bootstrapSecret?:string}};
type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};

export default async function handler(req:ApiRequest,res:ApiResponse){
  if(req.method!=='POST'){res.setHeader?.('Allow','POST');return res.status(405).json({error:'Method not allowed'});}
  const email=req.body?.email?.trim()||'',password=req.body?.password||'',bootstrapSecret=req.body?.bootstrapSecret||'';
  if(!email||!password||!bootstrapSecret)return res.status(400).json({error:'Founder email, new password and bootstrap code are required'});
  try{
    await bootstrapFounderCredential(email,password,bootstrapSecret);
    const user=await authenticateUser(email,password);
    if(!user)return res.status(500).json({error:'Founder credential was saved but the session could not be created'});
    res.setHeader?.('Set-Cookie',sessionCookie(issueSession(user)));
    res.setHeader?.('Cache-Control','no-store');
    return res.status(200).json({user});
  }catch(error){
    const message=error instanceof Error?error.message:'Unable to recover Founder access';
    return res.status(/invalid|match|required/i.test(message)?403:500).json({error:message});
  }
}
