import { useMemo, useState } from 'react';
import RampComplianceView from './RampComplianceView';
import LaborIntelligenceView from './LaborIntelligenceView';

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
};

type ExternalEscalation = Omit<ActionItem, 'id' | 'category' | 'status'>;

const initialActions: ActionItem[] = [
  {
    id: 1,
    location: 'Orange',
    category: 'Labor',
    title: 'Labor projected above target',
    severity: 'High',
    status: 'Open',
    signal: 'Projected labor is 24.8% while the current target is 21.0%.',
    cause: 'Sales are trending 13% below forecast while closing coverage remains above comparable demand.',
    recommendation: 'Review closing coverage and reduce approximately 9 labor hours if demand does not recover.',
    impact: '$176 estimated savings tonight',
  },
  {
    id: 2,
    location: 'Fairfield',
    category: 'Expenses',
    title: 'Ramp transactions missing evidence',
    severity: 'Medium',
    status: 'Open',
    signal: '3 transactions are missing receipts or required memo detail.',
    cause: 'Transactions were imported but compliance fields are incomplete.',
    recommendation: 'Assign the cardholders to upload receipts and complete the memo before the compliance deadline.',
    impact: '$486.73 requiring evidence',
  },
  {
    id: 3,
    location: 'Stamford',
    category: 'Tasks',
    title: 'Closing evidence needs review',
    severity: 'Medium',
    status: 'Open',
    signal: '2 closing checklist items contain rejected or incomplete evidence.',
    cause: 'Submitted evidence does not clearly verify the required standard.',
    recommendation: 'Request resubmission and verify the corrected evidence before closing the shift workflow.',
    impact: '2 unresolved evidence items',
  },
  {
    id: 4,
    location: 'Danbury',
    category: 'Overtime',
    title: 'Overtime exposure increasing',
    severity: 'High',
    status: 'Assigned',
    signal: 'Current scheduling pattern can push the kitchen above the weekly overtime threshold.',
    cause: 'A small group of cooks is absorbing both peak coverage and late closing shifts.',
    recommendation: 'Move closing coverage to employees with lower accumulated hours and audit punches before payroll close.',
    impact: '$428 projected overtime exposure',
    owner: 'Manager on duty',
  },
];

const nav = [
  'Resumen', 'Locaciones', 'Ventas', 'Local Intelligence', 'Finanzas', 'Gastos',
  'Horarios', 'Tasks', 'Action Center', 'Prioridades', 'Pagos', 'Transferencias', 'Configuración',
];

const icon: Record<string, string> = {
  Resumen: '⌂', Locaciones: '▦', Ventas: '↗', 'Local Intelligence': '⌁', Finanzas: '▥', Gastos: '$',
  Horarios: '◷', Tasks: '☑', 'Action Center': '⚡', Prioridades: '⚑', Pagos: '$', Transferencias: '⇄', Configuración: '⚙',
};

function Metric({ label, value, note, tone }: { label: string; value: string; note: string; tone?: string }) {
  return <div className="metric-card">
    <div className="metric-label">{label}</div>
    <div className={`metric-value ${tone ?? ''}`}>{value}</div>
    <div className="metric-note">{note}</div>
  </div>;
}

