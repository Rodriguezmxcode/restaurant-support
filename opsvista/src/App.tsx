import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ExternalEscalation } from './actionCenterTypes';
import { canAccessLocation, currentAuthenticatedUser, permissionsFor, visibleLocations, type OpsVistaModule, type OpsVistaUser } from './accessControl';
import GoogleBusinessIntegrationPanel from './GoogleBusinessIntegrationPanel';
import { searchLiveOpsVista, type GlobalSearchResult } from './globalSearch';
import ModuleErrorBoundary from './ModuleErrorBoundary';
import OpsVistaDatePicker from './OpsVistaDatePicker';
import OpsVistaCopilot from './OpsVistaCopilot';

const moduleReloadKey='opsvista-module-reload';
const staleModulePattern=/Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError/i;

function recoverableLazy<T extends ComponentType<any>>(loader:()=>Promise<{default:T}>){
  return lazy(async()=>{
    try{
      const loaded=await loader();
      try{window.sessionStorage.removeItem(moduleReloadKey);}catch{/* Storage can be unavailable. */}
      return loaded;
    }catch(error){
      const message=error instanceof Error?`${error.name}: ${error.message}`:String(error);
      let alreadyReloaded=false;
      try{alreadyReloaded=window.sessionStorage.getItem(moduleReloadKey)==='1';}catch{/* Storage can be unavailable. */}
      if(typeof window!=='undefined'&&staleModulePattern.test(message)&&!alreadyReloaded){
        try{window.sessionStorage.setItem(moduleReloadKey,'1');}catch{/* Storage can be unavailable. */}
        window.location.reload();
        return await new Promise<{default:T}>(()=>{});
      }
      throw error;
    }
  });
}

const RampComplianceView=recoverableLazy(()=>import('./RampComplianceView'));
const LaborIntelligenceView=recoverableLazy(()=>import('./LaborIntelligenceView'));
const EvidenceAuditView=recoverableLazy(()=>import('./EvidenceAuditView'));
const WeeklyBonusLivePanel=recoverableLazy(()=>import('./WeeklyBonusLivePanel'));
const AccessControlPanel=recoverableLazy(()=>import('./AccessControlPanel'));
const InvitationManager=recoverableLazy(()=>import('./InvitationManager'));
const ChangePasswordPanel=recoverableLazy(()=>import('./ChangePasswordPanel'));
const OperationalOverview=recoverableLazy(()=>import('./OperationalOverview'));
const LocationDashboard=recoverableLazy(()=>import('./LocationDashboard'));
const GoogleReviewsView=recoverableLazy(()=>import('./GoogleReviewsView'));
const LocalIntelligenceView=recoverableLazy(()=>import('./LocalIntelligenceView'));
const TransferLedgerView=recoverableLazy(()=>import('./TransferLedgerView'));
const PaymentRequestsView=recoverableLazy(()=>import('./PaymentRequestsView'));
const ActionCenterView=recoverableLazy(()=>import('./ActionCenterView'));
const ProjectsView=recoverableLazy(()=>import('./ProjectsView'));
const Restaurant365View=recoverableLazy(()=>import('./Restaurant365View'));
const allLocations=['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
const toastPerformanceLocations=[...allLocations,'Middletown'];
const icon:Record<string,string>={Resumen:'⌂',Locaciones:'▦',Ventas:'↗','Google Reviews':'✦','Local Intelligence':'⌁',Finanzas:'▥',Gastos:'$',Horarios:'◷',Tasks:'☑','Bono semanal':'★','Action Center':'⚡',Proyectos:'◆',Prioridades:'⚑',Pagos:'$',Transferencias:'⇄',Restaurant365:'R',Configuración:'⚙'};

type SearchEntry={section:OpsVistaModule;label:string;description:string;keywords:string[]};
const searchCatalog:SearchEntry[]=[
  {section:'Resumen',label:'Resumen',description:'Dashboard, KPIs y desempeño operativo',keywords:['inicio','dashboard','overview','kpi','indicadores','performance']},
  {section:'Locaciones',label:'Locaciones',description:'Comparación y desempeño por restaurante',keywords:['location','restaurants','restaurantes','stamford','orange','fairfield','danbury','avon','southington']},
  {section:'Ventas',label:'Ventas',description:'Ventas netas, tendencias y comparaciones',keywords:['sales','revenue','net sales','ingresos','toast','comparacion']},
  {section:'Google Reviews',label:'Google Reviews',description:'Reseñas, calificaciones y reputación',keywords:['reviews','reseñas','rating','estrellas','google','reputation']},
  {section:'Local Intelligence',label:'Local Intelligence',description:'Clima, tráfico, eventos y señales locales',keywords:['weather','clima','traffic','trafico','events','eventos','incidents']},
  {section:'Finanzas',label:'Finanzas',description:'Control financiero y flujo de pagos',keywords:['finance','financial','control','aprobaciones']},
  {section:'Gastos',label:'Gastos Ramp',description:'Recibos, memos y cumplimiento de gastos',keywords:['ramp','expenses','gastos','receipt','receipts','recibo','recibos','memo','memos','compliance','cardholder']},
  {section:'Horarios',label:'Horarios',description:'Labor, horarios, overtime y SPLH',keywords:['schedule','schedules','labor','overtime','ot','turnos','splh','7shifts']},
  {section:'Tasks',label:'Tasks y Logbook',description:'Checklists, tareas y reportes diarios',keywords:['tasks','task','tareas','checklist','logbook','7shifts','evidence']},
  {section:'Bono semanal',label:'Bono semanal',description:'Scorecard, elegibilidad y ranking',keywords:['bonus','bono','weekly','ranking','score','eligibility']},
  {section:'Action Center',label:'Action Center',description:'Acciones, responsables y seguimiento',keywords:['actions','acciones','alerts','alertas','incidents','responsables','seguimiento']},
  {section:'Proyectos',label:'Proyectos',description:'Proyectos, Gantt, fechas y milestones',keywords:['projects','project','gantt','timeline','milestones','presupuesto']},
  {section:'Prioridades',label:'Prioridades',description:'Pendientes operativos por prioridad',keywords:['priorities','priority','pendientes','urgente','critical']},
  {section:'Pagos',label:'Pagos',description:'Solicitudes y aprobaciones de pago',keywords:['payments','payment','pago','pagos','requests','solicitudes']},
  {section:'Transferencias',label:'Transferencias',description:'Movimientos entre restaurantes',keywords:['transfers','transfer','inventory','inventario','movimientos']},
  {section:'Restaurant365',label:'Restaurant365',description:'P&L, facturas AP, vendors y cuentas GL',keywords:['r365','restaurant365','p&l','pnl','accounting','contabilidad','invoice','facturas','vendors','gl']},
  {section:'Configuración',label:'Configuración',description:'Usuarios, permisos e integraciones',keywords:['settings','configuration','usuarios','users','permissions','permisos','integrations','invitaciones']},
];
const normalizeSearch=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
type ActionAssignee={id:string;name:string;title:string;role:string;locations:string[]};
type AssignmentRequest={item:ExternalEscalation;category:string;managers:ActionAssignee[];ownerId:string;dueAt:string;resolve:(value:unknown)=>void;reject:(reason:Error)=>void};
const easternToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const addDays=(value:string,days:number)=>{const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);};

