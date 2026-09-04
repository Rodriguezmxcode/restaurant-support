import { useEffect, useMemo, useState } from 'react';
import Restaurant365IntegrationPanel from './Restaurant365IntegrationPanel';
import CustomDateRangePicker from './CustomDateRangePicker';
import './restaurant365.css';

type Tab='Resumen'|'P&L'|'Facturas y AP'|'Corporate Office'|'Vendors'|'Cuentas GL'|'Conexión';
type PeriodKey='today'|'yesterday'|'this-week'|'prior-week'|'this-month'|'prior-month'|'last-30'|'custom';
type InvoiceStatusFilter='all'|'approved'|'pending';
type InvoiceSort='oldest'|'newest'|'created-oldest'|'created-newest'|'highest'|'lowest'|'vendor'|'invoice'|'location'|'status';
type Classification='Revenue'|'COGS'|'Labor'|'Operating Expense'|'Other Income'|'Other Expense'|'Balance Sheet'|'Unclassified';
type Status={
  configured:boolean;connected:boolean;mappedLocationCount:number;mappedRestaurantCount:number;corporateMapped:boolean;pnlReady:boolean;
  checkedAt?:string;latestTransactionAt?:string;error?:string;
  probes:{locations:boolean;glAccounts:boolean;transactions:boolean};
};
type Transaction={id:string;date:string;createdOn?:string;number?:string;name:string;type:string;approved:boolean;location:string;entity?:string;vendor?:string;createdBy?:string;amount:number|null};
type Account={id:string;number?:string;name:string;glType?:string;operationalCategory?:string;locationName?:string};
type LedgerRow={id:string;transactionId:string;date:string;transactionNumber?:string;transactionName:string;transactionType:string;vendor?:string;accountId:string;accountNumber?:string;accountName:string;glType?:string;operationalCategory?:string;classification:Classification;comment?:string;debit:number;credit:number;balance:number};
type Ledger={
  period:{month:string;start:string;endExclusive:string};entity:string;sourceLocation:{id:string;name:string};fetchedAt:string;
  totals:{transactions:number;approvedTransactions:number;apInvoices:number;detailRows:number;debits:number;credits:number;revenue:number;cogs:number;labor:number;operatingExpense:number;otherIncome:number;otherExpense:number;classifiedResult:number};
  groups:Array<{classification:Classification;amount:number;accountCount:number}>;
  accounts:Array<Account&{classification:Classification;debit:number;credit:number;balance:number;pnlAmount:number;lineCount:number}>;
  rows:LedgerRow[];
  quality:{status:'ready-for-reconciliation'|'incomplete';transactionDetailCoveragePct:number|null;transactionsWithoutDetails:number;detailsWithoutGlAccount:number;unclassifiedDetailRows:number;duplicateTransactionIds:number;duplicateDetailIds:number};
  caveats:string[];
};
type ApSnapshot={period:{month:string;start:string;endExclusive:string};fetchedAt:string;transactions:Transaction[];totals:{invoices:number;approved:number;pending:number;vendors:number;locations:number;amount:number;approvedAmount:number;pendingAmount:number;invoicesWithoutAmount:number};caveats:string[]};
type Catalog={fetchedAt:string;vendors?:Array<{id:string;number?:string;name:string;comment?:string}>;accounts?:Account[];caveats?:string[]};

const tabs:Tab[]=['Resumen','P&L','Facturas y AP','Corporate Office','Vendors','Cuentas GL','Conexión'];
const entities=['Stamford','Orange','Fairfield','Danbury','Avon','Southington','Corporate Office'];
const classLabels:Record<Classification,string>={Revenue:'Ingresos',COGS:'COGS',Labor:'Labor','Operating Expense':'Gastos operativos','Other Income':'Otros ingresos','Other Expense':'Otros gastos','Balance Sheet':'Balance general',Unclassified:'Sin clasificar'};
const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const preciseMoney=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2});
const periodOptions:Array<{key:PeriodKey;label:string}>=[{key:'today',label:'Today'},{key:'yesterday',label:'Yesterday'},{key:'this-week',label:'This week'},{key:'prior-week',label:'Prior week'},{key:'this-month',label:'This month'},{key:'prior-month',label:'Prior month'},{key:'last-30',label:'Last 30 days'},{key:'custom',label:'Custom'}];

