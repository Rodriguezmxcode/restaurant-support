import { useEffect, useMemo, useState } from 'react';
import Restaurant365IntegrationPanel from './Restaurant365IntegrationPanel';
import './restaurant365.css';

type Tab='Resumen'|'P&L'|'Facturas y AP'|'Corporate Office'|'Vendors'|'Cuentas GL'|'Conexión';
type Classification='Revenue'|'COGS'|'Labor'|'Operating Expense'|'Other Income'|'Other Expense'|'Balance Sheet'|'Unclassified';
type Status={
  configured:boolean;connected:boolean;mappedLocationCount:number;mappedRestaurantCount:number;corporateMapped:boolean;pnlReady:boolean;
  checkedAt?:string;latestTransactionAt?:string;error?:string;
  probes:{locations:boolean;glAccounts:boolean;transactions:boolean};
};
type Transaction={id:string;date:string;number?:string;name:string;type:string;approved:boolean;location:string;entity?:string;vendor?:string;createdBy?:string};
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
type ApSnapshot={period:{month:string;start:string;endExclusive:string};fetchedAt:string;transactions:Transaction[];totals:{invoices:number;approved:number;pending:number;vendors:number;locations:number};caveats:string[]};
type Catalog={fetchedAt:string;vendors?:Array<{id:string;number?:string;name:string;comment?:string}>;accounts?:Account[]};

const tabs:Tab[]=['Resumen','P&L','Facturas y AP','Corporate Office','Vendors','Cuentas GL','Conexión'];
const entities=['Stamford','Orange','Fairfield','Danbury','Avon','Southington','Corporate Office'];
const classLabels:Record<Classification,string>={Revenue:'Ingresos',COGS:'COGS',Labor:'Labor','Operating Expense':'Gastos operativos','Other Income':'Otros ingresos','Other Expense':'Otros gastos','Balance Sheet':'Balance general',Unclassified:'Sin clasificar'};
const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const preciseMoney=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2});