export default function App() {
  const [section, setSection] = useState('Action Center');
  const [location, setLocation] = useState('All locations');
  const [actions, setActions] = useState(initialActions);
  const [selectedId, setSelectedId] = useState(1);
  const [search, setSearch] = useState('');

  const selected = actions.find(a => a.id === selectedId) ?? actions[0];
  const filtered = useMemo(() => actions.filter(a => {
    const inLocation = location === 'All locations' || a.location === location;
    const q = search.trim().toLowerCase();
    const matches = !q || [a.location, a.category, a.title, a.signal, a.cause].join(' ').toLowerCase().includes(q);
    return inLocation && matches;
  }), [actions, location, search]);

  const updateAction = (id: number, patch: Partial<ActionItem>) => {
    setActions(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  const escalateExternal = (item: ExternalEscalation, category: string) => {
    setActions(items => {
      const nextId = Math.max(0, ...items.map(action => action.id)) + 1;
      const nextAction: ActionItem = { ...item, id: nextId, category, status: 'Open' };
      setSelectedId(nextId);
      return [...items, nextAction];
    });
    setSection('Action Center');
    setLocation('All locations');
    setSearch('');
  };

  const openCount = actions.filter(a => !['Completed', 'Dismissed'].includes(a.status)).length;
  const highCount = actions.filter(a => a.severity === 'High' && !['Completed', 'Dismissed'].includes(a.status)).length;
  const isRamp = section === 'Gastos';
  const isLabor = section === 'Horarios';
  const isIntelligenceModule = isRamp || isLabor;

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">OV</div>
        <div><strong>OpsVista</strong><span>OPERATIONS CENTER</span><small>Account OPS-0001</small></div>
      </div>
      <nav>{nav.map(item => <button key={item} className={section === item ? 'active' : ''} onClick={() => setSection(item)}>
        <span className="nav-icon">{icon[item]}</span>{item}
      </button>)}</nav>
      <div className="user-card"><div className="avatar">RR</div><div><strong>Roberto Rodríguez</strong><span>Operaciones corporativas</span></div></div>
    </aside>

    <main>
      <header className="topbar">
        <div className="search-wrap"><span>⌕</span><input value={search} onChange={e => setSearch(e.target.value)} placeholder={isIntelligenceModule ? 'Buscar en OpsVista...' : 'Buscar incidente, ubicación o responsable...'} /></div>
        <div className="top-actions"><button>↻ Actualizar datos</button><button>Presentación OpsVista</button><button className="danger-outline">Cerrar sesión</button><button className="icon-btn">?</button><div className="avatar small">RR</div></div>
      </header>

      <div className="page">
        <div className="page-heading">
          <div><div className="eyebrow">{isRamp ? 'FINANCIAL ACCOUNTABILITY' : isLabor ? 'WORKFORCE INTELLIGENCE' : 'OPERATIONAL INTELLIGENCE'}</div><h1>{isRamp ? 'Gastos · Ramp Compliance' : isLabor ? 'Horarios · Labor Intelligence' : section}</h1><p>{isRamp ? 'Cada gasto debe mostrar quién lo hizo, dónde pertenece, por qué se hizo y contar con la evidencia requerida.' : isLabor ? 'Compara ventas, forecast, labor, SPLH y overtime para convertir desviaciones en acciones con impacto financiero.' : 'Detecta qué requiere atención, entiende la causa y convierte la señal en una acción verificable.'}</p></div>
          {!isIntelligenceModule && <div className="filters"><select value={location} onChange={e => setLocation(e.target.value)}><option>All locations</option><option>Stamford</option><option>Orange</option><option>Fairfield</option><option>Danbury</option><option>Avon</option><option>Southington</option></select><button className="primary">+ Nueva acción</button></div>}
        </div>

        {isRamp ? <RampComplianceView onEscalate={item => escalateExternal(item, 'Ramp Compliance')} /> : isLabor ? <LaborIntelligenceView onEscalate={item => escalateExternal(item, 'Labor Intelligence')} /> : <>
          <section className="metrics-grid">
            <Metric label="SALES TODAY" value="$82,461" note="+7.2% vs comparable period" />
            <Metric label="PROJECTED LABOR" value="21.3%" note="Current: 19.8% · Target: 21.0%" />
            <Metric label="SPLH" value="$63.40" note="Across active locations" />
            <Metric label="TASK COMPLETION" value="92.4%" note="1 location below target" />
            <Metric label="OPEN ACTIONS" value={String(openCount)} note={`${highCount} high priority`} tone={highCount ? 'warn' : ''} />
          </section>

          <section className="score-banner">
            <div><span>OpsVista Score</span><strong>87</strong><small>/100</small></div>
            <div className="score-copy"><strong>6 locations healthy · 1 requires attention</strong><span>Score combines labor, tasks, exceptions, compliance and unresolved operational actions.</span></div>
            <div className="health"><span className="dot green"></span>Healthy <span className="dot amber"></span>Watch <span className="dot red"></span>Action</div>
          </section>

          <div className="content-grid">
            <section className="panel action-list-panel">
              <div className="panel-header"><div><h2>Needs Action</h2><p>Prioritized by operational and financial impact.</p></div><span className="count-pill">{filtered.length}</span></div>
              <div className="action-list">{filtered.map(a => <button key={a.id} className={`action-row ${selectedId === a.id ? 'selected' : ''}`} onClick={() => setSelectedId(a.id)}>
                <div className={`severity ${a.severity.toLowerCase()}`}>{a.severity === 'High' ? '!' : a.severity === 'Medium' ? '•' : '○'}</div>
                <div className="action-main"><div className="action-meta"><span>{a.location}</span><span>•</span><span>{a.category}</span></div><strong>{a.title}</strong><p>{a.signal}</p><div className="action-footer"><span className={`status ${a.status.toLowerCase()}`}>{a.status}</span><span className="impact">{a.impact}</span></div></div>
                <span className="chev">›</span>
              </button>)}</div>
            </section>

            {selected && <section className="panel detail-panel">
              <div className="detail-top"><div><span className={`severity-label ${selected.severity.toLowerCase()}`}>{selected.severity} priority</span><h2>{selected.title}</h2><p>{selected.location} · {selected.category}</p></div><button className="icon-btn">•••</button></div>
              <div className="detail-block"><label>SIGNAL</label><p>{selected.signal}</p></div>
              <div className="detail-block"><label>LIKELY CAUSE</label><p>{selected.cause}</p></div>
              <div className="detail-block recommendation"><label>OPSVISTA RECOMMENDATION</label><p>{selected.recommendation}</p></div>
              <div className="impact-box"><span>Estimated impact</span><strong>{selected.impact}</strong></div>
              {selected.owner && <div className="owner-box"><div className="avatar small">{selected.owner.split(' ').map(x => x[0]).join('').slice(0,2)}</div><div><span>Owner</span><strong>{selected.owner}</strong></div></div>}
              <div className="action-buttons">
                <button className="primary" onClick={() => updateAction(selected.id, { status: 'Assigned', owner: selected.owner ?? 'Location Manager' })}>Assign owner</button>
                <button onClick={() => updateAction(selected.id, { status: 'Assigned', owner: selected.owner ?? 'Location Manager' })}>Create task</button>
                <button onClick={() => updateAction(selected.id, { status: 'Investigating' })}>Investigate</button>
                <button onClick={() => updateAction(selected.id, { status: 'Dismissed' })}>Dismiss</button>
              </div>
              <div className="verification"><strong>Verification loop</strong><p>Once the action is completed, OpsVista should compare the next measured result against the original signal and record whether the intervention worked.</p><button onClick={() => updateAction(selected.id, { status: 'Completed' })}>Mark completed for demo</button></div>
            </section>}
          </div>

          <section className="panel roadmap-panel">
            <div className="panel-header"><div><h2>Next intelligence layers</h2><p>These modules plug into the same Action Center workflow.</p></div></div>
            <div className="roadmap-grid">
              <div><span>01</span><strong>Evidence Audit</strong><p>Photo proof, approve/reject, resubmission, before/after and audit history.</p></div>
              <div><span>02</span><strong>Ramp Compliance</strong><p>Cardholder, department, memo, receipt, deadline, duplicate and policy signals.</p></div>
              <div><span>03</span><strong>Labor Intelligence</strong><p>Forecast vs schedule, overtime exposure, suggested cuts and verified savings.</p></div>
              <div><span>04</span><strong>OpsVista AI Copilot</strong><p>Explain why a KPI moved and turn recommendations into assignable actions.</p></div>
            </div>
          </section>
        </>}
      </div>
    </main>
  </div>;
}