import { useEffect, useState } from 'react';
import Restaurant365IntegrationPanel from './Restaurant365IntegrationPanel';

type Tab='Resumen'|'P&L'|'Facturas y AP'|'Corporate Office'|'Vendors'|'Cuentas GL'|'Conexión';
type Status={
  configured:boolean;connected:boolean;mappedLocationCount:number;pnlReady:boolean;
  mappedRestaurantCount:number;corporateMapped:boolean;
  checkedAt?:string;latestTransactionAt?:string;error?:string;
  probes:{locations:boolean;glAccounts:boolean;transactions:boolean};
};

const tabs:Tab[]=['Resumen','P&L','Facturas y AP','Corporate Office','Vendors','Cuentas GL','Conexión'];

function PendingSource({title,copy,onConnect}:{title:string;copy:string;onConnect:()=>void}){
  return <section className="panel"><div style={{padding:26}}><span className="count-pill">FUENTE EN VALIDACIÓN</span><h2 style={{margin:'14px 0 6px'}}>{title}</h2><p style={{maxWidth:760,color:'#64748b',lineHeight:1.55}}>{copy}</p><button className="primary" onClick={onConnect}>Revisar conexión</button></div></section>;
}

export default function Restaurant365View({canManageIntegrations}:{canManageIntegrations:boolean}){
  const [tab,setTab]=useState<Tab>('Resumen');
  const [status,setStatus]=useState<Status>();
  const [error,setError]=useState('');

  useEffect(()=>{
    if(tab==='Conexión')return;
    void fetch('/api/integrations/restaurant365',{credentials:'include',cache:'no-store'})
      .then(async response=>{const body=await response.json().catch(()=>({})) as Status&{error?:string};if(!response.ok)throw new Error(body.error||'Restaurant365 no está disponible.');setStatus(body);setError(body.error||'');})
      .catch(reason=>setError(reason instanceof Error?reason.message:'Restaurant365 no está disponible.'));
  },[tab]);

  const ready=Boolean(status?.connected);
  const connectionTab=()=>setTab('Conexión');

  return <div style={{display:'grid',gap:16}}>
    <section className="panel" style={{overflow:'visible'}}>
      <div style={{display:'flex',gap:8,padding:'12px 14px',overflowX:'auto'}} role="tablist" aria-label="Secciones de Restaurant365">
        {tabs.map(item=><button key={item} type="button" role="tab" aria-selected={tab===item} className={tab===item?'primary':''} onClick={()=>setTab(item)} style={{whiteSpace:'nowrap',padding:'9px 12px',border:'1px solid #cbd8e7',borderRadius:9,background:'#f8fbff',color:'#264766',fontWeight:800,cursor:'pointer'}}>{item}</button>)}
      </div>
    </section>

    {tab==='Conexión'?<Restaurant365IntegrationPanel canManage={canManageIntegrations}/>:tab==='Resumen'?<>
      {error&&<div style={{padding:'12px 14px',border:'1px solid #fca5a5',borderRadius:10,background:'#fff1f2',color:'#991b1b'}}>{error}</div>}
      <div className="metrics-grid">
        <div className="metric-card"><div className="metric-label">CONEXIÓN</div><div className="metric-value" style={{fontSize:22}}>{ready?'Activa':'Pendiente'}</div><div className="metric-note">Restaurant365 OData · solo lectura</div></div>
        <div className="metric-card"><div className="metric-label">RESTAURANTES</div><div className="metric-value">{status?.mappedRestaurantCount??'—'}<span style={{fontSize:16,color:'#64748b'}}> / 6</span></div><div className="metric-note">Locaciones operativas</div></div>
        <div className="metric-card"><div className="metric-label">CORPORATE OFFICE</div><div className="metric-value" style={{fontSize:22}}>{status?.corporateMapped?'Mapeada':'Pendiente'}</div><div className="metric-note">Centro de costos de oficina</div></div>
        <div className="metric-card"><div className="metric-label">CUENTAS GL</div><div className="metric-value" style={{fontSize:22}}>{status?.probes.glAccounts?'Detectadas':'Pendiente'}</div><div className="metric-note">Clasificación contable</div></div>
        <div className="metric-card"><div className="metric-label">P&L</div><div className="metric-value" style={{fontSize:22}}>{status?.pnlReady?'Listo para mapear':'Bloqueado'}</div><div className="metric-note">No mostrará cifras sin reconciliación</div></div>
      </div>
      <section className="panel">
        <div className="panel-header"><div><h2>Fuentes contables</h2><p>Cada área se habilita únicamente cuando la evidencia correspondiente está validada.</p></div><span className="count-pill">R365</span></div>
        <div className="roadmap-grid">
          <div><span>01</span><strong>P&L por entidad</strong><p>Ingresos, COGS, labor, gastos operativos, EBITDA y comparación contra periodos anteriores.</p></div>
          <div><span>02</span><strong>Facturas y Accounts Payable</strong><p>Facturas AP, aprobación, vendor, fecha contable y excepciones que requieren seguimiento de Jonathan.</p></div>
          <div><span>03</span><strong>Corporate Office</strong><p>Gastos directos de oficina separados de la operación de los seis restaurantes.</p></div>
          <div><span>04</span><strong>Reconciliación</strong><p>Comparación OpsVista contra el P&L oficial de R365 antes de publicar resultados.</p></div>
        </div>
      </section>
    </>:tab==='P&L'?<PendingSource title="P&L por entidad" copy="Primero se validarán los seis restaurantes, Corporate Office y el plan de cuentas. Después se reconciliará un mes completo contra el reporte oficial de R365 antes de mostrar Net Sales, COGS, Labor, OPEX y EBITDA." onConnect={connectionTab}/>:tab==='Facturas y AP'?<PendingSource title="Facturas y Accounts Payable" copy="Esta vista usará transacciones tipo AP Invoice para controlar facturas aprobadas, fechas contables, vendors y responsables. El archivo del recibo y el estado exacto de pago se mostrarán únicamente cuando R365 los entregue mediante una fuente verificable." onConnect={connectionTab}/>:tab==='Corporate Office'?<PendingSource title="Gastos de Corporate Office" copy="Aquí se concentrarán renta, servicios, software, administración y demás gastos asignados directamente a la oficina. Las partidas corporativas permanecerán separadas y solo se distribuirán entre los seis restaurantes cuando exista una regla contable aprobada." onConnect={connectionTab}/>:tab==='Vendors'?<PendingSource title="Directorio de vendors" copy="La fuente de proveedores autorizada por R365 alimentará este catálogo. Se mantendrá separado de datos bancarios o credenciales de pago." onConnect={connectionTab}/>:<PendingSource title="Cuentas GL y clasificación" copy="Esta vista mostrará número, nombre, tipo y categoría operacional de cada cuenta para comprobar cómo se construye el P&L." onConnect={connectionTab}/>}
  </div>;
}
