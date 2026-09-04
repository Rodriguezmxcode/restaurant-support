import { readSession } from '../server/authSession.js';
import { authorize } from '../server/authorization.js';
import { disconnectRestaurant365, saveRestaurant365Credentials } from '../server/integrationStore.js';
import { getRestaurant365Ap, getRestaurant365Catalog, getRestaurant365Ledger, getRestaurant365Status } from '../server/restaurant365OData.js';

type ApiRequest={method?:string;headers?:Record<string,string|string[]|undefined>&{cookie?:string};query?:Record<string,string|string[]>;body?:Record<string,unknown>};
type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};

export const config={maxDuration:120};

const text=(value:unknown)=>typeof value==='string'?value.trim():'';
const query=(req:ApiRequest,key:string)=>typeof req.query?.[key]==='string'?(req.query[key] as string).trim():'';

export default async function handler(req:ApiRequest,res:ApiResponse){
  const requestId=`r365-${Date.now().toString(36)}`;
  res.setHeader?.('X-OpsVista-R365-Version','r365-api-v8');
  res.setHeader?.('X-OpsVista-Request-Id',requestId);
  res.setHeader?.('Cache-Control','private, no-store');
  try{
    const user=readSession(req.headers?.cookie);
    if(!user)return res.status(401).json({error:'Authentication required',requestId});
    const organizationId=user.organizationId||'org-puerto-vallarta';

    if(!req.method||req.method==='GET'){
      const permission=authorize(user,'restaurant365:read');
      if(!permission.ok)return res.status(permission.status).json({error:permission.error,requestId});
      const view=query(req,'view');
      if(!view)return res.status(200).json(await getRestaurant365Status(organizationId));
      const start=query(req,'start'),end=query(req,'end'),month=query(req,'month')||'2026-08';
      if(Boolean(start)!==Boolean(end))return res.status(400).json({error:'Selecciona una fecha inicial y final para Restaurant365.',requestId});
      if(view==='ledger')return res.status(200).json(await getRestaurant365Ledger(organizationId,start||month,query(req,'entity')||'Corporate Office',start?end:undefined));
      if(view==='ap')return res.status(200).json(await getRestaurant365Ap(organizationId,start||month,start?end:undefined));
      if(view==='vendors'||view==='accounts')return res.status(200).json(await getRestaurant365Catalog(organizationId,view));
      return res.status(400).json({error:'Vista de Restaurant365 desconocida.',requestId});
    }

    if(req.method==='POST'){
      const permission=authorize(user,'integrations:manage');
      if(!permission.ok)return res.status(permission.status).json({error:permission.error,requestId});
      const action=text(req.body?.action);
      if(action==='save'){
        const domain=text(req.body?.domain),username=text(req.body?.username),password=typeof req.body?.password==='string'?req.body.password:'';
        if(!/^[a-zA-Z0-9._-]{2,100}$/.test(domain))return res.status(400).json({error:'Escribe el dominio de Restaurant365 sin https://, barras ni espacios.',requestId});
        if(!username||username.length>160||password.length<8)return res.status(400).json({error:'Dominio, usuario y contraseña válida son obligatorios.',requestId});
        await saveRestaurant365Credentials(organizationId,domain,username,password);
        const status=await getRestaurant365Status(organizationId);
        return res.status(status.connected?200:422).json(status.connected?status:{...status,error:status.error||'Las credenciales se guardaron, pero Restaurant365 no aceptó la conexión.',requestId});
      }
      if(action==='test')return res.status(200).json(await getRestaurant365Status(organizationId));
      if(action==='disconnect'){await disconnectRestaurant365(organizationId);return res.status(200).json({disconnected:true});}
      return res.status(400).json({error:'Acción de Restaurant365 desconocida.',requestId});
    }

    res.setHeader?.('Allow','GET, POST');
    return res.status(405).json({error:'Method not allowed',requestId});
  }catch(error){
    const message=error instanceof Error?error.message:'Restaurant365 no está disponible.';
    console.error('[restaurant365]',requestId,message);
    return res.status(503).json({error:message,source:'restaurant365-odata',requestId});
  }
}
