import { readSession } from '../server/authSession.js';
import { authorize } from '../server/authorization.js';
import { getCorporateImport, saveCorporateImport } from '../server/corporateImports.js';
import { parseCorporateImport } from '../shared/corporateImports.js';

type ApiRequest={method?:string;headers?:Record<string,string|string[]|undefined>&{cookie?:string};query?:Record<string,string|string[]>;body?:Record<string,unknown>};
type ApiResponse={status:(code:number)=>ApiResponse;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};
const query=(req:ApiRequest,key:string)=>typeof req.query?.[key]==='string'?(req.query[key] as string).trim():'';
const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T12:00:00Z`));

export const config={maxDuration:60};

export default async function handler(req:ApiRequest,res:ApiResponse){
  res.setHeader?.('Cache-Control','private, no-store');
  try{
    const user=readSession(req.headers?.cookie);
    if(!user)return res.status(401).json({error:'Authentication required'});
    const organizationId=user.organizationId||'org-puerto-vallarta';
    if(!req.method||req.method==='GET'){
      const access=authorize(user,'restaurant365:read');
      if(!access.ok)return res.status(access.status).json({error:access.error});
      const start=query(req,'start'),end=query(req,'end');
      if(Boolean(start)!==Boolean(end)||(start&&(!validDate(start)||!validDate(end)||start>end)))return res.status(400).json({error:'Periodo corporativo inválido.'});
      const data=await getCorporateImport(organizationId,start||undefined,end||undefined);
      return res.status(200).json({...data,canImport:authorize(user,'integrations:manage').ok});
    }
    if(req.method==='POST'){
      const access=authorize(user,'integrations:manage');
      if(!access.ok)return res.status(access.status).json({error:access.error});
      if(!String(req.headers?.['content-type']||'').toLowerCase().startsWith('application/json'))return res.status(415).json({error:'La importación debe enviarse como JSON.'});
      let parsed;
      try{
        if(JSON.stringify(req.body?.data).length>5_000_000)throw new Error('La importación supera el límite de 5 MB.');
        parsed=parseCorporateImport(req.body?.data);
      }catch(error){return res.status(400).json({error:error instanceof Error?error.message:'Archivo corporativo inválido.'});}
      return res.status(200).json(await saveCorporateImport(organizationId,user.id,parsed.sourceFile,parsed.rows));
    }
    res.setHeader?.('Allow','GET, POST');
    return res.status(405).json({error:'Method not allowed'});
  }catch(error){
    console.error('[corporate-import]',error);
    return res.status(503).json({error:error instanceof Error?error.message:'No se pudo guardar la importación corporativa.'});
  }
}