function storedSection(){
  if(typeof window==='undefined')return null;
  try{return window.localStorage.getItem('opsvista-section')??window.sessionStorage.getItem('opsvista-section');}
  catch{return null;}
}

function rememberSection(section:OpsVistaModule){
  try{window.sessionStorage.setItem('opsvista-section',section);window.localStorage.setItem('opsvista-section',section);}catch{/* Storage can be unavailable in restrictive Safari sessions. */}
}

export default function App(){
  const [authenticatedUser]=useState(currentAuthenticatedUser);
  const [previewUser,setPreviewUser]=useState<OpsVistaUser|null>(null);
  const [previewNotice,setPreviewNotice]=useState('');
  const [sidebarCollapsed,setSidebarCollapsed]=useState(()=>{try{return window.localStorage.getItem('opsvista-sidebar-collapsed')==='1'}catch{return false}});
  const currentUser=previewUser??authenticatedUser;
  const permissions=permissionsFor(currentUser);
  const allowedLocations=useMemo(()=>visibleLocations(currentUser,allLocations),[currentUser]);
  const allowedPerformanceLocations=useMemo(()=>permissions.allLocations?toastPerformanceLocations:allowedLocations,[permissions.allLocations,allowedLocations]);
  const nav=permissions.modules;
  const [section,setSection]=useState<OpsVistaModule>(()=>{const integration=typeof window!=='undefined'&&new URLSearchParams(window.location.search).get('integration');const saved=storedSection();return (integration&&permissions.modules.includes('Configuración')?'Configuración':saved&&permissions.modules.includes(saved as OpsVistaModule)?saved:'Resumen') as OpsVistaModule;});
  const [search,setSearch]=useState('');
  const [searchOpen,setSearchOpen]=useState(false);
  const [searchIndex,setSearchIndex]=useState(0);
  const [searchLoading,setSearchLoading]=useState(false);
  const [liveSearchResults,setLiveSearchResults]=useState<GlobalSearchResult[]>([]);
  const [searchTarget,setSearchTarget]=useState<GlobalSearchResult|null>(null);
  const [actionAssignees,setActionAssignees]=useState<ActionAssignee[]>([]);
  const [assignmentRequest,setAssignmentRequest]=useState<AssignmentRequest|null>(null);
  const [assignmentSaving,setAssignmentSaving]=useState(false);
  const [assignmentError,setAssignmentError]=useState('');
  const searchRequestRef=useRef(0);
  const searchWrapRef=useRef<HTMLDivElement>(null);
  const searchInputRef=useRef<HTMLInputElement>(null);
  const navKey=nav.join('|');
  const allowedLocationKey=allowedLocations.join('|');
  const moduleResults=useMemo<GlobalSearchResult[]>(()=>{
    const query=normalizeSearch(search);
    if(!query)return [];
    const tokens=query.split(/\s+/).filter(Boolean);
    return searchCatalog
      .filter(entry=>nav.includes(entry.section))
      .map(entry=>{
        const operationalLocations=['Resumen','Locaciones','Ventas','Google Reviews','Local Intelligence','Gastos','Horarios','Tasks','Bono semanal','Action Center','Proyectos','Prioridades','Pagos','Transferencias'].includes(entry.section)?allowedLocations:[];
        const searchable=normalizeSearch([entry.label,entry.description,...entry.keywords,...operationalLocations].join(' '));
        const label=normalizeSearch(entry.label);
        const matches=tokens.every(token=>searchable.includes(token));
        const score=label===query?0:label.startsWith(query)?1:matches?2:99;
        return {entry,score};
      })
      .filter(result=>result.score<99)
      .sort((a,b)=>a.score-b.score||a.entry.label.localeCompare(b.entry.label))
      .slice(0,6)
      .map(({entry})=>({id:`module-${entry.section}`,section:entry.section,label:entry.label,description:entry.description,badge:'MÓDULO'}));
  },[search,navKey,allowedLocationKey]);
  const searchResults=useMemo(()=>[...moduleResults,...liveSearchResults.filter(result=>!moduleResults.some(module=>module.id===result.id))].slice(0,12),[moduleResults,liveSearchResults]);

  useEffect(()=>{if(!nav.includes(section))setSection(nav.includes('Resumen')?'Resumen':nav[0]);},[currentUser.id,section]);
  useEffect(()=>{rememberSection(section)},[section]);
  useEffect(()=>{setSearchIndex(0)},[search,liveSearchResults]);
  useEffect(()=>{
    const value=search.trim();
    const request=++searchRequestRef.current;
    if(normalizeSearch(value).length<2){setLiveSearchResults([]);setSearchLoading(false);return;}
    setSearchLoading(true);
    const timer=window.setTimeout(()=>{
      void searchLiveOpsVista(value,nav,allowedLocations)
        .then(results=>{if(searchRequestRef.current===request)setLiveSearchResults(results);})
        .catch(()=>{if(searchRequestRef.current===request)setLiveSearchResults([]);})
        .finally(()=>{if(searchRequestRef.current===request)setSearchLoading(false);});
    },320);
    return()=>window.clearTimeout(timer);
  },[search,navKey,allowedLocationKey]);
  useEffect(()=>{
    const closeSearch=(event:PointerEvent)=>{if(!searchWrapRef.current?.contains(event.target as Node))setSearchOpen(false);};
    const focusSearch=(event:KeyboardEvent)=>{
      const target=event.target as HTMLElement|null;
      const typing=target?.tagName==='INPUT'||target?.tagName==='TEXTAREA'||target?.isContentEditable;
      if(event.key==='/'&&!typing){event.preventDefault();searchInputRef.current?.focus();setSearchOpen(true);}
    };
    document.addEventListener('pointerdown',closeSearch);
    document.addEventListener('keydown',focusSearch);
    return()=>{document.removeEventListener('pointerdown',closeSearch);document.removeEventListener('keydown',focusSearch);};
  },[]);
  useEffect(()=>{
    if(!previewUser)return;
    const originalFetch=window.fetch.bind(window);
    window.fetch=async(input,init)=>{
      const method=(init?.method||(input instanceof Request?input.method:'GET')).toUpperCase();
      if(!['GET','HEAD','OPTIONS'].includes(method)){
        setPreviewNotice('Acción bloqueada: la vista previa es de solo lectura y no guardó ningún cambio.');
        return new Response(JSON.stringify({error:'Vista previa de solo lectura: no se guardó ningún cambio.'}),{status:403,headers:{'Content-Type':'application/json'}});
      }
      return originalFetch(input,init);
    };
    return()=>{window.fetch=originalFetch;};
  },[previewUser?.id]);

  const persistExternal=async(item:ExternalEscalation,category:string)=>{const effectiveCategory=item.category||category;const automationKey=item.automationKey||`external::${effectiveCategory}::${item.location}::${item.title}::${item.signal}`;const response=await fetch('/api/workflows?resource=actions',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({...item,category:effectiveCategory,automationKey,automated:true,priorityScore:item.priorityScore??(item.severity==='High'?80:item.severity==='Medium'?50:25),sources:item.sources??[effectiveCategory],detectedAt:item.detectedAt??new Date().toISOString()})});const body=await response.json().catch(()=>({})) as {action?:{id:string};error?:string};if(!response.ok||!body.action)throw new Error(body.error||'Action could not be saved');setSearchTarget({id:`action-${body.action.id}`,section:'Action Center',label:item.title,description:`${item.location} · ${item.ownerName||'Unassigned'}`,badge:'ACTION',recordId:body.action.id,location:item.location});setSection('Action Center');setSearch('');return body.action;};
  const availableAssignees=async()=>{if(actionAssignees.length)return actionAssignees;const response=await fetch('/api/workflows?resource=actions',{credentials:'include',cache:'no-store'});const body=await response.json().catch(()=>({})) as {assignees?:ActionAssignee[];error?:string};if(!response.ok)throw new Error(body.error||'Responsible-user directory unavailable');const rows=body.assignees||[];setActionAssignees(rows);return rows;};
  const defaultActionDue=(item:ExternalEscalation)=>item.dueAt||addDays(easternToday(),item.severity==='High'?0:item.severity==='Medium'?1:2);
  const escalateExternal=async(item:ExternalEscalation,category:string)=>{if(!permissions.canEscalateActions||!canAccessLocation(currentUser,item.location))throw new Error('Action is outside your authorized locations');if(item.ownerId)return persistExternal(item,category);const managers=(await availableAssignees()).filter(user=>user.role==='Location Manager'&&user.locations.includes(item.location));if(!managers.length)throw new Error(`No active Location Manager is assigned to ${item.location}`);if(managers.length===1){const manager=managers[0];return persistExternal({...item,ownerId:manager.id,ownerName:manager.name,dueAt:defaultActionDue(item)},category);}return await new Promise((resolve,reject)=>{setAssignmentError('');setAssignmentRequest({item,category,managers,ownerId:'',dueAt:defaultActionDue(item),resolve,reject});});};
  const cancelAssignment=()=>{if(!assignmentRequest||assignmentSaving)return;assignmentRequest.reject(new Error('Action assignment cancelled'));setAssignmentRequest(null);setAssignmentError('');};
  const confirmAssignment=async()=>{if(!assignmentRequest||!assignmentRequest.ownerId||!assignmentRequest.dueAt)return;const manager=assignmentRequest.managers.find(user=>user.id===assignmentRequest.ownerId);if(!manager)return;setAssignmentSaving(true);setAssignmentError('');try{const result=await persistExternal({...assignmentRequest.item,ownerId:manager.id,ownerName:manager.name,dueAt:assignmentRequest.dueAt},assignmentRequest.category);assignmentRequest.resolve(result);setAssignmentRequest(null);}catch(error){setAssignmentError(error instanceof Error?error.message:'Action could not be assigned');}finally{setAssignmentSaving(false);}};
  const logout=async()=>{try{await fetch('/api/auth/logout',{method:'POST',credentials:'include'})}finally{window.location.assign('/')}};
  const refreshData=()=>{rememberSection(section);window.location.reload()};
  const startUserPreview=(user:OpsVistaUser)=>{setPreviewNotice('');setPreviewUser(user);setSearch('');setSearchTarget(null);};
  const stopUserPreview=()=>{setPreviewUser(null);setPreviewNotice('');setSection('Configuración');};
  const toggleSidebar=()=>setSidebarCollapsed(collapsed=>{const next=!collapsed;try{window.localStorage.setItem('opsvista-sidebar-collapsed',next?'1':'0')}catch{/* Storage can be unavailable. */}return next});
  const openSearchResult=(target:GlobalSearchResult)=>{
    if(!nav.includes(target.section))return;
    rememberSection(target.section);
    setSearchTarget(target.badge==='MÓDULO'?null:target);
    setSection(target.section);
    setSearch('');
    setSearchOpen(false);
    setSearchIndex(0);
    setLiveSearchResults([]);
    window.scrollTo({top:0,behavior:'smooth'});
  };
  const openCopilotModule=(target:OpsVistaModule)=>{
    if(!nav.includes(target))return;
    rememberSection(target);
    setSearchTarget(null);
    setSection(target);
    setSearch('');
    setSearchOpen(false);
    window.scrollTo({top:0,behavior:'smooth'});
  };
  const handleSearchKeyDown=(event:ReactKeyboardEvent<HTMLInputElement>)=>{
    if(event.key==='ArrowDown'&&searchResults.length){event.preventDefault();setSearchOpen(true);setSearchIndex(index=>(index+1)%searchResults.length);}
    else if(event.key==='ArrowUp'&&searchResults.length){event.preventDefault();setSearchOpen(true);setSearchIndex(index=>(index-1+searchResults.length)%searchResults.length);}
    else if(event.key==='Enter'&&searchResults.length){event.preventDefault();openSearchResult(searchResults[Math.min(searchIndex,searchResults.length-1)]);}
    else if(event.key==='Escape'){setSearch('');setSearchOpen(false);setLiveSearchResults([]);searchInputRef.current?.blur();}
  };

  const isOverview=section==='Resumen'||section==='Ventas';
  const isLocations=section==='Locaciones';
  const isGoogleReviews=section==='Google Reviews';
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
  const isRestaurant365=section==='Restaurant365';
  const isSettings=section==='Configuración';
  const eyebrow=isOverview?'OPERATING PERFORMANCE':isLocations?'MULTI-LOCATION PERFORMANCE':isGoogleReviews?'REPUTATION INTELLIGENCE':isLocalIntelligence?'EXTERNAL OPERATING SIGNALS':isRamp?'FINANCIAL ACCOUNTABILITY':isLabor?'WORKFORCE INTELLIGENCE':isEvidence?'OPERATIONAL VERIFICATION':isBonus?'PERFORMANCE INCENTIVES':isPriorities?'OPERATIONAL PRIORITIES':isActionCenter?'OPERATIONAL ACCOUNTABILITY':isProjects?'PROJECT PORTFOLIO':isFinance?'FINANCIAL CONTROL':isPayments?'PAYMENT CONTROL':isTransfers?'INVENTORY CHAIN OF CUSTODY':isRestaurant365?'ACCOUNTING INTELLIGENCE':isSettings?'ACCESS & SECURITY':'OPERATIONAL INTELLIGENCE';
  const title=isOverview?(section==='Ventas'?'Ventas · Performance':'Resumen · Operating Performance'):isLocations?'Locaciones · Performance Dashboard':isGoogleReviews?'Google Reviews':isLocalIntelligence?'Local Intelligence':isRamp?(currentUser.role==='Location Manager'?`Gastos Ramp · ${allowedLocations.join(', ')}`:'Gastos Ramp'):isLabor?'Horarios · Labor Intelligence':isEvidence?'Tasks · 7shifts & Logbook':isBonus?'Bono semanal':isPriorities?'Prioridades · Action Center':isActionCenter?'Action Center':isProjects?'Proyectos':isFinance?'Finanzas · Control de pagos':isPayments?'Pagos · Approval Workflow':isTransfers?'Transferencias · Restaurant Ledger':isRestaurant365?'Restaurant365 · Accounting Intelligence':isSettings?'Configuración · Roles & Permissions':section;
  const subtitle=isOverview?'Ventas, labor, task compliance, voids y descuentos en una sola vista operativa.':isLocations?'Compara el desempeño completo de cada restaurante con datos reales de Toast, 7shifts y OpsVista.':isGoogleReviews?'Monitorea volumen, calificación, respuestas y reseñas críticas por restaurante desde Google Business Profile.':isLocalIntelligence?'Clima, tráfico, incidentes y eventos cercanos convertidos en impacto y recomendaciones por restaurante.':isRamp?(currentUser.role==='Location Manager'?'Revisa los gastos de tus restaurantes y completa en Ramp los memos o recibos pendientes.':'Cada gasto debe mostrar quién lo hizo, dónde pertenece, por qué se hizo y contar con la evidencia requerida.'):isLabor?'Compara ventas, forecast, labor, SPLH y overtime para convertir desviaciones en acciones con impacto financiero.':isEvidence?'Controla Tasks, responsables y Logbook por ubicación y periodo.':isBonus?'Scorecard semanal con Tasks, descuentos, voids, overtime y reglas de elegibilidad.':isPriorities?'Muestra las acciones persistentes que requieren atención, ordenadas por prioridad y dentro del alcance autorizado.':isActionCenter?'Convierte señales operativas en acciones asignadas, verificables y guardadas permanentemente.':isProjects?'Planifica iniciativas con responsables, fechas, milestones, presupuesto y resultados sin mezclarlas con alertas operativas.':isFinance?'Usa el flujo real de solicitudes, aprobaciones y emisión de pagos con bitácora completa.':isPayments?'Managers solicitan; Corporate aprueba; Administration emite únicamente pagos aprobados, con bitácora completa.':isTransfers?'Registra qué salió, qué llegó, quién recibió, a qué hora y cualquier faltante o diferencia entre restaurantes.':isRestaurant365?'P&L, facturas AP, vendors, cuentas GL y salud de sincronización, separados del trabajo diario de los managers.':isSettings?'Controla acceso, credenciales, usuarios y permisos.':'La fuente de este módulo no está disponible.';

  return <div className={`app-shell ${previewUser?'user-preview-active':''} ${sidebarCollapsed?'sidebar-collapsed':''}`}>
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">OV</div><div className="brand-copy"><strong>OpsVista</strong><span>OPERATIONS CENTER</span><small>Account OPS-0001</small></div></div>
      <button type="button" className="sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarCollapsed?'Expandir menú lateral':'Compactar menú lateral'} aria-pressed={sidebarCollapsed} title={sidebarCollapsed?'Expandir menú':'Compactar menú'}>{sidebarCollapsed?'›':'‹'}</button>
      <nav aria-label="Módulos de OpsVista">{nav.map(item=>{const label=item==='Gastos'?'Gastos Ramp':item;return <button key={item} className={section===item?'active':''} onClick={()=>{rememberSection(item);setSearchTarget(null);setSection(item);}} aria-label={sidebarCollapsed?label:undefined} title={sidebarCollapsed?label:undefined}><span className="nav-icon">{icon[item]}</span><span className="nav-label">{label}</span></button>})}</nav>
      <div className="user-card" title={sidebarCollapsed?`${currentUser.name} · ${currentUser.role}`:undefined}><div className="avatar">{currentUser.name.split(' ').map(x=>x[0]).join('').slice(0,2)}</div><div className="user-card-copy"><strong>{currentUser.name}</strong><span>{previewUser?'Vista previa · ':''}{currentUser.role} · {permissions.allLocations?'All locations':currentUser.locations.join(', ')}</span></div></div>
    </aside>

    <main>
      {previewUser&&<div className="user-preview-banner" role="status"><div><span>VISTA PREVIA COMO USUARIO</span><strong>{previewUser.name}</strong><small>{previewUser.role} · {permissions.allLocations?'Todas las locaciones':allowedLocations.join(', ')||'Sin locación'} · Solo lectura</small></div><button onClick={stopUserPreview}>Salir de vista previa</button></div>}
      <header className="topbar">
        <div className={`search-wrap ${searchOpen?'open':''}`} ref={searchWrapRef}>
          <button type="button" className="search-trigger" aria-label="Abrir búsqueda" onClick={()=>{searchInputRef.current?.focus();setSearchOpen(true);}}>⌕</button>
          <input ref={searchInputRef} value={search} onChange={event=>{setSearch(event.target.value);setSearchOpen(true);}} onFocus={()=>setSearchOpen(true)} onKeyDown={handleSearchKeyDown} placeholder="Buscar módulos, recibos, ventas..." role="combobox" aria-expanded={searchOpen&&Boolean(search.trim())} aria-controls="opsvista-search-results" aria-autocomplete="list"/>
          {searchOpen&&Boolean(search.trim())&&<div className="search-results" id="opsvista-search-results" role="listbox">
            {searchResults.map((result,index)=><button type="button" key={result.id} role="option" aria-selected={index===searchIndex} className={index===searchIndex?'selected':''} onMouseEnter={()=>setSearchIndex(index)} onClick={()=>openSearchResult(result)}>
              <span className="search-result-icon">{icon[result.section]}</span>
              <span><strong>{result.label}</strong><small>{result.description}</small></span>
              <em>{result.badge==='MÓDULO'?'Abrir':result.badge}</em>
            </button>)}
            {searchLoading&&<div className="search-loading"><span></span><strong>Buscando datos en vivo…</strong></div>}
            {!searchLoading&&!searchResults.length&&<div className="search-empty"><strong>Sin resultados disponibles</strong><span>La búsqueda respeta los permisos y las locaciones de este usuario.</span></div>}
            <div className="search-hint"><span>↑↓ navegar</span><span>Enter abrir</span><span>Esc cerrar</span></div>
          </div>}
        </div>
        <div className="top-actions"><button onClick={previewUser?()=>setPreviewNotice('La vista previa ya consulta datos reales. Sal de este modo para recargar toda la aplicación.'):refreshData}>{previewUser?'✓ Datos en vivo':'↻ Actualizar datos'}</button>{previewUser?<button className="preview-exit" onClick={stopUserPreview}>Salir de vista previa</button>:<button className="danger-outline" onClick={logout}>Cerrar sesión</button>}<div className="avatar small">{currentUser.name.split(' ').map(x=>x[0]).join('').slice(0,2)}</div></div>
      </header>

      <div className="page">
        {previewNotice&&<div className="user-preview-notice" role="alert">{previewNotice}<button onClick={()=>setPreviewNotice('')}>×</button></div>}
        <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div></div>

        <ModuleErrorBoundary key={section} moduleName={title} onOpenOverview={()=>{rememberSection('Resumen');setSearchTarget(null);setSection('Resumen');}}><Suspense fallback={<section className="panel"><div className="panel-header"><div><h2>Cargando módulo</h2><p>Preparando la vista solicitada…</p></div><span className="count-pill">CARGANDO</span></div></section>}>
          {isOverview?<OperationalOverview key={currentUser.id} allowedLocations={allowedPerformanceLocations} allLocations={permissions.allLocations} modules={nav} onOpenModule={openCopilotModule}/>:isLocations?<LocationDashboard allowedLocations={allowedPerformanceLocations} allLocations={permissions.allLocations} onOpenTasks={()=>{setSearchTarget(null);setSection('Tasks')}} onOpenLabor={()=>{setSearchTarget(null);setSection('Horarios')}}/>:isGoogleReviews?<GoogleReviewsView allowedLocations={allowedLocations} canImportReviews={!previewUser&&(currentUser.role==='Founder'||currentUser.role==='Corporate')}/>:isLocalIntelligence?<LocalIntelligenceView key={searchTarget?.id||'local-default'} allowedLocations={allowedLocations} initialLocation={searchTarget?.section==='Local Intelligence'?searchTarget.location:undefined} initialHorizon={searchTarget?.section==='Local Intelligence'?searchTarget.horizon:undefined}/>:isActionCenter?<ActionCenterView key={searchTarget?.id||'actions-default'} currentUser={currentUser} canTestNotifications={!previewUser} allowedLocations={allowedLocations} initialSearch={searchTarget&&['Action Center','Prioridades'].includes(searchTarget.section)?searchTarget.query:undefined} initialRecordId={searchTarget&&['Action Center','Prioridades'].includes(searchTarget.section)?searchTarget.recordId:undefined} initialLocation={searchTarget&&['Action Center','Prioridades'].includes(searchTarget.section)?searchTarget.location:undefined}/>:isProjects?<ProjectsView key={searchTarget?.id||'projects-default'} currentUser={currentUser} allowedLocations={allowedLocations} canSeeFinancialImpact={permissions.canSeeFinancialImpact} initialSearch={searchTarget?.section==='Proyectos'?searchTarget.query:undefined} initialRecordId={searchTarget?.section==='Proyectos'?searchTarget.recordId:undefined}/>:isPayments?<PaymentRequestsView key={searchTarget?.id||'payments-default'} currentUser={currentUser} allowedLocations={allowedLocations} initialSearch={searchTarget&&['Pagos','Finanzas'].includes(searchTarget.section)?searchTarget.query:undefined} initialRecordId={searchTarget&&['Pagos','Finanzas'].includes(searchTarget.section)?searchTarget.recordId:undefined}/>:isTransfers?<TransferLedgerView key={searchTarget?.id||'transfers-default'} allowedLocations={allowedLocations} initialRecordId={searchTarget?.section==='Transferencias'?searchTarget.recordId:undefined}/>:isRestaurant365?<Restaurant365View canManageIntegrations={!previewUser&&permissions.canManageIntegrations}/>:isSettings?<>{permissions.canManageIntegrations&&<GoogleBusinessIntegrationPanel/>}<ChangePasswordPanel/><InvitationManager currentUser={currentUser}/><AccessControlPanel currentUser={currentUser} onPreviewUser={previewUser?undefined:startUserPreview}/></>:isRamp?<RampComplianceView key={searchTarget?.id||'ramp-default'} allowedLocations={allowedLocations} managerMode={currentUser.role==='Location Manager'} initialQuery={searchTarget?.section==='Gastos'?searchTarget.query:undefined} initialRecordId={searchTarget?.section==='Gastos'?searchTarget.recordId:undefined} onEscalate={!previewUser&&currentUser.role!=='Location Manager'&&permissions.canEscalateActions?item=>escalateExternal(item,'Ramp Compliance'):undefined}/>:isLabor?<LaborIntelligenceView allowedLocations={allowedLocations} onEscalate={!previewUser&&permissions.canEscalateActions?item=>escalateExternal(item,'Labor Intelligence'):undefined}/>:isBonus?<WeeklyBonusLivePanel allowedLocations={permissions.allLocations?undefined:allowedLocations}/>:isEvidence?<EvidenceAuditView key={searchTarget?.id||'tasks-default'} allowedLocations={permissions.allLocations?undefined:allowedLocations} initialSearch={searchTarget?.section==='Tasks'?searchTarget.query:undefined} initialRecordId={searchTarget?.section==='Tasks'?searchTarget.recordId:undefined} initialLocation={searchTarget?.section==='Tasks'?searchTarget.location:undefined} initialDate={searchTarget?.section==='Tasks'?searchTarget.date:undefined} canReview={!previewUser&&permissions.canReviewEvidence} reviewerName={currentUser.name} onEscalate={!previewUser&&permissions.canEscalateActions?item=>escalateExternal(item,'Evidence Audit'):undefined}/>:<section className="panel"><div className="panel-header"><div><h2>Fuente no disponible</h2><p>OpsVista no mostrará cifras de prueba. Este módulo se habilitará cuando tenga una fuente real verificada.</p></div><span className="count-pill">PENDIENTE</span></div></section>}
        </Suspense></ModuleErrorBoundary>
      </div>
      {permissions.canUseCopilot&&<OpsVistaCopilot key={currentUser.id} currentUserId={currentUser.id} currentUserName={currentUser.name} role={currentUser.role} allowedLocations={allowedLocations} modules={nav} currentSection={section} onNavigate={openCopilotModule}/>}
      {assignmentRequest&&<div className="manager-assignment-backdrop" onMouseDown={cancelAssignment}><section className="manager-assignment-dialog" role="dialog" aria-modal="true" aria-label="Assign location manager" onMouseDown={event=>event.stopPropagation()}><header><div><span>RESPONSABILIDAD OPERATIVA</span><h2>Asignar seguimiento al manager</h2><p>{assignmentRequest.item.location} · {assignmentRequest.category}</p></div><button type="button" onClick={cancelAssignment} disabled={assignmentSaving}>×</button></header>{assignmentRequest.item.accountableName&&<div className="manager-assignment-subject"><span>PERSONA QUE REQUIERE CORRECCIÓN</span><strong>{assignmentRequest.item.accountableName}</strong><small>{assignmentRequest.item.accountableRole||'Incumplimiento detectado por OpsVista'}</small></div>}<div className="manager-assignment-signal"><strong>{assignmentRequest.item.title}</strong><span>{assignmentRequest.item.signal}</span></div><label>MANAGER RESPONSABLE<select value={assignmentRequest.ownerId} onChange={event=>setAssignmentRequest({...assignmentRequest,ownerId:event.target.value})}><option value="">Selecciona un manager</option>{assignmentRequest.managers.map(manager=><option key={manager.id} value={manager.id}>{manager.name} · {manager.title}</option>)}</select></label><label>FECHA LÍMITE<OpsVistaDatePicker value={assignmentRequest.dueAt} onChange={dueAt=>setAssignmentRequest({...assignmentRequest,dueAt})} ariaLabel="Seleccionar fecha límite de la acción"/></label><p className="manager-assignment-note">El manager recibirá esta acción en My Actions y deberá dar seguimiento a la persona indicada. OpsVista conservará la fuente y el historial.</p>{assignmentError&&<div className="manager-assignment-error">{assignmentError}</div>}<footer><button type="button" onClick={cancelAssignment} disabled={assignmentSaving}>Cancelar</button><button type="button" className="primary" onClick={()=>void confirmAssignment()} disabled={assignmentSaving||!assignmentRequest.ownerId||!assignmentRequest.dueAt}>{assignmentSaving?'Asignando…':'Asignar acción'}</button></footer></section></div>}
    </main>
  </div>
}
