import { readSession } from '../server/authSession.js';
import { getLocalIntelligence, localIntelligenceHorizons, localIntelligenceLocationNames, localIntelligenceRadii, type LocalIntelligenceHorizonKey, type LocalIntelligenceRadiusMiles } from '../server/localIntelligence.js';

type ApiRequest={method?:string;headers?:{cookie?:string};query?:Record<string,string|string[]>};
type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};
const query=(req:ApiRequest,key:string)=>typeof req.query?.[key]==='string'?(req.query[key] as string).trim():'';

export default async function handler(req:ApiRequest,res:ApiResponse){
  res.setHeader?.('X-OpsVista-Local-Version','local-api-v2');
  if(req.method&&req.method!=='GET'){res.setHeader?.('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
  const user=readSession(req.headers?.cookie);
  if(!user)return res.status(401).json({error:'Authentication required'});
  try{
    const requested=query(req,'location');
    const horizonKey=(query(req,'horizon')||'next_14') as LocalIntelligenceHorizonKey;
    if(!(horizonKey in localIntelligenceHorizons))return res.status(400).json({error:'Unknown Local Intelligence period'});
    const radiusMiles=Number(query(req,'radius')||'5') as LocalIntelligenceRadiusMiles;
    if(!localIntelligenceRadii.includes(radiusMiles))return res.status(400).json({error:'Local Intelligence radius must be 5, 10, 15 or 20 miles'});
    const unrestricted=['Founder','Corporate','HR','Administration','Maintenance'].includes(user.role);
    const selected=requested&&requested!=='All locations'?[requested]:unrestricted?undefined:user.locations;
    if(selected?.some(location=>!localIntelligenceLocationNames.includes(location)))return res.status(400).json({error:'Unknown location'});
    if(!unrestricted&&selected?.some(location=>!user.locations.includes(location)))return res.status(403).json({error:'Location outside your access scope'});
    const payload=await getLocalIntelligence(selected,localIntelligenceHorizons[horizonKey],radiusMiles);
    res.setHeader?.('Cache-Control','private, max-age=60, stale-while-revalidate=120');
    return res.status(200).json(payload);
  }catch(error){
    const message=error instanceof Error?error.message:'Local Intelligence unavailable';
    console.error('[local-intelligence]',message);
    return res.status(502).json({error:message,source:'local-intelligence'});
  }
}
