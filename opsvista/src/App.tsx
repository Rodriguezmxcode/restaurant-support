import { useEffect, useMemo, useState } from 'react';
import RampComplianceView from './RampComplianceView';
import LaborIntelligenceView from './LaborIntelligenceView';
import EvidenceAuditView from './EvidenceAuditView';
import WeeklyBonusLivePanel from './WeeklyBonusLivePanel';
import OpsVistaCopilot from './OpsVistaCopilot';
import VerificationLoopPanel from './VerificationLoopPanel';
import AccessControlPanel from './AccessControlPanel';
import InvitationManager from './InvitationManager';
import ChangePasswordPanel from './ChangePasswordPanel';
import OperationalOverview from './OperationalOverview';
import LocationDashboard from './LocationDashboard';
import LocalIntelligenceView from './LocalIntelligenceView';
import TransferLedgerView from './TransferLedgerView';
import PaymentRequestsView from './PaymentRequestsView';
import ActionCenterView from './ActionCenterView';
import ProjectsView from './ProjectsView';
import type { ExternalEscalation } from './actionCenterTypes';
import { demoAutomationSignals, runActionRules, type SignalSource } from './actionRules';
import type { VerificationStatus } from './verificationLoop';
import { canAccessLocation, demoUsers, permissionsFor, visibleLocations, type OpsVistaModule } from './accessControl';

