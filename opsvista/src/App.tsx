import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { ExternalEscalation } from './actionCenterTypes';
import { canAccessLocation, currentAuthenticatedUser, permissionsFor, visibleLocations, type OpsVistaModule } from './accessControl';
import GoogleBusinessIntegrationPanel from './GoogleBusinessIntegrationPanel';

const RampComplianceView=lazy(()=>import('./RampComplianceView'));
const LaborIntelligenceView=lazy(()=>import('./LaborIntelligenceView'));
const EvidenceAuditView=lazy(()=>import('./EvidenceAuditView'));
const WeeklyBonusLivePanel=lazy(()=>import('./WeeklyBonusLivePanel'));
const AccessControlPanel=lazy(()=>import('./AccessControlPanel'));
const InvitationManager=lazy(()=>import('./InvitationManager'));
const ChangePasswordPanel=lazy(()=>import('./ChangePasswordPanel'));
const OperationalOverview=lazy(()=>import('./OperationalOverview'));
const LocationDashboard=lazy(()=>import('./LocationDashboard'));
const LocalIntelligenceView=lazy(()=>import('./LocalIntelligenceView'));
const TransferLedgerView=lazy(()=>import('./TransferLedgerView'));
const PaymentRequestsView=lazy(()=>import('./PaymentRequestsView'));
const ActionCenterView=lazy(()=>import('./ActionCenterView'));
const ProjectsView=lazy(()=>import('./ProjectsView'));
const allLocations=['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
const icon:Record<string,string>={Resumen:'⌂',Locaciones:'▦',Ventas:'↗','Local Intelligence':'⌁',Finanzas:'▥',Gastos:'$',Horarios:'◷',Tasks:'☑','Bono semanal':'★','Action Center':'⚡',Proyectos:'◆',Prioridades:'⚑',Pagos:'$',Transferencias:'⇄',Configuración:'⚙'};

function storedSection(){
  if(typeof window==='undefined')return null;
  try{return window.localStorage.getItem('opsvista-section')??window.sessionStorage.getItem('opsvista-section');}
  catch{return null;}
}

function rememberSection(section:OpsVistaModule){
  try{window.sessionStorage.setItem('opsvista-section',section);window.localStorage.setItem('opsvista-section',section);}catch{/* Storage can be unavailable in restrictive Safari sessions. */}
}

export default function App(){
  const [currentUser]=useState(currentAuthenticatedUser);
  const permissions=permissionsFor(currentUser);
  const allowedLocations=useMemo(()=>visibleLocations(currentUser,allLocations),[currentUser]);
  const nav=permissions.modules;
  const [section,setSection]=useState<OpsVistaModule>(()=>{const integration=typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('integration');const saved=storedSection();return (integration&&permissions.modules.includes('Configuración')?'Configuración':saved&&permissions.modules.includes(saved as OpsVistaModule)?saved:'Resumen') as OpsVistaModule;});
  const [search,setSearch]=useState('');

  useEffect(()=>{if(!nav.includes(section))setSection(nav.includes('Resumen')?'Resumen':nav[0]);},[currentUser]);
  useEffect(()=>{rememberSection(section)},[section]);

  const escalateExternal=(item:ExternalEscalation,category:string)=>{if(!permissions.canEscalateActions||!canAccessLocation(currentUser,item.location))return;const automationKey=item.automationKey||`external::${category}::${item.location}::${item.title}::${item.signal}`;void fetch('/api/workflows?resource=actions',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,category,automationKey,automated:true,priorityScore:item.priorityScore??(item.severity==='High'?80:item.severity==='Medium'?50:25),sources:item.sources??[category],detectedAt:item.detectedAt??new Date().toISOString()})}).then(async response=>{const body=await response.json().catch(()=>({})) as {error?:string};if(!response.ok)throw new Error(body.error||'Action could not be saved');setSection('Action Center');setSearch('')}).catch(error=>window.alert(error instanceof Error?error.message:'Action could not be saved'));};
  const logout=async()=>{try{await fetch('/api/auth/logout',{method:'POST',credentials:'include'})}finally{window.location.assign('/')}};
  const refreshData=()=>{rememberSection(section);window.location.reload()};

  const isOverview=section==='Resumen'||section==='Ventas';
  const isLocations=section==='Locaciones';
  const isLocalIntelligence=section==='Local Intelligence';
  const isRamp=section==='Gastos';
  const isLabor=section==='Horarios';
  const isEvidence=section==='Tasks';
  const isBonus=section==='Bono semanal';
  const isPriorities=section==='Prioridades';
  const isActionCenter=section==='Action Center'||isPriorities;
  const isProjects=section==='Proyectos';
  const isFinance=section==='Finanzas';
  const isPayments=section==='Pagos'||isFinance;
  const isTransfers=section==='Transferencias';
  const isSettings=section==='Configuración';
  const eyebrow=isOverview?'OPERATING PERFORMANCE':isLocations?'MULTI-LOCATION PERFORMANCE':isLocalIntelligence?'EXTERNAL OPERATING SIGNALS':isRamp?'FINANCIAL ACCOUNTABILITY':isLabor?'WORKFORCE INTELLIGENCE':isEvidence?'OPERATIONAL VERIFICATION':isBonus?'PERFORMANCE INCENTIVES':isPriorities?'OPERATIONAL PRIORITIES':isActionCenter?'OPERATIONAL ACCOUNTABILITY':isProjects?'PROJECT PORTFOLIO':isFinance?'FINANCIAL CONTROL':isPayments?'PAYMENT CONTROL':isTransfers?'INVENTORY CHAIN OF CUSTODY':isSettings?'ACCESS & SECURITY':'OPERATIONAL INTELLIGENCE';
  const title=isOverview?(section==='Ventas'?'Ventas · Performance':'Resumen · Operating Performance'):isLocations?'Locaciones · Performance Dashboard':isLocalIntelligence?'Local Intelligence':isRamp?'Gastos Ramp':isLabor?'Horarios · Labor Intelligence':isEvidence?'Tasks · 7shifts & Logbook':isBonus?'Bono semanal':isPriorities?'Prioridades · Action Center':isActionCenter?'Action Center':isProjects?'Proyectos':isFinance?'Finanzas · Control de pagos':isPayments?'Pagos · Approval Workflow':isTransfers?'Transferencias · Restaurant Ledger':isSettings?'Configuración · Roles & Permissions':section;
  const subtitle=isOverview?'Ventas, labor, task compliance, voids y descuentos en una sola vista operativa.':isLocations?'Compara el desempeño completo de cada restaurante con datos reales de Toast, 7shifts y OpsVista.':isLocalIntelligence?'Clima, tráfico, incidentes y eventos cercanos convertidos en impacto y recomendaciones por restaurante.':isRamp?'Cada gasto debe mostrar quién lo hizo, dónde pertenece, por qué se hizo y contar con la evidencia requerida.':isLabor?'Compara ventas, forecast, labor, SPLH y overtime para convertir desviaciones en acciones con impacto financiero.':isEvidence?'Controla Tasks, responsables y Logbook por ubicación y periodo.':isBonus?'Scorecard semanal con Tasks, descuentos, voids, overtime y reglas de elegibilidad.':isPriorities?'Muestra las acciones persistentes que requieren atención, ordenadas por prioridad y dentro del alcance autorizado.':isActionCenter?'Convierte señales operativas en acciones asignadas, verificables y guardadas permanentemente.':isProjects?'Planifica iniciativas con responsables, fechas, milestones, presupuesto y resultados sin mezclarlas con alertas operativas.':isFinance?'Usa el flujo real de solicitudes, aprobaciones y emisión de pagos con bitácora completa.':isPayments?'Managers solicitan; Corporate aprueba; Administration emite únicamente pagos aprobados, con bitácora completa.':isTransfers?'Registra qué salió, qué llegó, quién recibió, a qué hora y cualquier faltante o diferencia entre restaurantes.':isSettings?'Controla acceso, credenciales, usuarios y permisos.':'La fuente de este módulo no está disponible.';

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">OV</div><div><strong>OpsVista</strong><span>OPERATIONS CENTER</span><small>Account OPS-0001</small></div></div>
      <nav>{nav.map(item=><button key={item} className={section===item?'active':''} onClick={()=>setSection(item)}><span className="nav-icon">{icon[item]}</span>{item}</button>)}</nav>
      <div className="user-card"><div className="avatar">{currentUser.name.split(' ').map(x=>x[0]).join('').slice(0,2)}</div><div><strong>{currentUser.name}</strong><span>{currentUser.role} · {permissions.allLocations?'All locations':currentUser.locations.join(', ')}</span></div></div>
    </aside>

    <main>
      <header className="topbar">
        <div className="search-wrap"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar en OpsVista..."/></div>
        <div className="top-actions"><button onClick={refreshData}>↻ Actualizar datos</button><button className="danger-outline" onClick={logout}>Cerrar sesión</button><div className="avatar small">{currentUser.name.split(' ').map(x=>x[0]).join('').slice(0,2)}</div></div>
      </header>

      <div className="page">
        <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div></div>

        <Suspense fallback={<section className="panel"><div className="panel-header"><div><h2>Cargando módulo</h2><p>Preparando la vista solicitada…</p></div><span className="count-pill">CARGANDO</span></div></section>}>
          {isOverview?<OperationalOverview allowedLocations={allowedLocations} allLocations={permissions.allLocations}/>:isLocations?<LocationDashboard allowedLocations={allowedLocations} allLocations={permissions.allLocations} onOpenTasks={()=>setSection('Tasks')} onOpenLabor={()=>setSection('Horarios')}/>:isLocalIntelligence?<LocalIntelligenceView allowedLocations={allowedLocations}/>:isActionCenter?<ActionCenterView currentUser={currentUser} allowedLocations={allowedLocations}/>:isProjects?<ProjectsView currentUser={currentUser} allowedLocations={allowedLocations} canSeeFinancialImpact={permissions.canSeeFinancialImpact}/>:isPayments?<PaymentRequestsView currentUser={currentUser} allowedLocations={allowedLocations}/>:isTransfers?<TransferLedgerView/>:isSettings?<>{permissions.canManageIntegrations&&<GoogleBusinessIntegrationPanel/>}<ChangePasswordPanel/><InvitationManager currentUser={currentUser}/><AccessControlPanel currentUser={currentUser}/></>:isRamp?<RampComplianceView onEscalate={permissions.canEscalateActions?item=>escalateExternal(item,'Ramp Compliance'):undefined}/>:isLabor?<LaborIntelligenceView allowedLocations={allowedLocations} onEscalate={permissions.canEscalateActions?item=>escalateExternal(item,'Labor Intelligence'):undefined}/>:isBonus?<WeeklyBonusLivePanel allowedLocations={permissions.allLocations?undefined:allowedLocations} canImportReviews={currentUser.role==='Founder'||currentUser.role==='Corporate'}/>:isEvidence?<EvidenceAuditView allowedLocations={permissions.allLocations?undefined:allowedLocations} canReview={permissions.canReviewEvidence} reviewerName={currentUser.name} onEscalate={permissions.canEscalateActions?item=>escalateExternal(item,'Evidence Audit'):undefined}/>:<section className="panel"><div className="panel-header"><div><h2>Fuente no disponible</h2><p>OpsVista no mostrará cifras de prueba. Este módulo se habilitará cuando tenga una fuente real verificada.</p></div><span className="count-pill">PENDIENTE</span></div></section>}
        </Suspense>
      </div>
    </main>
  </div>
}
