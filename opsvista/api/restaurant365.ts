import { beverageLocations, validBeverageRange } from '../shared/beverageMetrics.js';
import { getBeverageSource } from '../server/beverageSource.js';
import { getBeverageScore, visibleBeverageScore } from '../server/beverageScore.js';
import { readSession } from '../server/authSession.js';
import { authorize } from '../server/authorization.js';
import { disconnectRestaurant365, saveRestaurant365Credentials, getIntegrationSnapshot } from '../server/integrationStore.js';
import { cachedSource } from '../server/sourceCache.js';
import { loadSource } from '../server/sourceLoaders.js';
import { authorizedSourceSync } from '../server/sourceSyncAuth.js';
import { getSourceSyncStatus, runSourceSync } from '../server/sourceSync.js';
import { requestedPeriod, getRestaurant365Status } from '../server/restaurant365OData.js';
import { parseProviImport } from '../shared/proviReports.js';
import { getProviReports, saveProviReports } from '../server/proviReports.js';
import { extractProviEvidence } from '../server/proviDocumentExtraction.js';
import { getProviEvidence, saveProviEvidence } from '../server/proviEvidence.js';
import { getPriceWatch } from '../server/priceWatch.js';

type ApiRequest={method?:string;headers?:Record<string,string|string[]|undefined>&{cookie?:string};query?:Record<string,string|string[]>;body?:Record<string,unknown>};
type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};

export const config={maxDuration:120};

const text=(value:unknown)=>typeof value==='string'?value.trim():'';
const query=(req:ApiRequest,key:string)=>typeof req.query?.[key]==='string'?(req.query[key] as string).trim():'';

