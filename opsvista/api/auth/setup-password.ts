import { acceptInvitation } from '../../server/accountStore.js';

type ApiRequest={method?:string;body?:{token?:string;password?:string}};
type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};

export default async function handler(req:ApiRequest,res:ApiResponse){
  if(req.method!=='POST'){
    res.setHeader?.('Allow','POST');
    return res.status(405).json({error:'Method not allowed'});
  }
  try{
    const token=req.body?.token?.trim();
    const password=req.body?.password??'';
    if(!token) return res.status(400).json({error:'Invitation token is required'});
    if(password.length<12) return res.status(400).json({error:'Password must be at least 12 characters'});
    const user=await acceptInvitation(token,password);
    return res.status(200).json({ok:true,user:{id:user.id,name:user.name,email:user.email}});
  }catch(error){
    const message=error instanceof Error?error.message:'Unable to set password';
    const status=/expired|invalid|used|mismatch|active/i.test(message)?400:503;
    return res.status(status).json({error:message});
  }
}
