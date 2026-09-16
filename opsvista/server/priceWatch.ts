import { getRestaurant365Credentials, getIntegrationSnapshot, saveIntegrationSnapshot, type Restaurant365Credentials } from './integrationStore.js';
import { analyzePriceWatch, classifyPriceWatchItem, type PriceWatchLine, type PriceWatchResponse } from '../shared/priceWatch.js';

type Row=Record<string,unknown>;
const baseUrl=()=> (process.env.RESTAURANT365_ODATA_BASE_URL?.trim()||'https://odata.restaurant365.net/api/v2/views').replace(/\/$/,'');
const pick=(row:Row,names:string[])=>{for(const name of names){const entry=Object.entries(row).find(([key])=>key.toLowerCase()===name.toLowerCase());if(entry&&entry[1]!==undefined&&entry[1]!==null&&String(entry[1]).trim()!=='')return entry[1];}return undefined;};
const text=(row:Row,names:string[])=>{const v=pick(row,names);return v===undefined?'':String(v).trim();};
const num=(row:Row,names:string[])=>{const v=pick(row,names);if(typeof v==='number'&&Number.isFinite(v))return v;const n=Number(String(v??'').replace(/[$,()]/g,''));return Number.isFinite(n)?n:null;};
const bool=(row:Row,names:string[])=>{const v=pick(row,names);return v===true||v===1||['true','1','yes'].includes(String(v).toLowerCase());};
const id=(row:Row)=>text(row,['transactionId','id']).toLowerCase();
const validDate=(value:string)=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(`${value}T12:00:00Z`));
const days=(start:string,end:string)=>Math.floor((Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86400000)+1;
async function credentials(organizationId:string){const stored=await getRestaurant365Credentials(organizationId);if(stored)return stored;const domain=process.env.RESTAURANT365_DOMAIN?.trim(),username=process.env.RESTAURANT365_USERNAME?.trim(),password=process.env.RESTAURANT365_PASSWORD;if(domain&&username&&password)return{domain,username,password} as Restaurant365Credentials;throw new Error('Restaurant365 no está conectado.');}
function rows(payload:unknown):Row[]{if(Array.isArray(payload))return payload.filter(v=>v&&typeof v==='object') as Row[];if(payload&&typeof payload==='object'&&Array.isArray((payload as {value?:unknown}).value))return ((payload as {value:unknown[]}).value).filter(v=>v&&typeof v==='object') as Row[];return[];}
async function odata(c:Restaurant365Credentials,view:string,params:Record<string,string>){const url=new URL(`${baseUrl()}/${view}`);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);const auth=Buffer.from(`${c.domain}\\${c.username}:${c.password}`,'utf8').toString('base64');const response=await fetch(url,{headers:{Accept:'application/json',Authorization:`Basic ${auth}`},signal:AbortSignal.timeout(20000)});if(!response.ok){if([401,403].includes(response.status))throw new Error('Restaurant365 rechazó las credenciales o permisos para Price Watch.');if(response.status===429)throw new Error('Restaurant365 limitó temporalmente las consultas de Price Watch.');throw new Error(`${view}: Restaurant365 respondió ${response.status}.`);}return rows(await response.json());}
async function all(c:Restaurant365Credentials,view:string,params:Record<string,string>,max=20000,pageSize=250){const out:Row[]=[];for(let skip=0;skip<max;skip+=pageSize){const page=await odata(c,view,{...params,'$top':String(pageSize),'$skip':String(skip)});out.push(...page);if(page.length<pageSize)return out;}throw new Error(`${view}: Price Watch alcanzó el límite de paginación.`);}
function chunks<T>(values:T[],size:number){const out:T[][]=[];for(let i=0;i<values.length;i+=size)out.push(values.slice(i,i+size));return out;}
async function parallel<T,R>(values:T[],limit:number,fn:(value:T)=>Promise<R>){const out=new Array<R>(values.length);let cursor=0;const worker=async()=>{while(cursor<values.length){const index=cursor++;out[index]=await fn(values[index]);}};await Promise.all(Array.from({length:Math.min(limit,values.length)},worker));return out;}
const normalizeLocation=(value:string)=>{const n=value.toLowerCase();return ['Stamford','Orange','Fairfield','Danbury','Avon','Southington'].find(x=>n.includes(x.toLowerCase()))||value||'Sin locación';};
function parseLine(detail:Row,header:Row,vendor:string):PriceWatchLine|null{
 const itemName=text(detail,['itemName','purchasedItemName','inventoryItemName','vendorItemName','vendorItem','description','item']);
 const vendorItemNumber=text(detail,['vendorItemNumber','vendorItemNo','productCode','itemNumber','sku','brandItemNumber']);
 const itemId=text(detail,['itemId','purchasedItemId','inventoryItemId','vendorItemId']);
 const quantity=num(detail,['quantity','qty','invoiceQuantity','receivedQuantity']);
 const uom=text(detail,['unitOfMeasure','unitOfMeasureName','uom','purchaseUnitOfMeasure','purchaseUom','unitName']);
 const directUnit=num(detail,['eachAmount','unitPrice','price','amountEach','costEach','invoiceUnitPrice']);
 const rawTotal=num(detail,['lineAmount','lineTotal','extendedPrice','extPrice','total','amount','debit']);
 const lineTotal=rawTotal===null?null:Math.abs(rawTotal);
 const unitPrice=directUnit!==null?Math.abs(directUnit):quantity&&lineTotal!==null?Math.abs(lineTotal/quantity):null;
 const packSize=text(detail,['packSize','caseSize','packageSize','size','purchasePackSize']);
 const weight=num(detail,['weight','catchWeight','actualWeight']);
 const hasItem=Boolean(itemName||vendorItemNumber||itemId);
 if(!hasItem)return null;
 const verify:string[]=[];if(quantity===null||quantity===0)verify.push('Cantidad/UOM sin confirmar');if(!uom)verify.push('UOM sin confirmar');if(unitPrice===null)verify.push('Precio unitario sin confirmar');if(!vendorItemNumber&&!itemId)verify.push('SKU/vendor item sin confirmar');
 const type=text(header,['type']),credit=/credit/i.test(type);const date=text(header,['date']).slice(0,10);const location=normalizeLocation(text(header,['locationName','location']));const name=itemName||vendorItemNumber||'Artículo sin nombre';
 return{transactionId:id(header),invoiceNumber:text(header,['transactionNumber','number'])||undefined,date,location,vendor,approved:bool(header,['isApproved','approved']),credit,itemId:itemId||undefined,itemName:name,vendorItemNumber:vendorItemNumber||undefined,uom:uom||undefined,quantity:quantity===null?null:Math.abs(quantity),unitPrice,lineTotal,packSize:packSize||undefined,weight,category:classifyPriceWatchItem(name,vendor,uom),source:'r365-item',verify};
}
export async function getPriceWatch(organizationId:string,start:string,end:string,refresh=false):Promise<PriceWatchResponse>{
 if(!validDate(start)||!validDate(end)||start>end||days(start,end)>93)throw new Error('Price Watch requiere un rango válido de hasta 93 días.');const key=`price-watch-v1:${start}:${end}`;
 if(!refresh){const saved=await getIntegrationSnapshot<PriceWatchResponse>(organizationId,'restaurant365-price-watch',key);if(saved&&Date.now()-Date.parse(saved.updatedAt)<30*60*1000)return saved.payload;}
 const c=await credentials(organizationId);const endExclusive=new Date(Date.parse(`${end}T00:00:00Z`)+86400000).toISOString().slice(0,10);
 const headers=await all(c,'Transaction',{'$select':'transactionId,locationId,locationName,date,transactionNumber,type,isApproved,companyId,name','$filter':`date ge ${start}T00:00:00Z and date lt ${endExclusive}T00:00:00Z`},20000,250);
 const invoices=headers.filter(row=>/^ap\s*(invoice|credit(?:\s*memo)?)$/i.test(text(row,['type']).trim()));const companyIds=[...new Set(invoices.map(row=>text(row,['companyId'])).filter(Boolean))];const companies=new Map<string,string>();
 for(const batch of chunks(companyIds,20)){const result=await all(c,'Company',{'$select':'companyId,name','$filter':batch.map(value=>`companyId eq ${value}`).join(' or ')},5000,250).catch(()=>[]);for(const row of result)companies.set(text(row,['companyId']).toLowerCase(),text(row,['name'])||'Proveedor sin identificar');}
 const batches=chunks(invoices.map(id).filter(Boolean),8);const pages=await parallel(batches,2,async batch=>all(c,'TransactionDetail',{'$filter':batch.map(value=>`transactionId eq ${value}`).join(' or ')},5000,250).catch(async()=>{const singles=await parallel(batch,4,value=>all(c,'TransactionDetail',{'$filter':`transactionId eq ${value}`},2000,250));return singles.flat();}));const details=pages.flat();const byId=new Map<string,Row[]>();for(const row of details){const key=id(row);const list=byId.get(key)||[];list.push(row);byId.set(key,list);}
 const parsed:PriceWatchLine[]=[];let accountLines=0;for(const header of invoices){const vendor=companies.get(text(header,['companyId']).toLowerCase())||text(header,['name'])||'Proveedor sin identificar';const rows=byId.get(id(header))||[];for(const detail of rows){const line=parseLine(detail,header,vendor);if(line)parsed.push(line);else accountLines++;}}
 const result=analyzePriceWatch(parsed,start,end);result.sourceCoverage.accountLines=accountLines;result.sourceCoverage.invoices=invoices.length;result.caveats=[
  'Price Watch compara líneas de AP Invoice/Credit Memo que Restaurant365 expone por artículo. Las líneas registradas solo por cuenta GL quedan fuera del cálculo de precio.',
  'Los cambios de UOM, pack/case size, SKU o datos incompletos se marcan VERIFY y no se presentan como aumento confirmado.',
  'Impacto estimado = diferencia contra el promedio comparable reciente × cantidad de la compra actual; no sustituye inventario, yield ni costo teórico.',
  'Antes de cambiar proveedor, confirma contrato, calidad, freight, rebates y disponibilidad.'
 ];await saveIntegrationSnapshot(organizationId,'restaurant365-price-watch',key,result);return result;
}
