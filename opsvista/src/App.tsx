import { useMemo, useState } from 'react';
import RampComplianceView from './RampComplianceView';
import LaborIntelligenceView from './LaborIntelligenceView';
import EvidenceAuditView from './EvidenceAuditView';
import { demoAutomationSignals, runActionRules, type SignalSource } from './actionRules';

type Severity = 'High' | 'Medium' | 'Low';
type Status = 'Open' | 'Assigned' | 'Investigating' | 'Completed' | 'Dismissed';

type ActionItem = {
  id: number;
  location: string;
  category: string;
  title: string;
  severity: Severity;
  status: Status;
  signal: string;
  cause: string;
  recommendation: string;
  impact: string;
  owner?: string;
  automationKey?: string;
  automated?: boolean;
  priorityScore?: number;
  sources?: SignalSource[];
  detectedAt?: string;
};

type ExternalEscalation = Omit<ActionItem, 'id' | 'category' | 'status'>;

const seededRules = runActionRules(demoAutomationSignals);
const initialActions: ActionItem[] = seededRules.actions.map((action, index) => ({
  ...action,
  id: index + 1,
  status: 'Open',
}));

const nav = ['Resumen','Locaciones','Ventas','Local Intelligence','Finanzas','Gastos','Horarios','Tasks','Action Center','Prioridades','Pagos','Transferencias','Configuración'];
const icon: Record<string,string> = { Resumen:'⌂',Locaciones:'▦',Ventas:'↗','Local Intelligence':'⌁',Finanzas:'▥',Gastos:'$',Horarios:'◷',Tasks:'☑','Action Center':'⚡',Prioridades:'⚑',Pagos:'$',Transferencias:'⇄',Configuración:'⚙' };

function Metric({ label, value, note, tone }: { label:string; value:string; note:string; tone?:string }) {
  return <div className="metric-card"><div className="metric-label">{label}</div><div className={`metric-value ${tone ?? ''}`}>{value}</div><div className="metric-note">{note}</div></div>;
}

