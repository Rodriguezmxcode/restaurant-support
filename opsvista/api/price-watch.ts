import { readSession } from '../server/authSession.js';
import { authorize } from '../server/authorization.js';
import { getPriceWatch } from '../server/priceWatch.js';

type Req={method?:string;headers?:Record<string,string|string[]|undefined>&{cookie?:string};query?:Record<string,string|string[]>};
type Res={status:(code:number)=>Res;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};
const q=(req:Req,key:string)=>typeof req.query?.[key]==='string'?(req.query[key] as string).trim():'';
export const config={maxDuration:60};
export default async function handler(req:Req,res:Res){
 res.setHeader?.('Cache-Control','private, no-store');
 try{
  const user=readSession(req.headers?.cookie);if(!user)return res.status(401).json({error:'Authentication required'});
  const access=authorize(user,'restaurant365:read');if(!access.ok)return res.status(access.status).json({error:access.error});
  if(req.method&&req.method!=='GET'){res.setHeader?.('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
  const start=q(req,'start'),end=q(req,'end'),refresh=q(req,'refresh')==='1';if(!start||!end)return res.status(400).json({error:'Selecciona el período de Price Watch.'});
  return res.status(200).json(await getPriceWatch(user.organizationId||'org-puerto-vallarta',start,end,refresh));
 }catch(error){console.error('[price-watch]',error);return res.status(503).json({error:error instanceof Error?error.message:'Price Watch no está disponible.'});}
}