function lastCompleteMonth(){const now=new Date();return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,1)).toISOString().slice(0,7);}
function monthLabel(month:string){const [year,value]=month.split('-').map(Number);return new Intl.DateTimeFormat('es-MX',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(year,value-1,1)));}
function dateLabel(value:string){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('es-MX',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(date);}
async function requestJson<T>(url:string,signal?:AbortSignal){const response=await fetch(url,{credentials:'include',cache:'no-store',signal});const body=await response.json().catch(()=>({})) as T&{error?:string};if(!response.ok)throw new Error(body.error||'Restaurant365 no pudo entregar la información.');return body;}

function Loading(){return <section className="panel r365-state"><span className="r365-spinner"/><strong>Consultando Restaurant365…</strong><p>La primera lectura del mes puede tardar mientras se unen transacciones, detalles y cuentas GL.</p></section>}
function ErrorState({message,onRetry}:{message:string;onRetry:()=>void}){return <section className="panel r365-state error"><strong>No se pudo completar esta vista</strong><p>{message}</p><button type="button" onClick={onRetry}>Intentar nuevamente</button></section>}
function QualityBanner({ledger}:{ledger:Ledger}){const ready=ledger.quality.status==='ready-for-reconciliation';return <div className={`r365-quality ${ready?'ready':'warning'}`}><div><strong>{ready?'Datos listos para conciliación':'La revisión de calidad está incompleta'}</strong><span>{ledger.quality.transactionDetailCoveragePct===null?'Sin transacciones aprobadas':`${ledger.quality.transactionDetailCoveragePct}% de transacciones aprobadas con detalle`}</span></div><div><span>Sin detalle <strong>{ledger.quality.transactionsWithoutDetails}</strong></span><span>GL sin match <strong>{ledger.quality.detailsWithoutGlAccount}</strong></span><span>Sin clasificar <strong>{ledger.quality.unclassifiedDetailRows}</strong></span><span>Duplicados <strong>{ledger.quality.duplicateTransactionIds+ledger.quality.duplicateDetailIds}</strong></span></div></div>}
function SourceNote({fetchedAt,caveats}:{fetchedAt:string;caveats:string[]}){return <div className="r365-source-note"><strong>Fuente: Restaurant365 OData · solo lectura</strong><span>Actualizado {new Date(fetchedAt).toLocaleString('es-MX')}</span><ul>{caveats.map(item=><li key={item}>{item}</li>)}</ul></div>}
function Metric({label,value,note,tone}:{label:string;value:string;note:string;tone?:'good'|'warn'|'neutral'}){return <article className={`r365-metric ${tone||'neutral'}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>}

function GroupBars({ledger,corporate=false}:{ledger:Ledger;corporate?:boolean}){
  const allowed:Classification[]=corporate?['Labor','Operating Expense','Other Expense','COGS']:['Revenue','COGS','Labor','Operating Expense','Other Income','Other Expense'];
  const groups=allowed.map(key=>ledger.groups.find(group=>group.classification===key)||{classification:key,amount:0,accountCount:0});
  const max=Math.max(...groups.map(group=>Math.abs(group.amount)),1);
  return <section className="panel r365-card"><header><div><h2>{corporate?'Composición de gastos corporativos':'Actividad P&L clasificada'}</h2><p>Importes derivados de débitos y créditos aprobados, agrupados mediante los tipos GL de R365.</p></div><span className="count-pill">{monthLabel(ledger.period.month)}</span></header><div className="r365-bars">{groups.map(group=><div key={group.classification} className="r365-bar-row"><div><strong>{classLabels[group.classification]}</strong><span>{group.accountCount} cuentas</span></div><div className="r365-bar-track"><i style={{width:`${Math.max(2,Math.abs(group.amount)/max*100)}%`}}/></div><strong>{preciseMoney.format(group.amount)}</strong></div>)}</div></section>;
}

function AccountTable({ledger,corporate=false}:{ledger:Ledger;corporate?:boolean}){
  const rows=corporate?ledger.accounts.filter(account=>['COGS','Labor','Operating Expense','Other Expense'].includes(account.classification)):ledger.accounts;
  return <section className="panel r365-card"><header><div><h2>{corporate?'Cuentas de gasto de la oficina':'Detalle por cuenta GL'}</h2><p>Ordenado por mayor impacto dentro del periodo seleccionado.</p></div><span className="count-pill">{rows.length} CUENTAS</span></header><div className="r365-table-wrap"><table><thead><tr><th>Cuenta</th><th>Clasificación</th><th>Débito</th><th>Crédito</th><th>{corporate?'Gasto':'Importe P&L'}</th><th>Líneas</th></tr></thead><tbody>{rows.slice(0,100).map(account=><tr key={account.id}><td><strong>{account.number||'—'} · {account.name}</strong><small>{account.glType||'Sin tipo GL'} · {account.operationalCategory||'Sin categoría operacional'}</small></td><td><span className={`r365-class ${account.classification.toLowerCase().replaceAll(' ','-')}`}>{classLabels[account.classification]}</span></td><td>{preciseMoney.format(account.debit)}</td><td>{preciseMoney.format(account.credit)}</td><td className="amount">{preciseMoney.format(account.pnlAmount)}</td><td>{account.lineCount}</td></tr>)}</tbody></table>{!rows.length&&<div className="r365-empty">No se detectaron cuentas para esta selección.</div>}</div></section>;
}

function LedgerTable({ledger,expensesOnly=false}:{ledger:Ledger;expensesOnly?:boolean}){
  const rows=expensesOnly?ledger.rows.filter(row=>['COGS','Labor','Operating Expense','Other Expense'].includes(row.classification)):ledger.rows;
  return <section className="panel r365-card"><header><div><h2>{expensesOnly?'Movimientos corporativos':'Movimientos del ledger'}</h2><p>Cada importe conserva la transacción, vendor y cuenta GL de origen.</p></div><span className="count-pill">{rows.length} LÍNEAS</span></header><div className="r365-table-wrap"><table><thead><tr><th>Fecha / referencia</th><th>Vendor / descripción</th><th>Cuenta GL</th><th>Débito</th><th>Crédito</th></tr></thead><tbody>{rows.slice(0,200).map(row=><tr key={row.id}><td><strong>{dateLabel(row.date)}</strong><small>{row.transactionNumber||'Sin referencia'} · {row.transactionType}</small></td><td><strong>{row.vendor||row.transactionName}</strong><small>{row.comment||row.transactionName}</small></td><td><strong>{row.accountNumber||'—'} · {row.accountName}</strong><small>{classLabels[row.classification]}</small></td><td>{preciseMoney.format(row.debit)}</td><td>{preciseMoney.format(row.credit)}</td></tr>)}</tbody></table>{rows.length>200&&<div className="r365-table-limit">Mostrando 200 de {rows.length} líneas. Los cálculos utilizan todas las líneas recuperadas.</div>}{!rows.length&&<div className="r365-empty">No se detectaron movimientos aprobados para esta selección.</div>}</div></section>;
}

export default function Restaurant365View({canManageIntegrations}:{canManageIntegrations:boolean}){
  const [tab,setTab]=useState<Tab>('Resumen');
  const [month,setMonth]=useState(lastCompleteMonth);
  const [entity,setEntity]=useState('Stamford');
  const [status,setStatus]=useState<Status>();
  const [ledger,setLedger]=useState<Ledger>();
  const [ap,setAp]=useState<ApSnapshot>();
  const [catalog,setCatalog]=useState<Catalog>();
  const [search,setSearch]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [reload,setReload]=useState(0);

  useEffect(()=>{void requestJson<Status>('/api/integrations/restaurant365').then(body=>{setStatus(body);setError(body.error||'');}).catch(reason=>setError(reason instanceof Error?reason.message:'Restaurant365 no está disponible.'));},[reload]);
  useEffect(()=>{
    if(['Resumen','Conexión'].includes(tab))return;
    const controller=new AbortController();setLoading(true);setError('');setSearch('');
    const queryEntity=tab==='Corporate Office'?'Corporate Office':entity;
    const request=tab==='P&L'||tab==='Corporate Office'
      ?requestJson<Ledger>(`/api/integrations/restaurant365?view=ledger&month=${encodeURIComponent(month)}&entity=${encodeURIComponent(queryEntity)}`,controller.signal).then(setLedger)
      :tab==='Facturas y AP'?requestJson<ApSnapshot>(`/api/integrations/restaurant365?view=ap&month=${encodeURIComponent(month)}`,controller.signal).then(setAp)
      :requestJson<Catalog>(`/api/integrations/restaurant365?view=${tab==='Vendors'?'vendors':'accounts'}`,controller.signal).then(setCatalog);
    void request.catch(reason=>{if(reason instanceof DOMException&&reason.name==='AbortError')return;setError(reason instanceof Error?reason.message:'Restaurant365 no está disponible.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[tab,month,entity,reload]);

  const normalizedSearch=search.trim().toLowerCase();
  const vendors=useMemo(()=>catalog?.vendors?.filter(vendor=>!normalizedSearch||`${vendor.number||''} ${vendor.name} ${vendor.comment||''}`.toLowerCase().includes(normalizedSearch))||[],[catalog?.vendors,normalizedSearch]);
  const accounts=useMemo(()=>catalog?.accounts?.filter(account=>!normalizedSearch||`${account.number||''} ${account.name} ${account.glType||''} ${account.operationalCategory||''}`.toLowerCase().includes(normalizedSearch))||[],[catalog?.accounts,normalizedSearch]);
  const activeLedger=ledger&&ledger.period.month===month&&(tab==='Corporate Office'?ledger.entity==='Corporate Office':ledger.entity===entity)?ledger:undefined;
  const retry=()=>setReload(value=>value+1);
  const showPeriod=['P&L','Facturas y AP','Corporate Office'].includes(tab);
  const corporateSpend=activeLedger?activeLedger.totals.cogs+activeLedger.totals.labor+activeLedger.totals.operatingExpense+activeLedger.totals.otherExpense:0;

  return <div className="r365-page">
    <section className="panel r365-tabs" role="tablist" aria-label="Secciones de Restaurant365">{tabs.map(item=><button key={item} type="button" role="tab" aria-selected={tab===item} className={tab===item?'active':''} onClick={()=>setTab(item)}>{item}</button>)}</section>
    {showPeriod&&<section className="panel r365-controls"><label><span>PERIODO CONTABLE</span><input type="month" value={month} max={lastCompleteMonth()} onChange={event=>setMonth(event.target.value)}/></label>{tab==='P&L'&&<label><span>ENTIDAD</span><select value={entity} onChange={event=>setEntity(event.target.value)}>{entities.map(item=><option key={item}>{item}</option>)}</select></label>}<div><strong>{monthLabel(month)}</strong><span>{tab==='Corporate Office'?'Centro de costos de oficina':tab==='Facturas y AP'?'Facturas AP de las siete entidades':'Ledger aprobado por entidad'}</span></div></section>}

    {tab==='Conexión'?<Restaurant365IntegrationPanel canManage={canManageIntegrations}/>:tab==='Resumen'?<>
      {error&&<ErrorState message={error} onRetry={retry}/>}<div className="r365-metrics-grid"><Metric label="Conexión" value={status?.connected?'Activa':'Pendiente'} note="Restaurant365 OData · solo lectura" tone={status?.connected?'good':'warn'}/><Metric label="Restaurantes" value={`${status?.mappedRestaurantCount??'—'} / 6`} note="Locaciones operativas" tone={status?.mappedRestaurantCount===6?'good':'warn'}/><Metric label="Corporate Office" value={status?.corporateMapped?'Mapeada':'Pendiente'} note="Centro de costos" tone={status?.corporateMapped?'good':'warn'}/><Metric label="Cuentas GL" value={status?.probes.glAccounts?'Detectadas':'Pendiente'} note="Clasificación contable" tone={status?.probes.glAccounts?'good':'warn'}/><Metric label="Transacciones" value={status?.probes.transactions?'Detectadas':'Pendiente'} note="Encabezados financieros" tone={status?.probes.transactions?'good':'warn'}/></div>
      <section className="panel r365-card"><header><div><h2>Flujo contable verificable</h2><p>Las cifras avanzan por etapas y no se publican como P&L definitivo hasta completar la conciliación.</p></div><span className="count-pill">{monthLabel(month).toUpperCase()}</span></header><div className="r365-roadmap"><button onClick={()=>setTab('P&L')}><span>01</span><strong>Ledger y clasificación</strong><p>Débitos, créditos y cuentas GL por entidad.</p></button><button onClick={()=>setTab('Corporate Office')}><span>02</span><strong>Corporate Office</strong><p>Gastos directos separados de los restaurantes.</p></button><button onClick={()=>setTab('Facturas y AP')}><span>03</span><strong>Facturas AP</strong><p>Aprobación, vendor, locación y responsable.</p></button><button onClick={()=>setTab('Cuentas GL')}><span>04</span><strong>Conciliación</strong><p>Comparación contra el P&L oficial de R365.</p></button></div></section>
    </>:loading?<Loading/>:error?<ErrorState message={error} onRetry={retry}/>:tab==='P&L'&&activeLedger?<>
      <div className="r365-metrics-grid"><Metric label="Ingresos clasificados" value={money.format(activeLedger.totals.revenue+activeLedger.totals.otherIncome)} note="Créditos menos débitos"/><Metric label="COGS" value={money.format(activeLedger.totals.cogs)} note="Costo identificado en R365"/><Metric label="Labor" value={money.format(activeLedger.totals.labor)} note="Cuentas de nómina y labor"/><Metric label="Gastos operativos" value={money.format(activeLedger.totals.operatingExpense+activeLedger.totals.otherExpense)} note="Excluye balance general"/><Metric label="Resultado clasificado" value={money.format(activeLedger.totals.classifiedResult)} note="Preliminar, pendiente de conciliación" tone={activeLedger.quality.status==='ready-for-reconciliation'?'good':'warn'}/></div><QualityBanner ledger={activeLedger}/><GroupBars ledger={activeLedger}/><AccountTable ledger={activeLedger}/><LedgerTable ledger={activeLedger}/><SourceNote fetchedAt={activeLedger.fetchedAt} caveats={activeLedger.caveats}/>
    </>:tab==='Corporate Office'&&activeLedger?<>
      <div className="r365-metrics-grid"><Metric label="Gasto corporativo identificado" value={money.format(corporateSpend)} note="Sin distribución automática"/><Metric label="Facturas AP" value={String(activeLedger.totals.apInvoices)} note="Aprobadas en el periodo"/><Metric label="Transacciones aprobadas" value={String(activeLedger.totals.approvedTransactions)} note={`${activeLedger.totals.transactions} encabezados totales`}/><Metric label="Líneas contables" value={String(activeLedger.totals.detailRows)} note="Detalle GL recuperado"/><Metric label="Cobertura" value={activeLedger.quality.transactionDetailCoveragePct===null?'—':`${activeLedger.quality.transactionDetailCoveragePct}%`} note="Encabezados con detalle" tone={activeLedger.quality.status==='ready-for-reconciliation'?'good':'warn'}/></div><QualityBanner ledger={activeLedger}/><GroupBars ledger={activeLedger} corporate/><AccountTable ledger={activeLedger} corporate/><LedgerTable ledger={activeLedger} expensesOnly/><SourceNote fetchedAt={activeLedger.fetchedAt} caveats={activeLedger.caveats}/>
    </>:tab==='Facturas y AP'&&ap?<>
      <div className="r365-metrics-grid"><Metric label="Facturas AP" value={String(ap.totals.invoices)} note={monthLabel(ap.period.month)}/><Metric label="Aprobadas" value={String(ap.totals.approved)} note="Disponibles para el ledger" tone="good"/><Metric label="Pendientes" value={String(ap.totals.pending)} note="Requieren revisión en R365" tone={ap.totals.pending?'warn':'good'}/><Metric label="Vendors" value={String(ap.totals.vendors)} note="Con factura en el periodo"/><Metric label="Entidades" value={String(ap.totals.locations)} note="Restaurantes + Corporate"/></div><section className="panel r365-card"><header><div><h2>Facturas AP</h2><p>Aprobación contable, vendor y locación. “Aprobada” no equivale a “pagada”.</p></div><span className="count-pill">{ap.transactions.length} FACTURAS</span></header><div className="r365-table-wrap"><table><thead><tr><th>Fecha / factura</th><th>Vendor</th><th>Entidad</th><th>Creada por</th><th>Estado R365</th></tr></thead><tbody>{ap.transactions.slice(0,500).map(row=><tr key={row.id}><td><strong>{dateLabel(row.date)}</strong><small>{row.number||row.name}</small></td><td>{row.vendor||'Sin vendor enlazado'}</td><td><strong>{row.entity||row.location}</strong><small>{row.location}</small></td><td>{row.createdBy||'—'}</td><td><span className={`r365-status ${row.approved?'approved':'pending'}`}>{row.approved?'Aprobada':'Pendiente'}</span></td></tr>)}</tbody></table>{!ap.transactions.length&&<div className="r365-empty">No se encontraron facturas AP para este mes.</div>}</div></section><SourceNote fetchedAt={ap.fetchedAt} caveats={ap.caveats}/>
    </>:tab==='Vendors'&&catalog?<section className="panel r365-card"><header><div><h2>Directorio de vendors</h2><p>Catálogo leído directamente desde Company en Restaurant365.</p></div><input className="r365-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar vendor…"/></header><div className="r365-table-wrap"><table><thead><tr><th>Número</th><th>Vendor</th><th>Comentario</th></tr></thead><tbody>{vendors.slice(0,500).map(row=><tr key={row.id}><td>{row.number||'—'}</td><td><strong>{row.name}</strong></td><td>{row.comment||'—'}</td></tr>)}</tbody></table>{!vendors.length&&<div className="r365-empty">No hay vendors que coincidan con la búsqueda.</div>}</div></section>
    :tab==='Cuentas GL'&&catalog?<section className="panel r365-card"><header><div><h2>Plan de cuentas GL</h2><p>Número, tipo y categoría operacional utilizados para construir la clasificación.</p></div><input className="r365-search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="Buscar cuenta…"/></header><div className="r365-table-wrap"><table><thead><tr><th>Número</th><th>Cuenta</th><th>Tipo GL</th><th>Categoría operacional</th><th>Locación R365</th></tr></thead><tbody>{accounts.slice(0,750).map(row=><tr key={row.id}><td>{row.number||'—'}</td><td><strong>{row.name}</strong></td><td>{row.glType||'—'}</td><td>{row.operationalCategory||'—'}</td><td>{row.locationName||'Global'}</td></tr>)}</tbody></table>{!accounts.length&&<div className="r365-empty">No hay cuentas que coincidan con la búsqueda.</div>}</div></section>:<Loading/>}
  </div>;
}
