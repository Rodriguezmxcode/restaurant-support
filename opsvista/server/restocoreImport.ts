import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { readRestaurant365ArchiveSource } from './restaurant365OData.js';

type Row=Record<string,unknown>;
export type ArchiveView={name:string;keys:string[];fields:string[];label:string;daily:boolean};
type Cursor={offset:number;pageSize:number;day?:string;until?:string;lastPage?:string;verifiedFrom?:string};
const knownLabels:Record<string,string>={Location:'Sucursales y oficina corporativa',Company:'Proveedores y empresas',GlAccount:'Cuentas contables',GLAccount:'Cuentas contables',Item:'Productos e inventario',Transaction:'Facturas, créditos y movimientos contables',TransactionDetail:'Productos y partidas de las transacciones',Employee:'Empleados',JobTitle:'Puestos de trabajo',POSEmployee:'Empleados del POS',PosEmployee:'Empleados del POS',EmployeeLite:'Directorio de empleados',EmployeeLiteDto:'Directorio adicional de empleados',MenuItemCategory:'Categorías del menú',SalesEmployeeTax:'Impuestos de las ventas',LaborDetail:'Horas y turnos trabajados',PayrollSummary:'Resumen de nómina',SalesEmployee:'Tickets de venta',SalesDetail:'Productos vendidos',SalesPayment:'Cobros de las ventas',EntityDeleted:'Registros eliminados en Restaurant365'};
const priority=['Location','Company','GlAccount','GLAccount','Item','Transaction','TransactionDetail','JobTitle','Employee','POSEmployee','PayrollSummary','LaborDetail','SalesEmployee','SalesDetail','SalesPayment','EntityDeleted'];
let client:ReturnType<typeof postgres>|undefined,ready:Promise<void>|undefined;
function db(){const url=process.env.OPSVISTA_DATABASE_URL||process.env.OPSVISTA_DATABASE_DATABASE_URL;if(!url)throw new Error('No está disponible el guardado permanente de RestoCore.');return client||=postgres(url,{max:4,idle_timeout:20,connect_timeout:10});}
async function schema(){
  if(!ready)ready=(async()=>{
    await db()`create table if not exists opsvista_r365_archive_views(organization_id text not null,view_name text not null,definition jsonb not null,cursor jsonb not null default '{"offset":0,"pageSize":100}',state text not null default 'pending',last_error text,next_attempt timestamptz not null default now(),updated_at timestamptz,completed_at timestamptz,primary key(organization_id,view_name))`;
    await db()`create table if not exists opsvista_r365_archive_records(organization_id text not null,view_name text not null,source_id text not null,payload jsonb not null,location_id text not null default '',record_date text not null default '',record_type text not null default '',label text not null default '',observed_at timestamptz not null default now(),primary key(organization_id,view_name,source_id))`;
    await db()`create index if not exists opsvista_r365_archive_filter on opsvista_r365_archive_records(organization_id,view_name,location_id,record_date)`;
    await db()`create table if not exists opsvista_r365_archive_leases(organization_id text primary key,token text not null,expires_at timestamptz not null)`;
  })().catch(e=>{ready=undefined;throw e;});
  await ready;
}
const attr=(tag:string,name:string)=>new RegExp('\\b'+name+'\\s*=\\s*["\']([^"\']+)["\']').exec(tag)?.[1]||'';
export function parseArchiveMetadata(xml:string):ArchiveView[]{
  if(xml.length>5000000||!/EntityType/.test(xml))throw new Error('Restaurant365 no entregó su catálogo de datos.');
  const types=new Map<string,{keys:string[];fields:string[]}>();
  for(const match of xml.matchAll(/<(?:\w+:)?EntityType\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?EntityType>/g)){
    const name=attr(match[1],'Name'),body=match[2];
    const keys=[...body.matchAll(/<(?:\w+:)?PropertyRef\b([^>]*)\/?\s*>/g)].map(m=>attr(m[1],'Name'));
    const fields=[...body.matchAll(/<(?:\w+:)?Property\b([^>]*)\/?\s*>/g)].map(m=>attr(m[1],'Name'));
    if(name)types.set(name,{keys,fields});
  }
  const views:ArchiveView[]=[];
  for(const match of xml.matchAll(/<(?:\w+:)?EntitySet\b([^>]+)>/g)){
    const name=attr(match[1],'Name'),type=attr(match[1],'EntityType').split('.').pop()||'',model=types.get(type);
    if(!/^[A-Za-z][A-Za-z0-9_]{0,80}$/.test(name)||!model||!model.keys.length||model.keys.some(k=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(k)))continue;
    views.push({name,...model,label:knownLabels[name]||name,daily:/^Sales(Employee|Detail|Payment)$/i.test(name)});
  }
  if(!views.length)throw new Error('No se pudieron identificar las tablas y sus claves de Restaurant365.');
  return views.sort((a,b)=>(priority.indexOf(a.name)<0?999:priority.indexOf(a.name))-(priority.indexOf(b.name)<0?999:priority.indexOf(b.name)));
}
export function field(row:Row,...names:string[]){for(const name of names){const key=Object.keys(row).find(k=>k.toLowerCase()===name.toLowerCase());if(key&&row[key]!==null&&row[key]!==undefined&&String(row[key]).trim()!=='')return String(row[key]);}return '';}
export function archiveRecord(view:ArchiveView,row:Row){
  // Retain every declared key and the line's parent identifiers. An auto ID
  // alone can repeat across transactions or locations in the live source.
  const keys=view.name==='TransactionDetail'?[...new Set([...view.keys,...['transactionDetailAutoId','transactionId','locationId','glAccountId','itemId'].filter(key=>field(row,key))])]:view.keys;
  const values=keys.map(k=>field(row,k));
  if(values.some(v=>!v))throw new Error(`${view.name}: un registro no tiene su identificador original; se conserva el punto de carga.`);
  const source_id=JSON.stringify(view.name==='TransactionDetail'?keys.map((key,index)=>[key.toLowerCase(),values[index]]):values);
  const date=field(row,'date','dateWorked','businessDate','salesDate','modifiedOn','createdOn','deletedOn');
  return {source_id,payload:row,location_id:field(row,'locationId','location_Id','primaryLocation_id','location'),record_date:/^\d{4}-\d{2}-\d{2}/.test(date)?date.slice(0,10):'',record_type:field(row,'type','glType','category1'),label:field(row,'name','fullName','labor','comment','itemNumber','transactionNumber')};
}
function dayAfter(day:string){return new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);}
export function archiveQuery(view:ArchiveView,cursor:Cursor){
  // The live detail endpoint rejects ordering by nullable joined identifiers.
  const ordering=view.keys;
  const params:Record<string,string>={'$top':String(cursor.pageSize),'$skip':String(cursor.offset),'$orderby':ordering.join(',')};
  if(view.daily){
    const dateField=view.fields.find(f=>f.toLowerCase()==='modifiedon');
    if(!dateField||!cursor.day||!cursor.until)throw new Error(`${view.name}: rango histórico aún sin verificar.`);
    params.$filter=`${dateField} ge ${cursor.day}T00:00:00Z and ${dateField} lt ${dayAfter(cursor.day)}T00:00:00Z`;
  }
  return params;
}
export function advanceArchiveCursor(view:ArchiveView,cursor:Cursor,rows:Row[]){
  const next={...cursor};
  const signature=createHash('sha256').update(JSON.stringify(rows.map(row=>archiveRecord(view,row).source_id))).digest('hex');
  if(rows.length&&cursor.lastPage===signature)throw new Error(`${view.name}: Restaurant365 repitió una página; la carga no se marca completa.`);
  // Stop only on an empty page; some providers cap page sizes below $top.
  if(rows.length){next.offset+=rows.length;next.lastPage=signature;if(rows.length===cursor.pageSize)next.pageSize=Math.min(500,cursor.pageSize*2);return {cursor:next,complete:false};}
  if(view.daily&&cursor.day&&cursor.until&&dayAfter(cursor.day)<cursor.until){next.day=dayAfter(cursor.day);next.offset=0;delete next.lastPage;return {cursor:next,complete:false};}
  return {cursor:next,complete:true};
}
function diagnostic(message:string|null){
  if(!message)return '';
  const http=/HTTP \d{3}/.exec(message);if(http)return http[0];
  if(/timeout|aborted/i.test(message))return 'timeout';
  if(/identificadores repetidos/.test(message))return 'duplicate_source_keys';
  if(/no tiene su identificador/.test(message))return 'missing_source_key';
  if(/repitió una página/.test(message))return 'repeated_source_page';
  if(/fecha|histórico/.test(message))return 'history_date_unavailable';
  if(/respuesta|lista/.test(message))return 'invalid_source_response';
  return 'import_error';
}
async function ensureViews(org:string){
  const [existing]=await db()`select count(*)::int as n from opsvista_r365_archive_views where organization_id=${org}`;
  if(existing.n)return;
  const xml=await readRestaurant365ArchiveSource(org,'$metadata');
  if(typeof xml!=='string')throw new Error('Catálogo de Restaurant365 no válido.');
  for(const view of parseArchiveMetadata(xml))await db()`insert into opsvista_r365_archive_views(organization_id,view_name,definition) values(${org},${view.name},${db().json(view)}) on conflict do nothing`;
}
async function archiveSummary(org:string){
  const rows=await db()`select v.view_name,v.definition,v.state,v.last_error,v.updated_at,v.completed_at,v.cursor,count(r.source_id)::int as records,min(nullif(r.record_date,'')) as first_date,max(nullif(r.record_date,'')) as last_date from opsvista_r365_archive_views v left join opsvista_r365_archive_records r on r.organization_id=v.organization_id and r.view_name=v.view_name where v.organization_id=${org} group by v.organization_id,v.view_name order by v.view_name`;
  return rows.map(r=>({name:r.view_name,label:knownLabels[r.view_name]||r.definition.label,state:r.state,error:r.last_error,records:r.records,firstDate:r.first_date,lastDate:r.last_date,updatedAt:r.updated_at,completedAt:r.completed_at,historyFrom:r.cursor.verifiedFrom||null,historyThrough:r.cursor.until||null}));
}
export async function runRestocoreImport(org='org-puerto-vallarta'){
  await schema();const token=randomUUID();
  const lease=await db()`insert into opsvista_r365_archive_leases values(${org},${token},now()+interval '110 seconds') on conflict(organization_id) do update set token=excluded.token,expires_at=excluded.expires_at where opsvista_r365_archive_leases.expires_at<now() returning token`;
  if(!lease.length)return {ok:true,busy:true,processed:0,remaining:1,errors:0};
  let processed=0,current='';
  try{
    await ensureViews(org);
    // One-time recovery for the corrected composite line identity and longer source timeout.
    await db()`update opsvista_r365_archive_views set next_attempt=now(),cursor=jsonb_set(cursor,'{recoveryV2}','true'::jsonb) where organization_id=${org} and state='error' and view_name in ('TransactionDetail','Item','SalesDetail') and coalesce(cursor->>'recoveryV2','')<>'true'`;
    await db()`update opsvista_r365_archive_views set next_attempt=now(),cursor=jsonb_set(cursor,'{lineIdentityV4}','true'::jsonb) where organization_id=${org} and state='error' and view_name='TransactionDetail' and coalesce(cursor->>'lineIdentityV4','')<>'true'`;
    // One complete page per request. Checkpoints and raw rows commit together.
    const candidates=await db()`select * from opsvista_r365_archive_views where organization_id=${org} and state<>'complete' and next_attempt<=now() order by case when state='pending' then 0 else 1 end,coalesce(updated_at,'1970-01-01'::timestamptz),view_name`;
    const chosen=candidates.sort((a,b)=>{const rank=(name:string)=>{const n=priority.indexOf(name);return n<0?999:n;};return (a.updated_at?1:0)-(b.updated_at?1:0)||(a.updated_at&&b.updated_at?new Date(a.updated_at).getTime()-new Date(b.updated_at).getTime():0)||rank(a.view_name)-rank(b.view_name);})[0];
    if(chosen){
      current=chosen.view_name;const view=chosen.definition as ArchiveView;let cursor=chosen.cursor as Cursor;
      if(view.daily&&!cursor.day){
        const dateField=view.fields.find(f=>f.toLowerCase()==='modifiedon');
        if(!dateField)throw new Error(`${current}: la fuente no expone una fecha para consultar su historial.`);
        const earliest=await readRestaurant365ArchiveSource(org,current,{'$top':'1','$orderby':`${dateField} asc`});
        if(!Array.isArray(earliest))throw new Error('Respuesta histórica no válida.');
        if(!earliest.length){await db()`update opsvista_r365_archive_views set state='complete',last_error=null,updated_at=now(),completed_at=now() where organization_id=${org} and view_name=${current}`;processed=1;}
        else{
          const date=field(earliest[0],dateField).slice(0,10);
          if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error(`${current}: no se pudo verificar la fecha más antigua.`);
          cursor={...cursor,day:date,verifiedFrom:date,until:dayAfter(new Date().toISOString().slice(0,10))};
        }
      }
      if(!processed){
        const rows=await readRestaurant365ArchiveSource(org,current,archiveQuery(view,cursor));
        if(!Array.isArray(rows))throw new Error('Restaurant365 no entregó una lista de registros.');
        const records=rows.map(row=>archiveRecord(view,row));
        const next=advanceArchiveCursor(view,cursor,rows);
        const unique=new Map(records.map(row=>[row.source_id,row]));
        if(unique.size!==records.length){console.warn('restocore-source-key-diagnostic',JSON.stringify({view:current,declaredKeys:view.keys,rows:rows.length,identifiers:Object.keys(rows[0]||{}).filter(k=>/id$|number$/i.test(k)).map(key=>({key,distinct:new Set(rows.map(row=>field(row,key))).size,missing:rows.filter(row=>!field(row,key)).length}))}));throw new Error(`${current}: identificadores repetidos dentro de una página. Se requiere verificar la clave.`);}
        await db().begin(async tx=>{
          if(records.length)await tx`insert into opsvista_r365_archive_records(organization_id,view_name,source_id,payload,location_id,record_date,record_type,label) select ${org},${current},x.source_id,x.payload,x.location_id,x.record_date,x.record_type,x.label from jsonb_to_recordset(${tx.json(records as never)}) as x(source_id text,payload jsonb,location_id text,record_date text,record_type text,label text) on conflict(organization_id,view_name,source_id) do update set payload=excluded.payload,location_id=excluded.location_id,record_date=excluded.record_date,record_type=excluded.record_type,label=excluded.label,observed_at=now()`;
          await tx`update opsvista_r365_archive_views set cursor=${tx.json(next.cursor)},state=${next.complete?'complete':'loading'},last_error=null,updated_at=now(),next_attempt=now(),completed_at=${next.complete?new Date().toISOString():null} where organization_id=${org} and view_name=${current}`;
        });processed=1;
      }
    }
  }catch(error){
    const message=error instanceof Error?error.message:'No se pudo importar Restaurant365.';
    if(!current)throw error;
    // Smaller pages recover large-view timeouts. No successful data is discarded.
    await db()`update opsvista_r365_archive_views set state='error',last_error=${message},next_attempt=now()+interval '30 minutes',updated_at=now(),cursor=jsonb_set(cursor,'{pageSize}',to_jsonb(greatest(10,coalesce((cursor->>'pageSize')::int,100)/2))) where organization_id=${org} and view_name=${current}`;
  }finally{await db()`delete from opsvista_r365_archive_leases where organization_id=${org} and token=${token}`;}
  const views=await archiveSummary(org);
  const [pending]=await db()`select count(*)::int as n from opsvista_r365_archive_views where organization_id=${org} and state<>'complete' and next_attempt<=now()`;
  // Operational telemetry contains no business rows or credentials.
  console.info('restocore-import-progress',JSON.stringify({records:views.reduce((sum,v)=>sum+v.records,0),views:views.map(v=>({name:v.name,state:v.state,records:v.records,errorCode:diagnostic(v.error)}))}));
  // Only progress metadata is returned to the scheduler, never business records.
  return {ok:!views.some(v=>v.state==='error'),processed,remaining:pending.n,errors:views.filter(v=>v.state==='error').length,records:views.reduce((sum,v)=>sum+v.records,0),completedViews:views.filter(v=>v.state==='complete').length,totalViews:views.length,views:views.map(v=>({name:v.name,state:v.state,records:v.records,error:v.error}))};
}
export async function readRestocoreArchive(org:string,query:{view?:string;offset?:number;location?:string;search?:string;start?:string;end?:string;transaction?:string}){
  await schema();const views=await archiveSummary(org);
  const locations=await db()`select source_id,payload from opsvista_r365_archive_records where organization_id=${org} and view_name='Location' order by label`;
  const locationRows=locations.map(l=>({id:field(l.payload,'locationId'),name:field(l.payload,'name')}));
  const base={provider:'restaurant365-odata',views,locations:locationRows,limitations:['La copia incluye las tablas que Restaurant365 publica mediante la conexión actual. Adjuntos, lotes Payment Run y comprobantes bancarios requieren una fuente que los exponga.','Los movimientos contables o pagos registrados no confirman por sí solos el débito bancario.','La carga histórica conserva los datos originales y su progreso. Una tabla con error o en carga no representa un historial completo.']};
  if(!query.view)return base;
  if(!views.some(v=>v.name===query.view))throw new Error('Tabla de Restaurant365 no disponible.');
  const offset=query.offset||0;if(!Number.isInteger(offset)||offset<0||offset>10000000)throw new Error('Página no válida.');
  const search=(query.search||'').slice(0,150),location=query.location||'',start=query.start||'',end=query.end||'',transaction=query.transaction||'';
  for(const date of [start,end])if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))))throw new Error('Fecha no válida.');
  if(start&&end&&start>end)throw new Error('Rango de fechas no válido.');
  const pattern='%'+search.replace(/[\\%_]/g,'\\$&')+'%';
  const rows=await db()`select r.source_id,r.payload,r.location_id,r.record_date,r.record_type,r.label,r.observed_at,count(*) over()::int as total from opsvista_r365_archive_records r where r.organization_id=${org} and r.view_name=${query.view} and (${location}='' or r.location_id=${location}) and (${start}='' or r.record_date>=${start}) and (${end}='' or r.record_date<=${end}) and (${search}='' or r.payload::text ilike ${pattern}) and (${transaction}='' or lower(coalesce(r.payload->>'transactionId',''))=lower(${transaction})) order by r.record_date desc,r.source_id limit 50 offset ${offset}`;
  return {...base,view:query.view,rows:rows.map(r=>({id:r.source_id,data:r.payload,date:r.record_date,location:locationRows.find(l=>l.id.toLowerCase()===r.location_id.toLowerCase())?.name||field(r.payload,'locationName','location')||'',type:r.record_type,label:r.label,observedAt:r.observed_at})),pagination:{offset,limit:50,total:rows[0]?.total||0,nextOffset:offset+50<(rows[0]?.total||0)?offset+50:null}};
}
