import { authenticateUser, issueSession, sessionCookie } from '../../server/authSession';
import { bootstrapFounderCredential, founderBootstrapAvailable } from '../../server/accountStore';

type ApiRequest = { method?: string; body?: { email?: string; password?: string; bootstrapSecret?: string } };
type ApiResponse = { status:(code:number)=>ApiResponse; json:(body:unknown)=>void; setHeader?:(name:string,value:string)=>void };

export default async function handler(req:ApiRequest,res:ApiResponse) {
  res.setHeader?.('Cache-Control','no-store');
  try {
    if (!req.method || req.method==='GET') {
      return res.status(200).json({ available: await founderBootstrapAvailable() });
    }
    if (req.method!=='POST') {
      res.setHeader?.('Allow','GET, POST');
      return res.status(405).json({ error:'Method not allowed' });
    }
    const email=req.body?.email?.trim() || '';
    const password=req.body?.password || '';
    const bootstrapSecret=req.body?.bootstrapSecret || '';
    if (!email || !password || !bootstrapSecret) return res.status(400).json({ error:'Email, bootstrap code and password are required' });
    await bootstrapFounderCredential(email,password,bootstrapSecret);
    const user=await authenticateUser(email,password);
    if (!user || user.role!=='Founder') return res.status(500).json({ error:'Founder credential created but session could not be established' });
    const token=issueSession(user);
    res.setHeader?.('Set-Cookie',sessionCookie(token));
    return res.status(200).json({ ok:true, user });
  } catch (error) {
    const message=error instanceof Error?error.message:'Founder bootstrap failed';
    const conflict=message.includes('already been completed');
    const unauthorized=message.includes('Invalid Founder bootstrap code') || message.includes('does not match');
    return res.status(conflict?409:unauthorized?403:400).json({ error:message });
  }
}