type Severity='High'|'Medium'|'Low';
type Status='Open'|'Assigned'|'Investigating'|'Completed'|'Dismissed';
type ActionItem={id:number;location:string;category:string;title:string;severity:Severity;status:Status;signal:string;cause:string;recommendation:string;impact:string;owner?:string;automationKey?:string;automated?:boolean;priorityScore?:number;sources?:SignalSource[];detectedAt?:string;verificationStatus?:VerificationStatus;verificationNote?:string;verifiedAt?:string};
const seededRules=runActionRules(demoAutomationSignals);
const initialActions:ActionItem[]=seededRules.actions.map((action,index)=>({...action,id:index+1,status:'Open',verificationStatus:'Pending'}));
const allLocations=['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
const icon:Record<string,string>={Resumen:'⌂',Locaciones:'▦',Ventas:'↗','Local Intelligence':'⌁',Finanzas:'▥',Gastos:'$',Horarios:'◷',Tasks:'☑','Bono semanal':'★','Action Center':'⚡',Proyectos:'◆',Prioridades:'⚑',Pagos:'$',Transferencias:'⇄',Configuración:'⚙'};

function Metric({label,value,note,tone}:{label:string;value:string;note:string;tone?:string}){return <div className="metric-card"><div className="metric-label">{label}</div><div className={`metric-value ${tone??''}`}>{value}</div><div className="metric-note">{note}</div></div>}

export default function App(){
  const [currentUser,setCurrentUser]=useState(demoUsers[0]);
  const permissions=permissionsFor(currentUser);
  const allowedLocations=useMemo(()=>visibleLocations(currentUser,allLocations),[currentUser]);
  const nav=permissions.modules;
  const [section,setSection]=useState<OpsVistaModule>(()=>{const saved=typeof window!=='undefined'?(window.localStorage.getItem('opsvista-section')??window.sessionStorage.getItem('opsvista-section')):null;return (saved&&permissions.modules.includes(saved as OpsVistaModule)?saved:'Resumen') as OpsVistaModule;});
  const [location,setLocation]=useState('All locations');
  const [actions,setActions]=useState(initialActions);
  const [selectedId,setSelectedId]=useState(initialActions[0]?.id??1);
  const [search,setSearch]=useState('');
  const [lastRuleRun,setLastRuleRun]=useState({evaluated:seededRules.evaluatedSignals,suppressed:seededRules.suppressedDuplicates,created:seededRules.actions.length});

  useEffect(()=>{if(!nav.includes(section))setSection(nav.includes('Resumen')?'Resumen':nav[0]);setLocation('All locations')},[currentUser]);
  useEffect(()=>{window.sessionStorage.setItem('opsvista-section',section);window.localStorage.setItem('opsvista-section',section)},[section]);

  const scopedActions=useMemo(()=>actions.filter(action=>canAccessLocation(currentUser,action.location)),[actions,currentUser]);
  const selected=scopedActions.find(a=>a.id===selectedId)??scopedActions[0];
  const filtered=useMemo(()=>scopedActions.filter(a=>{const inLocation=location==='All locations'||a.location===location;const q=search.trim().toLowerCase();const matches=!q||[a.location,a.category,a.title,a.signal,a.cause,a.owner].filter(Boolean).join(' ').toLowerCase().includes(q);return inLocation&&matches}).sort((a,b)=>(b.priorityScore??0)-(a.priorityScore??0)),[scopedActions,location,search]);
  const updateAction=(id:number,patch:Partial<ActionItem>)=>setActions(items=>items.map(item=>item.id===id?{...item,...patch}:item));
  const applyVerification=(id:number,status:VerificationStatus,note:string)=>{if(!permissions.canVerifyActions)return;updateAction(id,{verificationStatus:status,verificationNote:note,verifiedAt:new Date().toISOString(),status:status==='Worked'?'Completed':status==='Did not work'?'Investigating':'Assigned'})};
  const escalateExternal=(item:ExternalEscalation,category:string)=>{if(!permissions.canEscalateActions||!canAccessLocation(currentUser,item.location))return;const automationKey=item.automationKey||`external::${category}::${item.location}::${item.title}::${item.signal}`;void fetch('/api/workflows?resource=actions',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,category,automationKey,automated:true,priorityScore:item.priorityScore??(item.severity==='High'?80:item.severity==='Medium'?50:25),sources:item.sources??[category],detectedAt:item.detectedAt??new Date().toISOString()})}).then(async response=>{const body=await response.json().catch(()=>({})) as {error?:string};if(!response.ok)throw new Error(body.error||'Action could not be saved');setSection('Action Center');setLocation('All locations');setSearch('')}).catch(error=>window.alert(error instanceof Error?error.message:'Action could not be saved'));};
  const runRulesNow=()=>{if(!permissions.canRunAutomation)return;const result=runActionRules(demoAutomationSignals.filter(signal=>canAccessLocation(currentUser,signal.location)),actions);if(result.actions.length)setActions(items=>{let nextId=Math.max(0,...items.map(a=>a.id));return [...items,...result.actions.map(action=>({...action,id:++nextId,status:'Open' as const,verificationStatus:'Pending' as const}))]});setLastRuleRun({evaluated:result.evaluatedSignals,suppressed:result.suppressedDuplicates,created:result.actions.length})};
  const logout=async()=>{try{await fetch('/api/auth/logout',{method:'POST',credentials:'include'})}finally{window.location.assign('/')}};
  const refreshData=()=>{window.sessionStorage.setItem('opsvista-section',section);window.localStorage.setItem('opsvista-section',section);window.location.reload()};

  const openCount=scopedActions.filter(a=>!['Completed','Dismissed'].includes(a.status)).length;
  const highCount=scopedActions.filter(a=>a.severity==='High'&&!['Completed','Dismissed'].includes(a.status)).length;
  const autoCount=scopedActions.filter(a=>a.automated&&!['Completed','Dismissed'].includes(a.status)).length;
  const verifiedCount=scopedActions.filter(a=>a.verificationStatus==='Worked').length;
  const failedVerificationCount=scopedActions.filter(a=>a.verificationStatus==='Did not work').length;

  const isOverview=section==='Resumen'||section==='Ventas';
  const isLocations=section==='Locaciones';
  const isLocalIntelligence=section==='Local Intelligence';
  const isRamp=section==='Gastos';
  const isLabor=section==='Horarios';
  const isEvidence=section==='Tasks';
  const isBonus=section==='Bono semanal';
  const isActionCenter=section==='Action Center';
  const isProjects=section==='Proyectos';
  const isPayments=section==='Pagos';
  const isTransfers=section==='Transferencias';
  const isSettings=section==='Configuración';
  const isDedicated=isOverview||isLocations||isLocalIntelligence||isRamp||isLabor||isEvidence||isBonus||isActionCenter||isProjects||isPayments||isTransfers||isSettings;
  const eyebrow=isOverview?'OPERATING PERFORMANCE':isLocations?'MULTI-LOCATION PERFORMANCE':isLocalIntelligence?'EXTERNAL OPERATING SIGNALS':isRamp?'FINANCIAL ACCOUNTABILITY':isLabor?'WORKFORCE INTELLIGENCE':isEvidence?'OPERATIONAL VERIFICATION':isBonus?'PERFORMANCE INCENTIVES':isActionCenter?'OPERATIONAL ACCOUNTABILITY':isProjects?'PROJECT PORTFOLIO':isPayments?'PAYMENT CONTROL':isTransfers?'INVENTORY CHAIN OF CUSTODY':isSettings?'ACCESS & SECURITY':'OPERATIONAL INTELLIGENCE';
  const title=isOverview?(section==='Ventas'?'Ventas · Performance':'Resumen · Operating Performance'):isLocations?'Locaciones · Performance Dashboard':isLocalIntelligence?'Local Intelligence':isRamp?'Gastos Ramp':isLabor?'Horarios · Labor Intelligence':isEvidence?'Tasks · 7shifts & Logbook':isBonus?'Bono semanal':isActionCenter?'Action Center':isProjects?'Proyectos':isPayments?'Pagos · Approval Workflow':isTransfers?'Transferencias · Restaurant Ledger':isSettings?'Configuración · Roles & Permissions':section;
  const subtitle=isOverview?'Ventas, labor, task compliance, voids y descuentos en una sola vista operativa.':isLocations?'Compara el desempeño completo de cada restaurante con datos reales de Toast, 7shifts y OpsVista.':isLocalIntelligence?'Clima, tráfico, incidentes y eventos cercanos convertidos en impacto y recomendaciones por restaurante.':isRamp?'Cada gasto debe mostrar quién lo hizo, dónde pertenece, por qué se hizo y contar con la evidencia requerida.':isLabor?'Compara ventas, forecast, labor, SPLH y overtime para convertir desviaciones en acciones con impacto financiero.':isEvidence?'Controla Tasks, responsables y Logbook por ubicación y periodo.':isBonus?'Scorecard semanal con Tasks, descuentos, voids, overtime y reglas de elegibilidad.':isActionCenter?'Convierte señales operativas en acciones asignadas, verificables y guardadas permanentemente.':isProjects?'Planifica iniciativas con responsables, fechas, milestones, presupuesto y resultados sin mezclarlas con alertas operativas.':isPayments?'Managers solicitan; Corporate aprueba; Administration emite únicamente pagos aprobados, con bitácora completa.':isTransfers?'Registra qué salió, qué llegó, quién recibió, a qué hora y cualquier faltante o diferencia entre restaurantes.':isSettings?'Controla acceso, credenciales, usuarios y permisos.':'Detecta qué requiere atención, entiende la causa y convierte la señal en una acción verificable.';

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">OV</div><div><strong>OpsVista</strong><span>OPERATIONS CENTER</span><small>Account OPS-0001</small></div></div>
      <nav>{nav.map(item=><button key={item} className={section===item?'active':''} onClick={()=>setSection(item)}><span className="nav-icon">{icon[item]}</span>{item}</button>)}</nav>
      <div className="user-card"><div className="avatar">{currentUser.name.split(' ').map(x=>x[0]).join('').slice(0,2)}</div><div><strong>{currentUser.name}</strong><span>{currentUser.role} · {permissions.allLocations?'All locations':currentUser.locations.join(', ')}</span></div></div>
    </aside>

    <main>
      <header className="topbar">
        <div className="search-wrap"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={isDedicated?'Buscar en OpsVista...':'Buscar incidente, ubicación o responsable...'}/></div>
        <div className="top-actions"><select value={currentUser.id} onChange={e=>setCurrentUser(demoUsers.find(u=>u.id===e.target.value)??currentUser)} title="Preview role access">{demoUsers.map(user=><option key={user.id} value={user.id}>{user.role}</option>)}</select><button onClick={refreshData}>↻ Actualizar datos</button><button className="danger-outline" onClick={logout}>Cerrar sesión</button><div className="avatar small">{currentUser.name.split(' ').map(x=>x[0]).join('').slice(0,2)}</div></div>
      </header>

      <div className="page">
        <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{!isDedicated&&<div className="filters"><select value={location} onChange={e=>setLocation(e.target.value)}><option>All locations</option>{allowedLocations.map(loc=><option key={loc}>{loc}</option>)}</select>{permissions.canEscalateActions&&<button className="primary">+ Nueva acción</button>}</div>}</div>

        {isOverview?<OperationalOverview allowedLocations={allowedLocations} allLocations={permissions.allLocations}/>:isLocations?<LocationDashboard allowedLocations={allowedLocations} allLocations={permissions.allLocations} onOpenTasks={()=>setSection('Tasks')} onOpenLabor={()=>setSection('Horarios')}/>:isLocalIntelligence?<LocalIntelligenceView allowedLocations={allowedLocations}/>:isActionCenter?<ActionCenterView currentUser={currentUser} allowedLocations={allowedLocations}/>:isProjects?<ProjectsView currentUser={currentUser} allowedLocations={allowedLocations} canSeeFinancialImpact={permissions.canSeeFinancialImpact}/>:isPayments?<PaymentRequestsView currentUser={currentUser} allowedLocations={allowedLocations}/>:isTransfers?<TransferLedgerView/>:isSettings?<><ChangePasswordPanel/><InvitationManager currentUser={currentUser}/><AccessControlPanel currentUser={currentUser} onChangeUser={setCurrentUser}/></>:isRamp?<RampComplianceView onEscalate={permissions.canEscalateActions?item=>escalateExternal(item,'Ramp Compliance'):undefined}/>:isLabor?<LaborIntelligenceView allowedLocations={allowedLocations} onEscalate={permissions.canEscalateActions?item=>escalateExternal(item,'Labor Intelligence'):undefined}/>:isBonus?<WeeklyBonusLivePanel allowedLocations={permissions.allLocations?undefined:allowedLocations}/>:isEvidence?<EvidenceAuditView allowedLocations={permissions.allLocations?undefined:allowedLocations} canReview={permissions.canReviewEvidence} reviewerName={currentUser.name} onEscalate={permissions.canEscalateActions?item=>escalateExternal(item,'Evidence Audit'):undefined}/>:<>
          <section className="metrics-grid">
            <Metric label="ACCESS SCOPE" value={permissions.allLocations?'All':String(allowedLocations.length)} note={permissions.allLocations?'All locations authorized':`${allowedLocations.join(', ')||'No locations'} only`}/>
            <Metric label="AUTO ACTIONS" value={String(autoCount)} note={`${lastRuleRun.suppressed} duplicates suppressed`}/>
            <Metric label="VERIFIED WORKED" value={String(verifiedCount)} note="Closed with follow-up evidence"/>
            <Metric label="FAILED VERIFICATION" value={String(failedVerificationCount)} note="Returned to investigation" tone={failedVerificationCount?'warn':''}/>
            <Metric label="OPEN ACTIONS" value={String(openCount)} note={`${highCount} high priority`} tone={highCount?'warn':''}/>
          </section>
          {permissions.canUseCopilot&&<OpsVistaCopilot actions={scopedActions} selected={selected}/>} 
          {permissions.canRunAutomation&&<section className="panel" style={{marginBottom:16}}><div className="panel-header"><div><h2>Automation Engine</h2><p>{lastRuleRun.evaluated} signals evaluated · {lastRuleRun.suppressed} duplicates suppressed · {lastRuleRun.created} new actions created.</p></div><button className="primary" onClick={runRulesNow}>⚡ Run rules now</button></div></section>}
          <div className="content-grid">
            <section className="panel action-list-panel"><div className="panel-header"><div><h2>Needs Action</h2><p>Only actions inside the current user's authorized scope are shown.</p></div><span className="count-pill">{filtered.length}</span></div><div className="action-list">{filtered.map(a=><button key={a.id} className={`action-row ${selectedId===a.id?'selected':''}`} onClick={()=>setSelectedId(a.id)}><div className={`severity ${a.severity.toLowerCase()}`}>{a.severity==='High'?'!':a.severity==='Medium'?'•':'○'}</div><div className="action-main"><div className="action-meta"><span>{a.location}</span><span>•</span><span>{a.category}</span>{a.automated&&<><span>•</span><span>AUTO · {a.priorityScore??0}/100</span></>}</div><strong>{a.title}</strong><p>{a.signal}</p><div className="action-footer"><span className={`status ${a.status.toLowerCase()}`}>{a.status}</span>{permissions.canSeeFinancialImpact&&<span className="impact">{a.impact}</span>}</div></div><span className="chev">›</span></button>)}</div></section>
            {selected&&<section className="panel detail-panel"><div className="detail-top"><div><span className={`severity-label ${selected.severity.toLowerCase()}`}>{selected.severity} priority{selected.automated?' · AUTOMATED':''}</span><h2>{selected.title}</h2><p>{selected.location} · {selected.category}</p></div></div><div className="detail-block"><label>SIGNAL</label><p>{selected.signal}</p></div><div className="detail-block"><label>LIKELY CAUSE</label><p>{selected.cause}</p></div><div className="detail-block recommendation"><label>OPSVISTA RECOMMENDATION</label><p>{selected.recommendation}</p></div>{permissions.canSeeFinancialImpact&&<div className="impact-box"><span>Estimated impact</span><strong>{selected.impact}</strong></div>}{permissions.canEscalateActions&&<div className="action-buttons"><button className="primary" onClick={()=>updateAction(selected.id,{status:'Assigned',owner:selected.owner??'Location Manager'})}>Assign owner</button><button onClick={()=>updateAction(selected.id,{status:'Investigating'})}>Investigate</button><button onClick={()=>updateAction(selected.id,{status:'Dismissed'})}>Dismiss</button></div>}{permissions.canVerifyActions?<VerificationLoopPanel action={selected} onApply={(status,note)=>applyVerification(selected.id,status,note)}/>:<div className="detail-block"><label>VERIFICATION</label><p>Your role can view this action but cannot verify or close the outcome.</p></div>}</section>}
          </div>
        </>}
      </div>
    </main>
  </div>
}