export default function App() {
  const [section,setSection] = useState('Action Center');
  const [location,setLocation] = useState('All locations');
  const [actions,setActions] = useState(initialActions);
  const [selectedId,setSelectedId] = useState(initialActions[0]?.id ?? 1);
  const [search,setSearch] = useState('');
  const [lastRuleRun,setLastRuleRun] = useState({ evaluated: seededRules.evaluatedSignals, suppressed: seededRules.suppressedDuplicates, created: seededRules.actions.length });

  const selected = actions.find(a=>a.id===selectedId) ?? actions[0];
  const filtered = useMemo(()=>actions.filter(a=>{
    const inLocation = location==='All locations' || a.location===location;
    const q = search.trim().toLowerCase();
    const matches = !q || [a.location,a.category,a.title,a.signal,a.cause,a.owner].filter(Boolean).join(' ').toLowerCase().includes(q);
    return inLocation && matches;
  }).sort((a,b)=>(b.priorityScore??0)-(a.priorityScore??0)),[actions,location,search]);

  const updateAction = (id:number,patch:Partial<ActionItem>) => setActions(items=>items.map(item=>item.id===id?{...item,...patch}:item));

  const escalateExternal = (item:ExternalEscalation,category:string) => {
    setActions(items=>{
      const nextId = Math.max(0,...items.map(action=>action.id))+1;
      setSelectedId(nextId);
      return [...items,{...item,id:nextId,category,status:'Open'}];
    });
    setSection('Action Center');
    setLocation('All locations');
    setSearch('');
  };

  const runRulesNow = () => {
    const result = runActionRules(demoAutomationSignals, actions);
    if (result.actions.length) {
      setActions(items => {
        let nextId = Math.max(0, ...items.map(a => a.id));
        const additions: ActionItem[] = result.actions.map(action => ({ ...action, id: ++nextId, status: 'Open' }));
        return [...items, ...additions];
      });
    }
    setLastRuleRun({ evaluated: result.evaluatedSignals, suppressed: result.suppressedDuplicates, created: result.actions.length });
  };

  const openCount = actions.filter(a=>!['Completed','Dismissed'].includes(a.status)).length;
  const highCount = actions.filter(a=>a.severity==='High'&&!['Completed','Dismissed'].includes(a.status)).length;
  const autoCount = actions.filter(a=>a.automated&&!['Completed','Dismissed'].includes(a.status)).length;
  const isRamp = section==='Gastos';
  const isLabor = section==='Horarios';
  const isEvidence = section==='Tasks';
  const isIntelligenceModule = isRamp || isLabor || isEvidence;

  const eyebrow = isRamp ? 'FINANCIAL ACCOUNTABILITY' : isLabor ? 'WORKFORCE INTELLIGENCE' : isEvidence ? 'OPERATIONAL VERIFICATION' : 'OPERATIONAL INTELLIGENCE';
  const title = isRamp ? 'Gastos · Ramp Compliance' : isLabor ? 'Horarios · Labor Intelligence' : isEvidence ? 'Tasks · Evidence Audit' : section;
  const subtitle = isRamp ? 'Cada gasto debe mostrar quién lo hizo, dónde pertenece, por qué se hizo y contar con la evidencia requerida.' : isLabor ? 'Compara ventas, forecast, labor, SPLH y overtime para convertir desviaciones en acciones con impacto financiero.' : isEvidence ? 'Verifica que las tareas realmente cumplan el estándar mediante evidencia, revisión humana, corrección y trazabilidad.' : 'Detecta qué requiere atención, entiende la causa y convierte la señal en una acción verificable.';

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">OV</div><div><strong>OpsVista</strong><span>OPERATIONS CENTER</span><small>Account OPS-0001</small></div></div>
      <nav>{nav.map(item=><button key={item} className={section===item?'active':''} onClick={()=>setSection(item)}><span className="nav-icon">{icon[item]}</span>{item}</button>)}</nav>
      <div className="user-card"><div className="avatar">RR</div><div><strong>Roberto Rodríguez</strong><span>Operaciones corporativas</span></div></div>
    </aside>

    <main>
      <header className="topbar">
        <div className="search-wrap"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder={isIntelligenceModule?'Buscar en OpsVista...':'Buscar incidente, ubicación o responsable...'} /></div>
        <div className="top-actions"><button>↻ Actualizar datos</button><button>Presentación OpsVista</button><button className="danger-outline">Cerrar sesión</button><button className="icon-btn">?</button><div className="avatar small">RR</div></div>
      </header>

      <div className="page">
        <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{!isIntelligenceModule&&<div className="filters"><select value={location} onChange={e=>setLocation(e.target.value)}><option>All locations</option><option>Stamford</option><option>Orange</option><option>Fairfield</option><option>Danbury</option><option>Avon</option><option>Southington</option></select><button className="primary">+ Nueva acción</button></div>}</div>

        {isRamp ? <RampComplianceView onEscalate={item=>escalateExternal(item,'Ramp Compliance')} /> : isLabor ? <LaborIntelligenceView onEscalate={item=>escalateExternal(item,'Labor Intelligence')} /> : isEvidence ? <EvidenceAuditView onEscalate={item=>escalateExternal(item,'Evidence Audit')} /> : <>
          <section className="metrics-grid">
            <Metric label="SALES TODAY" value="$82,461" note="+7.2% vs comparable period" />
            <Metric label="PROJECTED LABOR" value="21.3%" note="Current: 19.8% · Target: 21.0%" />
            <Metric label="SPLH" value="$63.40" note="Across active locations" />
            <Metric label="AUTO ACTIONS" value={String(autoCount)} note={`${lastRuleRun.suppressed} duplicates suppressed`} />
            <Metric label="OPEN ACTIONS" value={String(openCount)} note={`${highCount} high priority`} tone={highCount?'warn':''} />
          </section>

          <section className="score-banner"><div><span>OpsVista Score</span><strong>87</strong><small>/100</small></div><div className="score-copy"><strong>Action Center Rules v2 active</strong><span>Signals are deduplicated, scored by urgency/impact and converted into one operational action per real problem.</span></div><div className="health"><span className="dot green"></span>Healthy <span className="dot amber"></span>Watch <span className="dot red"></span>Action</div></section>

          <section className="panel" style={{marginBottom:16}}><div className="panel-header"><div><h2>Automation Engine</h2><p>{lastRuleRun.evaluated} signals evaluated · {lastRuleRun.suppressed} duplicate signals suppressed · {lastRuleRun.created} new actions created on last run.</p></div><button className="primary" onClick={runRulesNow}>⚡ Run rules now</button></div></section>

          <div className="content-grid">
            <section className="panel action-list-panel"><div className="panel-header"><div><h2>Needs Action</h2><p>Automatically prioritized by urgency, operational risk and financial impact.</p></div><span className="count-pill">{filtered.length}</span></div><div className="action-list">{filtered.map(a=><button key={a.id} className={`action-row ${selectedId===a.id?'selected':''}`} onClick={()=>setSelectedId(a.id)}><div className={`severity ${a.severity.toLowerCase()}`}>{a.severity==='High'?'!':a.severity==='Medium'?'•':'○'}</div><div className="action-main"><div className="action-meta"><span>{a.location}</span><span>•</span><span>{a.category}</span>{a.automated&&<><span>•</span><span>AUTO · {a.priorityScore ?? 0}/100</span></>}</div><strong>{a.title}</strong><p>{a.signal}</p><div className="action-footer"><span className={`status ${a.status.toLowerCase()}`}>{a.status}</span><span className="impact">{a.impact}</span></div></div><span className="chev">›</span></button>)}</div></section>

            {selected&&<section className="panel detail-panel"><div className="detail-top"><div><span className={`severity-label ${selected.severity.toLowerCase()}`}>{selected.severity} priority{selected.automated?' · AUTOMATED':''}</span><h2>{selected.title}</h2><p>{selected.location} · {selected.category}</p></div><button className="icon-btn">•••</button></div>{selected.automated&&<div className="impact-box"><span>Priority score</span><strong>{selected.priorityScore}/100</strong></div>}<div className="detail-block"><label>SIGNAL</label><p>{selected.signal}</p></div><div className="detail-block"><label>LIKELY CAUSE</label><p>{selected.cause}</p></div><div className="detail-block recommendation"><label>OPSVISTA RECOMMENDATION</label><p>{selected.recommendation}</p></div><div className="impact-box"><span>Estimated impact</span><strong>{selected.impact}</strong></div>{selected.sources?.length&&<div className="detail-block"><label>SOURCE</label><p>{selected.sources.join(' · ')}{selected.detectedAt?` · Detected ${new Date(selected.detectedAt).toLocaleString()}`:''}</p></div>}{selected.owner&&<div className="owner-box"><div className="avatar small">{selected.owner.split(' ').map(x=>x[0]).join('').slice(0,2)}</div><div><span>Owner</span><strong>{selected.owner}</strong></div></div>}<div className="action-buttons"><button className="primary" onClick={()=>updateAction(selected.id,{status:'Assigned',owner:selected.owner??'Location Manager'})}>Assign owner</button><button onClick={()=>updateAction(selected.id,{status:'Assigned',owner:selected.owner??'Location Manager'})}>Create task</button><button onClick={()=>updateAction(selected.id,{status:'Investigating'})}>Investigate</button><button onClick={()=>updateAction(selected.id,{status:'Dismissed'})}>Dismiss</button></div><div className="verification"><strong>Verification loop</strong><p>Once completed, OpsVista should re-check the originating signal. If the issue remains unresolved, the automation key can reopen a fresh action; if corrected, the result is recorded as verified.</p><button onClick={()=>updateAction(selected.id,{status:'Completed'})}>Mark completed for demo</button></div></section>}
          </div>

          <section className="panel roadmap-panel"><div className="panel-header"><div><h2>Intelligence stack</h2><p>All operational signals feed the same deduplicated Action Center workflow.</p></div></div><div className="roadmap-grid"><div><span>01</span><strong>Evidence Audit</strong><p>Human-reviewed proof, corrections and audit history.</p></div><div><span>02</span><strong>Ramp Compliance</strong><p>Receipt, memo, deadline, duplicate and policy signals.</p></div><div><span>03</span><strong>Labor Intelligence</strong><p>Forecast, labor, overtime and savings opportunities.</p></div><div><span>04</span><strong>Rules v2</strong><p>Automatic creation, deduplication, scoring and verification.</p></div></div></section>
        </>}
      </div>
    </main>
  </div>;
}
