import {readSession} from '../../server/authSession.js';
import {getSevenShiftsTaskCompliance} from '../../server/sevenShiftsTasks.js';

type Req={method?:string;query?:Record<string,string|string[]>;headers?:{cookie?:string}};
type Res={status:(code:number)=>Res;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};
const one=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value||'';

export default async function handler(req:Req,res:Res){
  if(req.method!=='GET'){res.setHeader?.('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
  if(!readSession(req.headers?.cookie))return res.status(401).json({error:'Authentication required'});
  const start=one(req.query?.start),end=one(req.query?.end);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return res.status(400).json({error:'start and end must use YYYY-MM-DD'});
  try{return res.status(200).json(await getSevenShiftsTaskCompliance(start,end));}
  catch(error){const message=error instanceof Error?error.message:'7shifts data unavailable';return res.status(502).json({error:message});}
}