function easternToday(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));return `${values.year}-${values.month}-${values.day}`;}
function addDays(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function startOfMonth(value:string,offset=0){const [year,month]=value.split('-').map(Number);return new Date(Date.UTC(year,month-1+offset,1)).toISOString().slice(0,10);}
function endOfMonth(value:string,offset=0){return addDays(startOfMonth(value,offset+1),-1);}
function operationalWeekStart(value:string){const date=new Date(`${value}T12:00:00Z`);return addDays(value,-((date.getUTCDay()-3+7)%7));}
function resolvedRange(period:PeriodKey,customStart:string,customEnd:string){const today=easternToday(),weekStart=operationalWeekStart(today);if(period==='today')return{start:today,end:today,label:'Today'};if(period==='yesterday'){const value=addDays(today,-1);return{start:value,end:value,label:'Yesterday'};}if(period==='this-week')return{start:weekStart,end:today,label:'This week'};if(period==='prior-week')return{start:addDays(weekStart,-7),end:addDays(weekStart,-1),label:'Prior week'};if(period==='this-month')return{start:startOfMonth(today),end:today,label:'This month'};if(period==='prior-month')return{start:startOfMonth(today,-1),end:endOfMonth(today,-1),label:'Prior month'};if(period==='last-30')return{start:addDays(today,-29),end:today,label:'Last 30 days'};return{start:customStart,end:customEnd,label:'Custom'};}
function rangeLabel(start:string,end:string){if(!start||!end)return 'Selecciona fechas';const format=(value:string)=>new Intl.DateTimeFormat('es-MX',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(`${value}T12:00:00Z`));return start===end?format(start):`${format(start)} – ${format(end)}`;}
function dateLabel(value:string){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('es-MX',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(date);}
function dateTimeLabel(value?:string){if(!value)return 'No disponible';const date=new Date(value);return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('es-MX',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZone:'America/New_York'}).format(date);}
function invoiceAgeDays(value:string){if(!value)return null;const invoice=new Date(`${value.slice(0,10)}T12:00:00Z`),today=new Date(`${easternToday()}T12:00:00Z`);if(Number.isNaN(invoice.getTime()))return null;return Math.max(0,Math.floor((today.getTime()-invoice.getTime())/86_400_000));}
function invoiceAgeLabel(value:string){const days=invoiceAgeDays(value);return days===null?'Antigüedad no disponible':days===0?'Hoy':days===1?'1 día':`${days} días`;}
function compareText(left?:string,right?:string){return (left||'').localeCompare(right||'','es',{numeric:true,sensitivity:'base'});}
async function requestJson<T>(url:string,signal?:AbortSignal){
  const response=await fetch(url,{credentials:'include',cache:'no-store',signal});
  const raw=await response.text();
  let body={} as T&{error?:string};
  try{body=raw?JSON.parse(raw) as T&{error?:string}:body;}catch{/* A platform error can return HTML or plain text. */}
  if(!response.ok){const platform=response.headers.get('x-vercel-error');throw new Error(body.error||`Restaurant365 no pudo entregar la información · HTTP ${response.status}${platform?` · ${platform}`:''}.`);}
  return body;
}

function rangeChunks(start:string,end:string,size=7){const result:Array<{start:string;end:string}>=[];for(let cursor=start;cursor<=end;cursor=addDays(cursor,size)){result.push({start:cursor,end:[addDays(cursor,size-1),end].sort()[0]});}return result;}
const rounded=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const classificationOrder:Classification[]=['Revenue','COGS','Labor','Operating Expense','Other Income','Other Expense','Balance Sheet','Unclassified'];

function mergeLedgers(snapshots:Ledger[],start:string,end:string):Ledger {
  if(!snapshots.length)throw new Error('Restaurant365 no devolvió segmentos para este periodo.');
  const accounts=new Map<string,Ledger['accounts'][number]>(),rows=new Map<string,LedgerRow>();
  for(const snapshot of snapshots){
    snapshot.accounts.forEach(account=>{const current=accounts.get(account.id);accounts.set(account.id,current?{...current,debit:rounded(current.debit+account.debit),credit:rounded(current.credit+account.credit),balance:rounded(current.balance+account.balance),pnlAmount:rounded(current.pnlAmount+account.pnlAmount),lineCount:current.lineCount+account.lineCount}:{...account});});
    snapshot.rows.forEach(row=>rows.set(`${row.id}|${row.transactionId}`,row));
  }
  const accountRows=Array.from(accounts.values()).sort((left,right)=>Math.abs(right.pnlAmount)-Math.abs(left.pnlAmount)||left.name.localeCompare(right.name));
  const groups=classificationOrder.map(classification=>({classification,amount:rounded(accountRows.filter(account=>account.classification===classification).reduce((sum,account)=>sum+account.pnlAmount,0)),accountCount:accountRows.filter(account=>account.classification===classification).length}));
  const total=(key:keyof Ledger['totals'])=>rounded(snapshots.reduce((sum,snapshot)=>sum+snapshot.totals[key],0));
  const approvedTransactions=total('approvedTransactions'),transactionsWithoutDetails=snapshots.reduce((sum,snapshot)=>sum+snapshot.quality.transactionsWithoutDetails,0),detailsWithoutGlAccount=snapshots.reduce((sum,snapshot)=>sum+snapshot.quality.detailsWithoutGlAccount,0),unclassifiedDetailRows=snapshots.reduce((sum,snapshot)=>sum+snapshot.quality.unclassifiedDetailRows,0);
  return {...snapshots[0],period:{month:start.slice(0,7),start,endExclusive:addDays(end,1)},fetchedAt:snapshots.map(snapshot=>snapshot.fetchedAt).sort().at(-1)||new Date().toISOString(),
    totals:{transactions:total('transactions'),approvedTransactions,apInvoices:total('apInvoices'),detailRows:total('detailRows'),debits:total('debits'),credits:total('credits'),revenue:total('revenue'),cogs:total('cogs'),labor:total('labor'),operatingExpense:total('operatingExpense'),otherIncome:total('otherIncome'),otherExpense:total('otherExpense'),classifiedResult:total('classifiedResult')},
    groups,accounts:accountRows,rows:Array.from(rows.values()).sort((left,right)=>right.date.localeCompare(left.date)||left.accountName.localeCompare(right.accountName)),
    quality:{status:approvedTransactions>0&&transactionsWithoutDetails===0&&detailsWithoutGlAccount===0&&unclassifiedDetailRows===0?'ready-for-reconciliation':'incomplete',transactionDetailCoveragePct:approvedTransactions?rounded((approvedTransactions-transactionsWithoutDetails)/approvedTransactions*100):null,transactionsWithoutDetails,detailsWithoutGlAccount,unclassifiedDetailRows,duplicateTransactionIds:snapshots.reduce((sum,snapshot)=>sum+snapshot.quality.duplicateTransactionIds,0),duplicateDetailIds:snapshots.reduce((sum,snapshot)=>sum+snapshot.quality.duplicateDetailIds,0)},
    caveats:Array.from(new Set(snapshots.flatMap(snapshot=>snapshot.caveats)))};
}

function mergeApSnapshots(snapshots:ApSnapshot[],start:string,end:string):ApSnapshot {
  if(!snapshots.length)throw new Error('Restaurant365 no devolvió segmentos de facturas para este periodo.');
  const transactions=Array.from(new Map(snapshots.flatMap(snapshot=>snapshot.transactions).map(row=>[row.id,row])).values()).sort((left,right)=>right.date.localeCompare(left.date));
  return {...snapshots[0],period:{month:start.slice(0,7),start,endExclusive:addDays(end,1)},fetchedAt:snapshots.map(snapshot=>snapshot.fetchedAt).sort().at(-1)||new Date().toISOString(),transactions,totals:{invoices:transactions.length,approved:transactions.filter(row=>row.approved).length,pending:transactions.filter(row=>!row.approved).length,vendors:new Set(transactions.map(row=>row.vendor).filter(Boolean)).size,locations:new Set(transactions.map(row=>row.entity).filter(Boolean)).size,amount:rounded(transactions.reduce((sum,row)=>sum+(row.amount||0),0)),approvedAmount:rounded(transactions.filter(row=>row.approved).reduce((sum,row)=>sum+(row.amount||0),0)),pendingAmount:rounded(transactions.filter(row=>!row.approved).reduce((sum,row)=>sum+(row.amount||0),0)),invoicesWithoutAmount:transactions.filter(row=>row.amount===null).length},caveats:Array.from(new Set(snapshots.flatMap(snapshot=>snapshot.caveats)))};
}

function Loading({detail}:{detail?:string}){return <section className="panel r365-state"><span className="r365-spinner"/><strong>Consultando Restaurant365…</strong><p>{detail||'Uniendo transacciones, detalles y cuentas GL del periodo seleccionado.'}</p></section>}
function ErrorState({message,onRetry}:{message:string;onRetry:()=>void}){return <section className="panel r365-state error"><strong>No se pudo completar esta vista</strong><p>{message}</p><button type="button" onClick={onRetry}>Intentar nuevamente</button></section>}
function QualityBanner({ledger}:{ledger:Ledger}){const ready=ledger.quality.status==='ready-for-reconciliation';return <div className={`r365-quality ${ready?'ready':'warning'}`}><div><strong>{ready?'Datos listos para conciliación':'La revisión de calidad está incompleta'}</strong><span>{ledger.quality.transactionDetailCoveragePct===null?'Sin transacciones aprobadas':`${ledger.quality.transactionDetailCoveragePct}% de transacciones aprobadas con detalle`}</span></div><div><span>Sin detalle <strong>{ledger.quality.transactionsWithoutDetails}</strong></span><span>GL sin match <strong>{ledger.quality.detailsWithoutGlAccount}</strong></span><span>Sin clasificar <strong>{ledger.quality.unclassifiedDetailRows}</strong></span><span>Duplicados <strong>{ledger.quality.duplicateTransactionIds+ledger.quality.duplicateDetailIds}</strong></span></div></div>}
function SourceNote({fetchedAt,caveats}:{fetchedAt:string;caveats:string[]}){return <div className="r365-source-note"><strong>Fuente: Restaurant365 OData · solo lectura</strong><span>Actualizado {new Date(fetchedAt).toLocaleString('es-MX')}</span><ul>{caveats.map(item=><li key={item}>{item}</li>)}</ul></div>}
function Metric({label,value,note,tone}:{label:string;value:string;note:string;tone?:'good'|'warn'|'neutral'}){return <article className={`r365-metric ${tone||'neutral'}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>}
function SortableHeader({label,active,direction,onClick}:{label:string;active:boolean;direction:'asc'|'desc';onClick:()=>void}){return <th><button type="button" className={`r365-sort-header ${active?'active':''}`} aria-pressed={active} onClick={onClick}>{label}<span aria-hidden="true">{active?(direction==='asc'?'↑':'↓'):'↕'}</span></button></th>}

function GroupBars({ledger,corporate=false}:{ledger:Ledger;corporate?:boolean}){
  const allowed:Classification[]=corporate?['Labor','Operating Expense','Other Expense','COGS']:['Revenue','COGS','Labor','Operating Expense','Other Income','Other Expense'];
  const groups=allowed.map(key=>ledger.groups.find(group=>group.classification===key)||{classification:key,amount:0,accountCount:0});
  const max=Math.max(...groups.map(group=>Math.abs(group.amount)),1);
  return <section className="panel r365-card"><header><div><h2>{corporate?'Composición de gastos corporativos':'Actividad P&L clasificada'}</h2><p>Importes derivados de débitos y créditos aprobados, agrupados mediante los tipos GL de R365.</p></div><span className="count-pill">{rangeLabel(ledger.period.start,addDays(ledger.period.endExclusive,-1))}</span></header><div className="r365-bars">{groups.map(group=><div key={group.classification} className="r365-bar-row"><div><strong>{classLabels[group.classification]}</strong><span>{group.accountCount} cuentas</span></div><div className="r365-bar-track"><i style={{width:`${Math.max(2,Math.abs(group.amount)/max*100)}%`}}/></div><strong>{preciseMoney.format(group.amount)}</strong></div>)}</div></section>;
}

function AccountTable({ledger,corporate=false}:{ledger:Ledger;corporate?:boolean}){
  const rows=corporate?ledger.accounts.filter(account=>['COGS','Labor','Operating Expense','Other Expense','Unclassified'].includes(account.classification)):ledger.accounts;
  return <section className="panel r365-card"><header><div><h2>{corporate?'Cuentas de gasto de la oficina':'Detalle por cuenta GL'}</h2><p>Ordenado por mayor impacto dentro del periodo seleccionado.</p></div><span className="count-pill">{rows.length} CUENTAS</span></header><div className="r365-table-wrap"><table><thead><tr><th>Cuenta</th><th>Clasificación</th><th>Débito</th><th>Crédito</th><th>{corporate?'Gasto':'Importe P&L'}</th><th>Líneas</th></tr></thead><tbody>{rows.slice(0,100).map(account=><tr key={account.id}><td><strong>{account.number||'—'} · {account.name}</strong><small>{account.glType||'Sin tipo GL'} · {account.operationalCategory||'Sin categoría operacional'}</small></td><td><span className={`r365-class ${account.classification.toLowerCase().replaceAll(' ','-')}`}>{classLabels[account.classification]}</span></td><td>{preciseMoney.format(account.debit)}</td><td>{preciseMoney.format(account.credit)}</td><td className="amount">{preciseMoney.format(account.pnlAmount)}</td><td>{account.lineCount}</td></tr>)}</tbody></table>{!rows.length&&<div className="r365-empty">No se detectaron cuentas para esta selección.</div>}</div></section>;
}

function LedgerTable({ledger,expensesOnly=false}:{ledger:Ledger;expensesOnly?:boolean}){
  const rows=expensesOnly?ledger.rows.filter(row=>['COGS','Labor','Operating Expense','Other Expense','Unclassified'].includes(row.classification)):ledger.rows;
  return <section className="panel r365-card"><header><div><h2>{expensesOnly?'Movimientos corporativos':'Movimientos del ledger'}</h2><p>Cada importe conserva la transacción, vendor y cuenta GL de origen.</p></div><span className="count-pill">{rows.length} LÍNEAS</span></header><div className="r365-table-wrap"><table><thead><tr><th>Fecha / referencia</th><th>Vendor / descripción</th><th>Cuenta GL</th><th>Débito</th><th>Crédito</th></tr></thead><tbody>{rows.slice(0,200).map(row=><tr key={row.id}><td><strong>{dateLabel(row.date)}</strong><small>{row.transactionNumber||'Sin referencia'} · {row.transactionType}</small></td><td><strong>{row.vendor||row.transactionName}</strong><small>{row.comment||row.transactionName}</small></td><td><strong>{row.accountNumber||'—'} · {row.accountName}</strong><small>{classLabels[row.classification]}</small></td><td>{preciseMoney.format(row.debit)}</td><td>{preciseMoney.format(row.credit)}</td></tr>)}</tbody></table>{rows.length>200&&<div className="r365-table-limit">Mostrando 200 de {rows.length} líneas. Los cálculos utilizan todas las líneas recuperadas.</div>}{!rows.length&&<div className="r365-empty">No se detectaron movimientos aprobados para esta selección.</div>}</div></section>;
}

export default function Restaurant365View({canManageIntegrations}:{canManageIntegrations:boolean}){
  const [tab,setTab]=useState<Tab>('Resumen');
  const [period,setPeriod]=useState<PeriodKey>('prior-month');
  const [customStart,setCustomStart]=useState(()=>startOfMonth(easternToday(),-1));
  const [customEnd,setCustomEnd]=useState(()=>endOfMonth(easternToday(),-1));
  const [entity,setEntity]=useState('Stamford');
  const [status,setStatus]=useState<Status>();
  const [ledger,setLedger]=useState<Ledger>();
  const [ap,setAp]=useState<ApSnapshot>();
  const [catalog,setCatalog]=useState<Catalog>();
  const [search,setSearch]=useState('');
  const [invoiceEntity,setInvoiceEntity]=useState('All entities');
  const [invoiceVendor,setInvoiceVendor]=useState('All vendors');
  const [invoiceStatus,setInvoiceStatus]=useState<InvoiceStatusFilter>('all');
  const [invoiceSort,setInvoiceSort]=useState<InvoiceSort>('oldest');
  const [invoiceDateStart,setInvoiceDateStart]=useState('');
  const [invoiceDateEnd,setInvoiceDateEnd]=useState('');
  const [selectedInvoiceIds,setSelectedInvoiceIds]=useState<string[]>([]);
  const [copyNotice,setCopyNotice]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [loadingDetail,setLoadingDetail]=useState('');
  const [reload,setReload]=useState(0);
  const range=useMemo(()=>resolvedRange(period,customStart,customEnd),[period,customStart,customEnd]);

  useEffect(()=>{void requestJson<Status>('/api/integrations/restaurant365').then(body=>{setStatus(body);setError(body.error||'');}).catch(reason=>setError(reason instanceof Error?reason.message:'Restaurant365 no está disponible.'));},[reload]);
  useEffect(()=>{
    if(['Resumen','Conexión'].includes(tab))return;
    const controller=new AbortController();setLoading(true);setError('');setSearch('');setSelectedInvoiceIds([]);setCopyNotice('');
    const queryEntity=tab==='Corporate Office'?'Corporate Office':entity;
    const fetchWithDailyFallback=async<T,>(view:'ledger'|'ap',chunk:{start:string;end:string},index:number,total:number)=>{
      const query=(part:{start:string;end:string})=>`/api/integrations/restaurant365?view=${view}&start=${part.start}&end=${part.end}${view==='ledger'?`&entity=${encodeURIComponent(queryEntity)}`:''}`;
      setLoadingDetail(`Cargando bloque ${index+1} de ${total} · ${rangeLabel(chunk.start,chunk.end)}`);
      try{return [await requestJson<T>(query(chunk),controller.signal)];}
      catch(reason){
        const message=reason instanceof Error?reason.message:'';
        if(chunk.start===chunk.end||!/FUNCTION_INVOCATION_FAILED|HTTP 50[034]|estado 500/i.test(message))throw reason;
        const daily=rangeChunks(chunk.start,chunk.end,1),results:T[]=[];
        for(let dayIndex=0;dayIndex<daily.length;dayIndex+=1){setLoadingDetail(`Restaurant365 ajustó la carga · día ${dayIndex+1} de ${daily.length} en este bloque`);results.push(await requestJson<T>(query(daily[dayIndex]),controller.signal));}
        return results;
      }
    };
    const request=(async()=>{
      if(tab==='P&L'||tab==='Corporate Office'){
        const chunks=rangeChunks(range.start,range.end),snapshots:Ledger[]=[];
        for(let index=0;index<chunks.length;index+=1)snapshots.push(...await fetchWithDailyFallback<Ledger>('ledger',chunks[index],index,chunks.length));
        setLedger(mergeLedgers(snapshots,range.start,range.end));return;
      }
      if(tab==='Facturas y AP'){
        setInvoiceVendor('All vendors');setInvoiceDateStart(range.start);setInvoiceDateEnd(range.end);
        const chunks=rangeChunks(range.start,range.end),snapshots:ApSnapshot[]=[];
        for(let index=0;index<chunks.length;index+=1)snapshots.push(...await fetchWithDailyFallback<ApSnapshot>('ap',chunks[index],index,chunks.length));
        setAp(mergeApSnapshots(snapshots,range.start,range.end));return;
      }
      setLoadingDetail('Leyendo el catálogo contable de Restaurant365…');
      setCatalog(await requestJson<Catalog>(`/api/integrations/restaurant365?view=${tab==='Vendors'?'vendors':'accounts'}`,controller.signal));
    })();
    void request.catch(reason=>{if(reason instanceof DOMException&&reason.name==='AbortError')return;setError(reason instanceof Error?reason.message:'Restaurant365 no está disponible.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[tab,range.start,range.end,entity,reload]);

  const normalizedSearch=search.trim().toLowerCase();
  const vendors=useMemo(()=>catalog?.vendors?.filter(vendor=>!normalizedSearch||`${vendor.number||''} ${vendor.name} ${vendor.comment||''}`.toLowerCase().includes(normalizedSearch))||[],[catalog?.vendors,normalizedSearch]);
  const accounts=useMemo(()=>catalog?.accounts?.filter(account=>!normalizedSearch||`${account.number||''} ${account.name} ${account.glType||''} ${account.operationalCategory||''}`.toLowerCase().includes(normalizedSearch))||[],[catalog?.accounts,normalizedSearch]);
  const invoiceVendorOptions=useMemo(()=>{
    const counts=new Map<string,number>();
    (ap?.transactions||[]).filter(row=>invoiceEntity==='All entities'||row.entity===invoiceEntity).forEach(row=>{const vendor=row.vendor||'Sin vendor enlazado';counts.set(vendor,(counts.get(vendor)||0)+1);});
    return Array.from(counts.entries()).sort(([left],[right])=>compareText(left,right));
  },[ap?.transactions,invoiceEntity]);
  const visibleInvoices=useMemo(()=>{
    const rows=ap?.transactions.filter(row=>{
      const invoiceDate=row.date.slice(0,10),vendor=row.vendor||'Sin vendor enlazado';
      return (invoiceEntity==='All entities'||row.entity===invoiceEntity)&&(invoiceVendor==='All vendors'||vendor===invoiceVendor)&&(invoiceStatus==='all'||(invoiceStatus==='approved'&&row.approved)||(invoiceStatus==='pending'&&!row.approved))&&(!invoiceDateStart||invoiceDate>=invoiceDateStart)&&(!invoiceDateEnd||invoiceDate<=invoiceDateEnd)&&(!normalizedSearch||`${row.number||''} ${row.name} ${row.vendor||''} ${row.entity||''} ${row.createdBy||''}`.toLowerCase().includes(normalizedSearch));
    })||[];
    return [...rows].sort((left,right)=>{
      if(invoiceSort==='highest')return (right.amount||0)-(left.amount||0)||left.date.localeCompare(right.date);
      if(invoiceSort==='lowest')return (left.amount??Number.MAX_SAFE_INTEGER)-(right.amount??Number.MAX_SAFE_INTEGER)||left.date.localeCompare(right.date);
      if(invoiceSort==='newest')return right.date.localeCompare(left.date)||compareText(right.number,left.number);
      if(invoiceSort==='created-oldest')return compareText(left.createdOn,right.createdOn)||left.date.localeCompare(right.date);
      if(invoiceSort==='created-newest')return compareText(right.createdOn,left.createdOn)||right.date.localeCompare(left.date);
      if(invoiceSort==='vendor')return compareText(left.vendor,right.vendor)||left.date.localeCompare(right.date);
      if(invoiceSort==='invoice')return compareText(left.number||left.name,right.number||right.name)||left.date.localeCompare(right.date);
      if(invoiceSort==='location')return compareText(left.entity||left.location,right.entity||right.location)||left.date.localeCompare(right.date);
      if(invoiceSort==='status')return Number(left.approved)-Number(right.approved)||left.date.localeCompare(right.date);
      return left.date.localeCompare(right.date)||compareText(left.number,right.number);
    });
  },[ap?.transactions,invoiceEntity,invoiceVendor,invoiceStatus,invoiceDateStart,invoiceDateEnd,invoiceSort,normalizedSearch]);
  const selectedInvoiceSet=useMemo(()=>new Set(selectedInvoiceIds),[selectedInvoiceIds]);
  const visibleInvoiceAmount=rounded(visibleInvoices.reduce((sum,row)=>sum+(Number(row.amount)||0),0));
  const visibleInvoicesWithoutAmount=visibleInvoices.filter(row=>row.amount===null).length;
  const approvedWithoutAmount=ap?.transactions.filter(row=>row.approved&&row.amount===null).length||0;
  const pendingWithoutAmount=ap?.transactions.filter(row=>!row.approved&&row.amount===null).length||0;
  const allVisibleSelected=visibleInvoices.length>0&&visibleInvoices.every(row=>selectedInvoiceSet.has(row.id));
  const selectedInvoices=ap?.transactions.filter(row=>selectedInvoiceSet.has(row.id))||[];
  const selectedInvoiceAmount=rounded(selectedInvoices.reduce((sum,row)=>sum+(Number(row.amount)||0),0));
  const hasInvoiceFilters=invoiceEntity!=='All entities'||invoiceVendor!=='All vendors'||invoiceStatus!=='all'||invoiceDateStart!==range.start||invoiceDateEnd!==range.end||Boolean(search.trim())||invoiceSort!=='oldest';
  const activeLedger=ledger&&ledger.period.start===range.start&&ledger.period.endExclusive===addDays(range.end,1)&&(tab==='Corporate Office'?ledger.entity==='Corporate Office':ledger.entity===entity)?ledger:undefined;
  const retry=()=>setReload(value=>value+1);
  const showPeriod=['P&L','Facturas y AP','Corporate Office'].includes(tab);
  const corporateSpend=activeLedger?activeLedger.totals.cogs+activeLedger.totals.labor+activeLedger.totals.operatingExpense+activeLedger.totals.otherExpense:0;
  const toggleVisibleInvoices=()=>setSelectedInvoiceIds(current=>{const next=new Set(current);if(allVisibleSelected)visibleInvoices.forEach(row=>next.delete(row.id));else visibleInvoices.forEach(row=>next.add(row.id));return Array.from(next);});
  const toggleInvoice=(id:string)=>setSelectedInvoiceIds(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);
  const clearInvoiceFilters=()=>{setInvoiceEntity('All entities');setInvoiceVendor('All vendors');setInvoiceStatus('all');setInvoiceDateStart(range.start);setInvoiceDateEnd(range.end);setInvoiceSort('oldest');setSearch('');setSelectedInvoiceIds([]);setCopyNotice('');};
  const toggleInvoiceSort=(ascending:InvoiceSort,descending:InvoiceSort)=>setInvoiceSort(current=>current===ascending?descending:ascending);
  const copyInvoiceFollowUp=async()=>{
    if(!ap)return;
    const rows=selectedInvoiceIds.length?ap.transactions.filter(row=>selectedInvoiceSet.has(row.id)):visibleInvoices;
    if(!rows.length){setCopyNotice('No hay facturas para copiar con estos filtros.');return;}
    const amount=rounded(rows.reduce((sum,row)=>sum+(Number(row.amount)||0),0));
    const heading=invoiceStatus==='pending'?'Facturas pendientes de aprobación/procesamiento':invoiceStatus==='approved'?'Facturas aprobadas en R365':'Seguimiento de facturas AP';
    const ordered=[...rows].sort((left,right)=>left.date.localeCompare(right.date));
    const lines=[`Jonathan — ${heading}`,`${rangeLabel(ap.period.start,addDays(ap.period.endExclusive,-1))} · ${rows.length} facturas · ${preciseMoney.format(amount)}`,...ordered.map(row=>`• Invoice ${dateLabel(row.date)} · ${invoiceAgeLabel(row.date)} · creado en R365 ${dateTimeLabel(row.createdOn)} · ${row.entity||row.location} · ${row.vendor||'Sin vendor'} · #${row.number||row.name} · ${row.amount===null?'Monto no disponible':preciseMoney.format(row.amount)} · ${row.approved?'Aprobada':'Pendiente'}`),'Nota: “Aprobada” en R365 no confirma que la factura esté pagada. El total es la suma de los invoices seleccionados, no un saldo AP Aging conciliado.'];
    try{await navigator.clipboard.writeText(lines.join('\n'));setCopyNotice(`Lista copiada: ${rows.length} facturas para Jonathan.`);}catch{setCopyNotice('No se pudo copiar automáticamente. Selecciona y copia la lista desde la tabla.');}
  };

  return <div className="r365-page">
    <section className="panel r365-tabs" role="tablist" aria-label="Secciones de Restaurant365">{tabs.map(item=><button key={item} type="button" role="tab" aria-selected={tab===item} className={tab===item?'active':''} onClick={()=>setTab(item)}>{item}</button>)}</section>
    {showPeriod&&<section className="panel r365-controls"><label><span>PERIODO CONTABLE</span><select value={period} onChange={event=>setPeriod(event.target.value as PeriodKey)}>{periodOptions.map(option=><option value={option.key} key={option.key}>{option.label}</option>)}</select></label><CustomDateRangePicker active={period==='custom'} start={customStart} end={customEnd} maxDate={easternToday()} maxRangeDays={31} onApply={(start,end)=>{setCustomStart(start);setCustomEnd(end);}} ariaLabel="Seleccionar periodo contable de Restaurant365"/>{tab==='P&L'&&<label><span>LOCACIÓN</span><select value={entity} onChange={event=>setEntity(event.target.value)}>{entities.map(item=><option key={item}>{item}</option>)}</select></label>}<div><strong>{range.label} · {rangeLabel(range.start,range.end)}</strong><span>{tab==='Corporate Office'?'Centro de costos de oficina':tab==='Facturas y AP'?'Facturas AP de las siete locaciones':'Ledger aprobado por locación'} · carga segmentada automática</span></div></section>}

    {tab==='Conexión'?<Restaurant365IntegrationPanel canManage={canManageIntegrations}/>:tab==='Resumen'?<>
      {error&&<ErrorState message={error} onRetry={retry}/>}<div className="r365-metrics-grid"><Metric label="Conexión" value={status?.connected?'Activa':'Pendiente'} note="Restaurant365 OData · solo lectura" tone={status?.connected?'good':'warn'}/><Metric label="Restaurantes" value={`${status?.mappedRestaurantCount??'—'} / 6`} note="Locaciones operativas" tone={status?.mappedRestaurantCount===6?'good':'warn'}/><Metric label="Corporate Office" value={status?.corporateMapped?'Mapeada':'Pendiente'} note="Centro de costos" tone={status?.corporateMapped?'good':'warn'}/><Metric label="Cuentas GL" value={status?.probes.glAccounts?'Detectadas':'Pendiente'} note="Clasificación contable" tone={status?.probes.glAccounts?'good':'warn'}/><Metric label="Transacciones" value={status?.probes.transactions?'Detectadas':'Pendiente'} note="Encabezados financieros" tone={status?.probes.transactions?'good':'warn'}/></div>
      <section className="panel r365-card"><header><div><h2>Flujo contable verificable</h2><p>Las cifras avanzan por etapas y no se publican como P&L definitivo hasta completar la conciliación.</p></div><span className="count-pill">{rangeLabel(range.start,range.end).toUpperCase()}</span></header><div className="r365-roadmap"><button onClick={()=>setTab('P&L')}><span>01</span><strong>Ledger y clasificación</strong><p>Débitos, créditos y cuentas GL por locación.</p></button><button onClick={()=>setTab('Corporate Office')}><span>02</span><strong>Corporate Office</strong><p>Gastos directos separados de los restaurantes.</p></button><button onClick={()=>setTab('Facturas y AP')}><span>03</span><strong>Facturas AP</strong><p>Aprobación, vendor, locación y responsable.</p></button><button onClick={()=>setTab('Cuentas GL')}><span>04</span><strong>Conciliación</strong><p>Comparación contra el P&L oficial de R365.</p></button></div></section>
    </>:loading?<Loading detail={loadingDetail}/>:error?<ErrorState message={error} onRetry={retry}/>:tab==='P&L'&&activeLedger?<>
      <div className="r365-metrics-grid"><Metric label="Ingresos clasificados" value={money.format(activeLedger.totals.revenue+activeLedger.totals.otherIncome)} note="Créditos menos débitos"/><Metric label="COGS" value={money.format(activeLedger.totals.cogs)} note="Costo identificado en R365"/><Metric label="Labor" value={money.format(activeLedger.totals.labor)} note="Cuentas de nómina y labor"/><Metric label="Gastos operativos" value={money.format(activeLedger.totals.operatingExpense+activeLedger.totals.otherExpense)} note="Excluye balance general"/><Metric label="Resultado clasificado" value={money.format(activeLedger.totals.classifiedResult)} note="Preliminar, pendiente de conciliación" tone={activeLedger.quality.status==='ready-for-reconciliation'?'good':'warn'}/></div><QualityBanner ledger={activeLedger}/><GroupBars ledger={activeLedger}/><AccountTable ledger={activeLedger}/><LedgerTable ledger={activeLedger}/><SourceNote fetchedAt={activeLedger.fetchedAt} caveats={activeLedger.caveats}/>
    </>:tab==='Corporate Office'&&activeLedger?<>
      <div className="r365-metrics-grid"><Metric label="Gasto corporativo identificado" value={money.format(corporateSpend)} note="Sin distribución automática"/><Metric label="Facturas AP" value={String(activeLedger.totals.apInvoices)} note="Aprobadas en el periodo"/><Metric label="Transacciones aprobadas" value={String(activeLedger.totals.approvedTransactions)} note={`${activeLedger.totals.transactions} encabezados totales`}/><Metric label="Líneas contables" value={String(activeLedger.totals.detailRows)} note="Detalle GL recuperado"/><Metric label="Cobertura" value={activeLedger.quality.transactionDetailCoveragePct===null?'—':`${activeLedger.quality.transactionDetailCoveragePct}%`} note="Encabezados con detalle" tone={activeLedger.quality.status==='ready-for-reconciliation'?'good':'warn'}/></div><QualityBanner ledger={activeLedger}/><GroupBars ledger={activeLedger} corporate/><AccountTable ledger={activeLedger} corporate/><LedgerTable ledger={activeLedger} expensesOnly/><SourceNote fetchedAt={activeLedger.fetchedAt} caveats={activeLedger.caveats}/>
    </>:tab==='Facturas y AP'&&ap?<>
      <div className="r365-metrics-grid"><Metric label="Facturas AP" value={String(ap.totals.invoices)} note={rangeLabel(ap.period.start,addDays(ap.period.endExclusive,-1))}/><Metric label="Monto facturado" value={preciseMoney.format(ap.totals.amount)} note={`${ap.totals.invoices-ap.totals.invoicesWithoutAmount} invoices con monto`} tone={ap.totals.invoicesWithoutAmount?'warn':'good'}/><Metric label="Aprobadas" value={preciseMoney.format(ap.totals.approvedAmount)} note={`${ap.totals.approved} invoices${approvedWithoutAmount?` · ${approvedWithoutAmount} sin monto`:''}`} tone="good"/><Metric label="Pendientes" value={preciseMoney.format(ap.totals.pendingAmount)} note={`${ap.totals.pending} invoices${pendingWithoutAmount?` · ${pendingWithoutAmount} sin monto`:''}`} tone={ap.totals.pending?'warn':'good'}/><Metric label="Cobertura de montos" value={`${ap.totals.invoices-ap.totals.invoicesWithoutAmount} / ${ap.totals.invoices}`} note={ap.totals.invoicesWithoutAmount?'Requieren detalle de R365':'Todos los montos recuperados'} tone={ap.totals.invoicesWithoutAmount?'warn':'good'}/></div>
      {ap.totals.invoicesWithoutAmount>0&&<div className="r365-amount-warning" role="alert"><strong>{ap.totals.invoicesWithoutAmount} invoices todavía no entregaron importe desde R365</strong><span>OpsVista no los considera $0 ni los incluye en los totales. Los demás importes sí provienen del detalle contable de R365.</span></div>}
      <section className="panel r365-card r365-ap-card">
        <header><div><h2>Facturas AP</h2><p>La fecha del invoice determina la antigüedad; “Creada en R365” indica cuándo fue cargada. “Aprobada” no equivale a “pagada”.</p></div><span className="count-pill">{visibleInvoices.length} DE {ap.transactions.length} FACTURAS</span></header>
        <div className="r365-ap-toolbar">
          <label><span>LOCACIÓN</span><select value={invoiceEntity} onChange={event=>{setInvoiceEntity(event.target.value);setInvoiceVendor('All vendors');setSelectedInvoiceIds([]);setCopyNotice('');}}><option value="All entities">Todas las locaciones</option>{entities.map(item=><option key={item}>{item}</option>)}</select></label>
          <label><span>VENDOR</span><select value={invoiceVendor} onChange={event=>{setInvoiceVendor(event.target.value);setSelectedInvoiceIds([]);setCopyNotice('');}}><option value="All vendors">Todos los vendors</option>{invoiceVendorOptions.map(([vendor,count])=><option key={vendor} value={vendor}>{vendor} ({count})</option>)}</select></label>
          <label><span>ESTADO R365</span><select value={invoiceStatus} onChange={event=>{setInvoiceStatus(event.target.value as InvoiceStatusFilter);setSelectedInvoiceIds([]);setCopyNotice('');}}><option value="all">Todas</option><option value="pending">Pendientes</option><option value="approved">Aprobadas</option></select></label>
          <label className="r365-ap-search"><span>INVOICE / REFERENCIA</span><input value={search} onChange={event=>{setSearch(event.target.value);setSelectedInvoiceIds([]);setCopyNotice('');}} placeholder="Número de invoice o referencia…"/></label>
          <label><span>FECHA INVOICE · DESDE</span><input type="date" min={ap.period.start} max={invoiceDateEnd||addDays(ap.period.endExclusive,-1)} value={invoiceDateStart} onChange={event=>{const value=event.target.value;setInvoiceDateStart(value);if(invoiceDateEnd&&value>invoiceDateEnd)setInvoiceDateEnd(value);setSelectedInvoiceIds([]);setCopyNotice('');}}/></label>
          <label><span>FECHA INVOICE · HASTA</span><input type="date" min={invoiceDateStart||ap.period.start} max={addDays(ap.period.endExclusive,-1)} value={invoiceDateEnd} onChange={event=>{const value=event.target.value;setInvoiceDateEnd(value);if(invoiceDateStart&&value<invoiceDateStart)setInvoiceDateStart(value);setSelectedInvoiceIds([]);setCopyNotice('');}}/></label>
          <label><span>ORDENAR</span><select value={invoiceSort} onChange={event=>setInvoiceSort(event.target.value as InvoiceSort)}><option value="oldest">Fecha: más viejos</option><option value="newest">Fecha: más recientes</option><option value="created-oldest">Carga R365: más antigua</option><option value="created-newest">Carga R365: más reciente</option><option value="highest">Monto: mayor primero</option><option value="lowest">Monto: menor primero</option><option value="vendor">Vendor: A–Z</option><option value="invoice">Invoice: A–Z</option><option value="location">Locación: A–Z</option><option value="status">Estado: pendientes primero</option></select></label>
          <div className="r365-ap-visible"><span>RESULTADO VISIBLE</span><strong>{visibleInvoices.length} · {preciseMoney.format(visibleInvoiceAmount)}</strong>{visibleInvoicesWithoutAmount>0&&<small>{visibleInvoicesWithoutAmount} sin monto</small>}</div>
        </div>
        <div className="r365-ap-actions"><button type="button" onClick={toggleVisibleInvoices} disabled={!visibleInvoices.length}>{allVisibleSelected?'Quitar selección visible':'Seleccionar todas las visibles'}</button><button type="button" className="primary" onClick={()=>void copyInvoiceFollowUp()} disabled={!visibleInvoices.length}>{selectedInvoiceIds.length?`Copiar ${selectedInvoiceIds.length} para Jonathan`:'Copiar visibles para Jonathan'}</button><button type="button" onClick={clearInvoiceFilters} disabled={!hasInvoiceFilters}>Limpiar filtros</button>{selectedInvoices.length>0&&<strong>{selectedInvoices.length} seleccionadas · {preciseMoney.format(selectedInvoiceAmount)}</strong>}{copyNotice&&<span role="status">{copyNotice}</span>}</div>
        <div className="r365-table-wrap"><table className="r365-ap-table"><thead><tr><th className="r365-check"><input type="checkbox" aria-label="Seleccionar todas las facturas visibles" checked={allVisibleSelected} onChange={toggleVisibleInvoices}/></th><SortableHeader label="Invoice" active={invoiceSort==='invoice'} direction="asc" onClick={()=>setInvoiceSort('invoice')}/><SortableHeader label="Fecha invoice" active={invoiceSort==='oldest'||invoiceSort==='newest'} direction={invoiceSort==='newest'?'desc':'asc'} onClick={()=>toggleInvoiceSort('oldest','newest')}/><th>Antigüedad</th><SortableHeader label="Creada en R365" active={invoiceSort==='created-oldest'||invoiceSort==='created-newest'} direction={invoiceSort==='created-newest'?'desc':'asc'} onClick={()=>toggleInvoiceSort('created-oldest','created-newest')}/><SortableHeader label="Vendor" active={invoiceSort==='vendor'} direction="asc" onClick={()=>setInvoiceSort('vendor')}/><SortableHeader label="Locación" active={invoiceSort==='location'} direction="asc" onClick={()=>setInvoiceSort('location')}/><SortableHeader label="Monto" active={invoiceSort==='highest'||invoiceSort==='lowest'} direction={invoiceSort==='highest'?'desc':'asc'} onClick={()=>toggleInvoiceSort('lowest','highest')}/><SortableHeader label="Estado R365" active={invoiceSort==='status'} direction="asc" onClick={()=>setInvoiceSort('status')}/></tr></thead><tbody>{visibleInvoices.slice(0,500).map(row=><tr key={row.id} className={selectedInvoiceSet.has(row.id)?'selected':''}><td className="r365-check"><input type="checkbox" aria-label={`Seleccionar factura ${row.number||row.name}`} checked={selectedInvoiceSet.has(row.id)} onChange={()=>toggleInvoice(row.id)}/></td><td><strong>{row.number||row.name}</strong><small>{row.name!==row.number?row.name:'AP Invoice'}</small></td><td><strong>{dateLabel(row.date)}</strong></td><td><span className="r365-age">{invoiceAgeLabel(row.date)}</span></td><td><strong>{dateTimeLabel(row.createdOn)}</strong><small>{row.createdBy?`Cargada por ${row.createdBy}`:'Usuario no disponible'}</small></td><td>{row.vendor||'Sin vendor enlazado'}</td><td><strong>{row.entity||row.location}</strong><small>{row.location}</small></td><td className="amount">{row.amount===null?'No disponible':preciseMoney.format(row.amount)}</td><td><span className={`r365-status ${row.approved?'approved':'pending'}`}>{row.approved?'Aprobada':'Pendiente'}</span></td></tr>)}</tbody></table>{visibleInvoices.length>500&&<div className="r365-table-limit">Mostrando 500 de {visibleInvoices.length} facturas filtradas.</div>}{!visibleInvoices.length&&<div className="r365-empty">No se encontraron facturas con estos filtros.</div>}</div>
      </section><SourceNote fetchedAt={ap.fetchedAt} caveats={ap.caveats}/>
    </>:tab==='Vendors'&&catalog?<section className="panel r365-card"><header><div><h2>Directorio de vendors</h2><p>Catálogo leído directamente desde Company en Restaurant365.</p></div><input className="r365-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar vendor…"/></header><div className="r365-table-wrap"><table><thead><tr><th>Número</th><th>Vendor</th><th>Comentario</th></tr></thead><tbody>{vendors.slice(0,500).map(row=><tr key={row.id}><td>{row.number||'—'}</td><td><strong>{row.name}</strong></td><td>{row.comment||'—'}</td></tr>)}</tbody></table>{!vendors.length&&<div className="r365-empty">No hay vendors que coincidan con la búsqueda.</div>}</div></section>
    :tab==='Cuentas GL'&&catalog?<><section className="panel r365-card"><header><div><h2>Plan de cuentas GL</h2><p>Número, tipo y categoría operacional utilizados para construir la clasificación.</p></div><input className="r365-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar cuenta…"/></header><div className="r365-table-wrap"><table><thead><tr><th>Número</th><th>Cuenta</th><th>Tipo GL</th><th>Categoría operacional</th><th>Locación R365</th></tr></thead><tbody>{accounts.slice(0,750).map(row=><tr key={row.id}><td>{row.number||'—'}</td><td><strong>{row.name}</strong></td><td>{row.glType||'—'}</td><td>{row.operationalCategory||'—'}</td><td>{row.locationName||'Global'}</td></tr>)}</tbody></table>{!accounts.length&&<div className="r365-empty">No hay cuentas que coincidan con la búsqueda.</div>}</div></section>{catalog.caveats?.length?<SourceNote fetchedAt={catalog.fetchedAt} caveats={catalog.caveats}/>:null}</>:<Loading detail={loadingDetail}/>}
  </div>;
}