export default async function handler(req:ApiRequest,res:ApiResponse){
  const requestId=`r365-${Date.now().toString(36)}`;
  res.setHeader?.('X-OpsVista-R365-Version','r365-persistent-v1');
  res.setHeader?.('X-OpsVista-Request-Id',requestId);
  res.setHeader?.('Cache-Control','private, no-store');
  try{
    if (query(req,'view') === 'sync' && req.method === 'POST') {
      if (!await authorizedSourceSync(req.headers?.authorization)) return res.status(401).json({ error:'Unauthorized' });
      const result = await runSourceSync('org-puerto-vallarta', true);
      return res.status(200).json(result || { ok:true, busy:true, remaining:0 });
    }
    const user=readSession(req.headers?.cookie);
    if(!user)return res.status(401).json({error:'Authentication required',requestId});
    const organizationId=user.organizationId||'org-puerto-vallarta';

    if(!req.method||req.method==='GET'){
      if(query(req,'view')==='beverage-score') {
        const access=authorize(user,'bonus:read');
        if(!access.ok)return res.status(access.status).json({error:access.error,requestId});
        const start=query(req,'start'),end=query(req,'end');
        if(!validBeverageRange(start,end,31))return res.status(400).json({error:'Selecciona un período válido de hasta 31 días.',requestId});
        const score=await getBeverageScore(organizationId,start,end);
        return res.status(200).json(visibleBeverageScore(score,user));
      }
      const permission=authorize(user,'restaurant365:read');
      if(!permission.ok)return res.status(permission.status).json({error:permission.error,requestId});
      const view=query(req,'view');
      if(view==='provi')return res.status(200).json({
        reports:await getProviReports(organizationId),
        evidence:await getProviEvidence(organizationId),
        canImport:authorize(user,'integrations:manage').ok,
        pdfTextExtractionReady:true,
        visualExtractionConfigured:Boolean(process.env.OPENAI_API_KEY),
        documentExtractionReady:true,
      });
      if(view==='sync-status') return res.status(200).json(await getSourceSyncStatus(organizationId));
      if(!view)return res.status(200).json(await getRestaurant365Status(organizationId));
      const start=query(req,'start'),end=query(req,'end'),month=query(req,'month')||'2026-08';
      if(Boolean(start)!==Boolean(end))return res.status(400).json({error:'Selecciona una fecha inicial y final para Restaurant365.',requestId});
      if(view==='price-watch') return res.status(200).json(await getPriceWatch(organizationId,start,end,query(req,'refresh')==='1'));
      if(view==='beverage') {
        const entity=query(req,'entity');
        if(!validBeverageRange(start,end)||!beverageLocations.includes(entity)) return res.status(400).json({error:'Selecciona una locación y un periodo válido de hasta siete días.',requestId});
        return res.status(200).json(await getBeverageSource(organizationId,entity,start,end,query(req,'refresh')==='1'));
      }
      if(['ledger','ap','vendors','accounts'].includes(view)) {
        if(view==='ledger'||view==='ap') {
          requestedPeriod(start||month,start?end:undefined);
          if(view==='ledger' && ![...beverageLocations,'Corporate Office'].includes(query(req,'entity')||'Corporate Office')) return res.status(400).json({error:'Locación no válida',requestId});
        }
        const provider = view==='ledger' ? 'r365-ledger' : view==='ap' ? 'r365-ap' : 'r365-catalog';
        const params = view==='vendors'||view==='accounts' ? {kind:view as 'vendors'|'accounts'} : {start:start||month,end:start?end:undefined,...(view==='ledger'?{location:query(req,'entity')||'Corporate Office'}:{})};
        const seed = async () => {
          if(view!=='ap')return null;
          const first=start||`${month}-01`;
          const until=start ? new Date(Date.parse(end)+86400000).toISOString().slice(0,10) : new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10);
          const prior=await getIntegrationSnapshot<any>(organizationId,'restaurant365-odata',`ap:${first}:${until}`);
          return prior ? {payload:prior.payload,updatedAt:prior.payload.fetchedAt||prior.updatedAt} : null;
        };
        const result=await cachedSource<any>(organizationId,provider,params,loadSource,query(req,'refresh')==='1',seed);
        if(!result.data)return res.status(503).json({error:result.memory.error||'Primera sincronización en curso',memory:result.memory,requestId});
        return res.status(200).json({...result.data,memory:result.memory,caveats:[...(result.data.caveats||[]),result.memory.pending?'Actualización pendiente; se muestra la última copia guardada en OpsVista.':'Datos guardados en OpsVista; no fue necesario volver a descargarlos.']});
      }
      return res.status(400).json({error:'Vista de Restaurant365 desconocida.',requestId});
    }

    if(req.method==='POST'){
      const permission=authorize(user,'integrations:manage');
      if(!permission.ok)return res.status(permission.status).json({error:permission.error,requestId});
      const action=text(req.body?.action);
      if(action==='extract-provi-evidence'){
        try{return res.status(200).json(await extractProviEvidence(req.body?.files));}
        catch(error){
          const message=error instanceof Error?error.message:'No se pudo leer la evidencia.';
          const paymentRequired=/créditos|credits|quota|billing/i.test(message);
          return res.status(paymentRequired?402:400).json({error:message});
        }
      }
      if(action==='save-provi-evidence'){
        try{return res.status(200).json(await saveProviEvidence(organizationId,user.id,req.body?.files,req.body?.purchases));}
        catch(error){return res.status(400).json({error:error instanceof Error?error.message:'No se pudo guardar la evidencia.'});}
      }
      if(action==='import-provi'){
        if(!String(req.headers?.['content-type']||'').toLowerCase().startsWith('application/json'))return res.status(415).json({error:'Usa un archivo de importación válido.'});
        let reports;
        try{
          if(JSON.stringify(req.body?.data).length>2_000_000)throw new Error('El archivo excede el tamaño máximo de 2 MB.');
          reports=parseProviImport(req.body?.data);
        }catch(error){return res.status(400).json({error:error instanceof Error?error.message:'Archivo inválido.'});}
        return res.status(200).json(await saveProviReports(organizationId,user.id,reports));
      }
      if(action==='sync-now')return res.status(200).json(await runSourceSync(organizationId));
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
