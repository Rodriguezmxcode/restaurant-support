import { useEffect, useMemo, useState } from 'react';
import {
  evaluateRampCompliance,
  groupRampCompliance,
  rampComplianceSummary,
  rampFlagLabels,
  type RampComplianceGroup,
  type RampComplianceResult,
  type RampTransaction,
} from './rampCompliance';
import { loadRampTransactions } from './rampDataSource';
import { scopeRampTransactionsForLocations } from '../shared/rampAccess';
import CustomDateRangePicker from './CustomDateRangePicker';
import './rampCompliance.css';
import MaxDataInsights from './MaxDataInsights';

type Escalation = {
  location: string;
  title: string;
  signal: string;
  cause: string;
  recommendation: string;
  impact: string;
  severity: 'High' | 'Medium' | 'Low';
};

type Props = {
  onEscalate?: (item: Escalation) => void;
  allowedLocations: string[];
  managerMode?: boolean;
};
type RampSourceState = 'loading' | 'live' | 'error';
type RampPeriod = 'today' | 'yesterday' | 'this_week' | 'prior_week' | 'last_30' | 'custom';

const periodLabels: Record<RampPeriod, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  prior_week: 'Previous week',
  last_30: 'Last 30 days',
  custom: 'Custom',
};

const stored = (key: string) => typeof window === 'undefined' ? '' : window.localStorage.getItem(key) || '';
function addDays(iso: string, days: number) { const date = new Date(`${iso}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function easternToday() { const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const value = Object.fromEntries(parts.map(part => [part.type, part.value])); return `${value.year}-${value.month}-${value.day}`; }
function operatingWeekStart(date: string) { const day = new Date(`${date}T00:00:00.000Z`).getUTCDay(); return addDays(date, -((day - 3 + 7) % 7)); }
function selectedRange(period: RampPeriod, customStart: string, customEnd: string) {
  const today = easternToday();
  const weekStart = operatingWeekStart(today);
  if (period === 'yesterday') { const date = addDays(today, -1); return { fromDate: date, toDate: date }; }
  if (period === 'this_week') return { fromDate: weekStart, toDate: today };
  if (period === 'prior_week') return { fromDate: addDays(weekStart, -7), toDate: addDays(weekStart, -1) };
  if (period === 'last_30') return { fromDate: addDays(today, -29), toDate: today };
  if (period === 'custom') return { fromDate: customStart || today, toDate: customEnd || today };
  return { fromDate: today, toDate: today };
}

const money = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD'
}).format(value);

function rampDateTime(transaction: RampTransaction) {
  const value = transaction.transactionTime ? new Date(transaction.transactionTime) : null;
  if (!value || !Number.isFinite(value.getTime())) return transaction.date;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(value);
}

function FlagPills({ transaction }: { transaction: RampComplianceResult }) {
  if (!transaction.flags.length) return <span className="ramp-flag compliant">Compliant</span>;
  return <div className="ramp-flags">{transaction.flags.map(flag =>
    <span key={flag} className={`ramp-flag ${flag}`}>{rampFlagLabels[flag]}</span>
  )}</div>;
}

function GroupTable({ title, subtitle, rows, type }: {
  title: string;
  subtitle: string;
  rows: RampComplianceGroup[];
  type: 'cardholder' | 'location';
}) {
  return <section className="ramp-group-panel">
    <div className="ramp-group-head">
      <div><h2>{title}</h2><p>{subtitle}</p></div>
      <span>{rows.length} {type === 'cardholder' ? 'people' : 'groups'}</span>
    </div>
    <div className="ramp-group-table-wrap"><table className="ramp-group-table">
      <thead><tr>
        <th>{type === 'cardholder' ? 'Cardholder' : 'Department / Restaurant'}</th>
        <th>Score</th><th>Transactions</th><th>Exceptions</th><th>Overdue &gt;48h</th><th>Receipts</th><th>Memos</th><th>Exposed spend</th>
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.key}>
        <td><strong>{row.key}</strong><small>{money(row.totalSpend)} total spend</small></td>
        <td><span className={`ramp-score-pill ${row.score >= 90 ? 'good' : row.score >= 70 ? 'watch' : 'bad'}`}>{row.score}</span></td>
        <td>{row.totalTransactions}</td>
        <td><strong className={row.exceptionTransactions ? 'attention-text' : ''}>{row.exceptionTransactions}</strong>{row.critical > 0 && <small>{row.critical} critical</small>}</td>
        <td><strong className={row.overdue ? 'overdue-text' : ''}>{row.overdue}</strong></td>
        <td>{row.missingReceipts}</td>
        <td>{row.missingMemos}</td>
        <td className="amount-cell">{money(row.exposedSpend)}</td>
      </tr>)}{!rows.length && <tr><td colSpan={8} className="ramp-empty-row">No Ramp transactions were returned for this period.</td></tr>}</tbody>
    </table></div>
  </section>;
}

const rampAppUrl = 'https://app.ramp.com/';

export default function RampComplianceView({ onEscalate, allowedLocations, managerMode = false }: Props) {
  const today = useMemo(easternToday, []);
  const locationScopeKey = allowedLocations.join('|');
  const periodStorageKey = managerMode ? 'opsvista-ramp-manager-period' : 'opsvista-ramp-period';
  const [period, setPeriod] = useState<RampPeriod>(() => {
    const saved = stored(periodStorageKey) as RampPeriod;
    return saved in periodLabels ? saved : managerMode ? 'last_30' : 'today';
  });
  const [customStart, setCustomStart] = useState(() => stored('opsvista-ramp-custom-start') || today);
  const [customEnd, setCustomEnd] = useState(() => stored('opsvista-ramp-custom-end') || today);
  const range = useMemo(() => selectedRange(period, customStart, customEnd), [period, customStart, customEnd]);
  const rangeDays = Math.floor((Date.parse(`${range.toDate}T00:00:00Z`) - Date.parse(`${range.fromDate}T00:00:00Z`)) / 86_400_000) + 1;
  const rangeError = !range.fromDate || !range.toDate || range.fromDate > range.toDate
    ? 'Choose a valid start and end date.'
    : rangeDays > 31 ? 'Custom Ramp ranges can include up to 31 days.' : undefined;
  const [transactions, setTransactions] = useState<RampTransaction[]>([]);
  const [dataSource, setDataSource] = useState<RampSourceState>('loading');
  const [dataWarning, setDataWarning] = useState<string | undefined>();
  const [fetchedAt, setFetchedAt] = useState<string | undefined>();
  const [identifiedCardholders, setIdentifiedCardholders] = useState<number | undefined>();
  const [rampAdapterVersion, setRampAdapterVersion] = useState<string | undefined>();
  const [status, setStatus] = useState(managerMode ? 'Needs attention' : 'All');
  const [restaurantFilter, setRestaurantFilter] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<RampComplianceResult | null>(null);
  const [escalated, setEscalated] = useState<string[]>([]);

  const refresh = async () => {
    if (rangeError) {
      setTransactions([]);
      setDataSource('error');
      setDataWarning(rangeError);
      return;
    }
    setDataSource('loading');
    setDataWarning(undefined);
    const envelope = await loadRampTransactions(range);
    const visibleTransactions = managerMode ? scopeRampTransactionsForLocations(envelope.transactions,allowedLocations) : envelope.transactions;
    setTransactions(visibleTransactions);
    setDataSource(envelope.source);
    setDataWarning(envelope.warning);
    setFetchedAt(envelope.fetchedAt);
    setIdentifiedCardholders(managerMode ? new Set(visibleTransactions.map(transaction=>transaction.cardholder).filter(Boolean)).size : envelope.userEnrichment?.matchedTransactions);
    setRampAdapterVersion(envelope.serverVersion);
  };

  useEffect(() => {
    window.localStorage.setItem(periodStorageKey, period);
    window.localStorage.setItem('opsvista-ramp-custom-start', customStart);
    window.localStorage.setItem('opsvista-ramp-custom-end', customEnd);
  }, [period, customStart, customEnd, periodStorageKey]);

  useEffect(() => { void refresh(); }, [range.fromDate, range.toDate, rangeError, managerMode, locationScopeKey]);

  const results = useMemo(() => evaluateRampCompliance(transactions), [transactions]);
  const summary = useMemo(() => rampComplianceSummary(results), [results]);
  const cardholderRows = useMemo(() => groupRampCompliance(results, 'cardholder'), [results]);
  const locationRows = useMemo(() => groupRampCompliance(results, 'department'), [results]);
  const overdueRows = useMemo(() => results.filter(tx => tx.overdue), [results]);
  const restaurantOptions = useMemo(() => [...new Set(results.map(tx => tx.restaurant || tx.department).filter(Boolean) as string[])].sort(), [results]);
  const roleOptions = useMemo(() => [...new Set(results.map(tx => tx.role).filter(Boolean) as string[])].sort(), [results]);

  const filtered = results.filter(tx => {
    const statusMatch = status === 'All' || tx.complianceStatus === status || (status === 'Overdue >48h' && tx.overdue);
    const restaurantMatch = restaurantFilter === 'All' || tx.restaurant === restaurantFilter || (!tx.restaurant && tx.department === restaurantFilter);
    const roleMatch = roleFilter === 'All' || tx.role === roleFilter;
    const q = query.trim().toLowerCase();
    const queryMatch = !q || [tx.merchant, tx.merchantLocation, tx.cardholder, tx.role, tx.department, tx.restaurant, tx.entity, tx.category, tx.accountingCategory, tx.cardLastFour, tx.memo, ...tx.flags]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
    return statusMatch && restaurantMatch && roleMatch && queryMatch;
  });

  const escalationFor = (tx: RampComplianceResult): Escalation => ({
    location: tx.restaurant?.trim() || tx.department?.trim() || 'Corporate',
    title: `${tx.merchant} requires Ramp compliance follow-up`,
    signal: `${tx.flags.length} compliance issue${tx.flags.length === 1 ? '' : 's'} detected on a ${money(tx.amount)} Ramp transaction${tx.overdue ? `; evidence is ${tx.ageHours}h old` : ''}.`,
    cause: tx.flags.map(flag => rampFlagLabels[flag]).join(', '),
    recommendation: `Have ${tx.cardholder || 'the cardholder'} complete the missing Ramp requirements and verify the transaction before closing the action.`,
    impact: `${money(tx.amount)} spend requiring compliance review`,
    severity: tx.complianceStatus === 'Critical' ? 'High' : 'Medium',
  });

  const escalate = (tx: RampComplianceResult) => {
    onEscalate?.(escalationFor(tx));
    setEscalated(ids => ids.includes(tx.id) ? ids : [...ids, tx.id]);
  };

  const escalateOverdue = () => {
    const pending = overdueRows.filter(tx => !escalated.includes(tx.id));
    pending.forEach(tx => onEscalate?.(escalationFor(tx)));
    setEscalated(ids => [...new Set([...ids, ...pending.map(tx => tx.id)])]);
  };

  const sourceLabel = dataSource === 'live' ? 'LIVE RAMP DATA' : dataSource === 'error' ? 'RAMP CONNECTION ERROR' : 'CONNECTING...';
  const sourceTitle = dataSource === 'live' ? 'Connected to Ramp' : dataSource === 'error' ? 'Ramp data unavailable' : 'Connecting to Ramp...';

  return <div className="ramp-page">
    {managerMode&&<section className="ramp-manager-scope"><div><span>ACCESO POR LOCACIÓN · SOLO LECTURA</span><strong>{allowedLocations.join(', ')||'Sin locación asignada'}</strong><p>Solo se muestran transacciones con una asignación de restaurante verificada. Revisa lo pendiente aquí y completa el memo o el recibo directamente en Ramp.</p></div><a href={rampAppUrl} target="_blank" rel="noreferrer">Abrir Ramp ↗</a></section>}
    <section className="ramp-filter-bar">
      <label className="ramp-period-control"><span>Period</span><select value={period} onChange={event => setPeriod(event.target.value as RampPeriod)}>{Object.entries(periodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <CustomDateRangePicker active={period === 'custom'} start={customStart} end={customEnd} maxDate={today} maxRangeDays={31} onApply={(start, end) => { setCustomStart(start); setCustomEnd(end); }} ariaLabel="Seleccionar periodo de gastos Ramp" />
      <div className="ramp-period-summary"><span>RESULTS SHOWN</span><strong>{periodLabels[period]} · {range.fromDate} → {range.toDate}</strong><small>Live Ramp transactions for the selected Connecticut operating period. Weeks run Wednesday–Tuesday.</small></div>
    </section>
    <section className={`ramp-live-strip ${dataSource === 'error' ? 'connection-error' : ''}`}>
      <div>
        <span className={`ramp-source-badge ${dataSource}`}>{sourceLabel}</span>
        <strong>{sourceTitle}</strong>
        <small>{dataWarning || (fetchedAt ? `Last sync ${new Date(fetchedAt).toLocaleString()} · ${transactions.length} transactions · ${identifiedCardholders ?? 0} cardholders identified${rampAdapterVersion ? ` · ${rampAdapterVersion}` : ''}` : 'Checking secure server connection')}</small>
      </div>
      <button onClick={() => void refresh()} disabled={dataSource === 'loading'}>↻ Refresh Ramp</button>
    </section>

    {dataSource === 'error' && <section className="ramp-production-warning">
      <strong>Live Ramp data is required here.</strong>
      <span>OpsVista did not substitute test transactions. Configure the existing Ramp credentials in the deployment environment and refresh.</span>
    </section>}

    <section className="ramp-summary-grid">
      <article className="ramp-summary-card hero-spend"><span>TOTAL RAMP SPEND</span><strong>{money(summary.totalSpend)}</strong><p>{summary.total} transactions in the selected period</p></article>
      <article className="ramp-summary-card hero-score"><span>RAMP COMPLIANCE SCORE</span><strong>{summary.total ? summary.score : '—'}</strong><small>/100</small><p>{summary.total ? `${summary.compliant} of ${summary.total} transactions fully compliant` : 'No transactions returned for this period'}</p></article>
      <article className="ramp-summary-card overdue-card"><span>OVERDUE &gt;48H</span><strong>{summary.overdue}</strong><p>{money(summary.overdueSpend)} missing receipt or memo past deadline</p></article>
      <article className="ramp-summary-card attention"><span>REQUIRES ATTENTION</span><strong>{summary.needsAttention}</strong><p>{money(summary.exposedSpend)} exposed spend</p></article>
      <article className="ramp-summary-card"><span>MISSING RECEIPTS</span><strong>{summary.missingReceipts}</strong><p>Receipt evidence required</p></article>
      <article className="ramp-summary-card"><span>MISSING MEMOS</span><strong>{summary.missingMemos}</strong><p>Purpose of spend incomplete</p></article>
    </section>

    {!managerMode&&!!locationRows.length&&<MaxDataInsights title="Gasto expuesto y cumplimiento" subtitle="Comparación por restaurante o departamento; los filtros cruzados revelan dónde falta evidencia y cuánto gasto está en riesgo." rows={locationRows.map(row=>({location:row.key,primary:row.exposedSpend,secondary:row.score,status:row.score<70?'bad':row.score<90?'watch':'good'}))} primaryLabel="Gasto expuesto" secondaryLabel="Compliance score" primaryFormat={value=>money(value)} secondaryFormat={value=>`${value.toFixed(0)} / 100`} conclusion={filtered=>{if(!filtered.length)return['Sin gastos para este filtro.'];const exposure=[...filtered].sort((a,b)=>b.primary-a.primary);const compliance=[...filtered].sort((a,b)=>(a.secondary??100)-(b.secondary??100));const alerts=filtered.filter(row=>row.status!=='good');return[`${exposure[0].location} concentra ${money(exposure[0].primary)} de gasto expuesto.`,`${compliance[0].location} tiene el menor compliance score: ${(compliance[0].secondary??0).toFixed(0)} / 100.`,alerts.length?`Solicita recibos y memos en ${alerts.map(row=>row.location).join(', ')}.`:'Todas las unidades visibles alcanzan 90 puntos o más.'];}}/>}

    <section className="ramp-policy-strip">
      <div><strong>OpsVista Compliance Policy</strong><span>Cardholder, restaurant/department, memo and receipt are required. Missing receipt or memo becomes overdue after 48 hours.</span></div>
      <div className="ramp-policy-actions"><div className="ramp-policy-chips"><span>Cardholder</span><span>Department / Restaurant</span><span>Memo</span><span>Receipt</span><span>48h deadline</span></div>{!managerMode&&<button className="ramp-escalate-all" onClick={escalateOverdue} disabled={!overdueRows.some(tx => !escalated.includes(tx.id))}>⚡ Send overdue to Action Center</button>}</div>
    </section>

    <section className={`ramp-accountability-grid ${managerMode?'manager-view':''}`}>
      <GroupTable title="Compliance by Cardholder" subtitle="See who is consistently closing receipts and memos — and who needs follow-up." rows={cardholderRows} type="cardholder" />
      {!managerMode&&<GroupTable title="Compliance by Location" subtitle="Compare missing evidence and exposed spend across restaurants and departments." rows={locationRows} type="location" />}
    </section>

    <section className="ramp-table-panel">
      <div className="ramp-table-head">
        <div><h2>Ramp Expense Ledger</h2><p>Every available Ramp field is tied to the selected period: cardholder, merchant, restaurant, department, purpose and evidence.</p></div>
        <div className="ramp-controls">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search merchant, cardholder, memo..."/>
          {!managerMode&&<select aria-label="Filter by restaurant or department" value={restaurantFilter} onChange={e => setRestaurantFilter(e.target.value)}><option>All</option>{restaurantOptions.map(value => <option key={value}>{value}</option>)}</select>}
          <select aria-label="Filter by role" value={roleFilter} onChange={e => setRoleFilter(e.target.value)}><option>All</option>{roleOptions.map(value => <option key={value}>{value}</option>)}</select>
          <select aria-label="Filter by compliance status" value={status} onChange={e => setStatus(e.target.value)}><option>All</option><option>Overdue &gt;48h</option><option>Critical</option><option>Needs attention</option><option>Compliant</option></select>
        </div>
      </div>
      <div className="ramp-table-wrap"><table className={`ramp-table ${managerMode?'manager-view':''}`}>
        <thead><tr><th>Date / time</th><th>Age</th><th>{managerMode?'Cardholder':'Cardholder / card'}</th>{!managerMode&&<th>Role / position</th>}<th>Merchant / place</th><th>Restaurant</th><th>Department</th>{!managerMode&&<><th>Category</th><th>Entity</th></>}<th>Memo</th><th>Amount</th><th>Receipt / state</th><th>Compliance</th><th></th></tr></thead>
        <tbody>{filtered.map(tx => <tr key={tx.id} className={tx.overdue ? 'overdue-row' : tx.complianceStatus === 'Critical' ? 'critical-row' : ''}>
          <td><strong>{tx.date}</strong><small>{rampDateTime(tx)}</small></td><td><strong className={tx.overdue ? 'overdue-text' : ''}>{tx.ageHours}h</strong></td>
          <td className={!tx.cardholder ? 'missing-cell' : ''}><strong>{tx.cardholder || 'Not identified'}</strong>{!managerMode&&<small>{tx.cardLastFour ? `Card •••• ${tx.cardLastFour}` : 'Card not returned'}</small>}</td>
          {!managerMode&&<td className={!tx.role ? 'missing-cell' : ''}>{tx.role || 'Not assigned'}</td>}
          <td><strong>{tx.merchant}</strong><small>{tx.merchantLocation || 'Merchant location not returned'}</small></td>
          <td className={!tx.restaurant ? 'missing-cell' : ''}>{tx.restaurant || 'Unassigned'}</td>
          <td className={!tx.department ? 'missing-cell' : ''}>{tx.department || 'Unassigned'}</td>
          {!managerMode&&<><td>{tx.category || tx.accountingCategory || 'Not categorized'}</td><td>{tx.entity || 'Not returned'}</td></>}
          <td className={!tx.memo ? 'missing-cell' : ''}>{tx.memo || 'Memo missing'}</td>
          <td className="amount-cell">{money(tx.amount)}</td><td><strong>{tx.receiptAttached ? 'Receipt attached' : 'Receipt missing'}</strong><small>{tx.state}</small></td><td><FlagPills transaction={tx}/></td>
          <td><button className="ramp-review-btn" onClick={() => setSelected(tx)}>Review</button></td>
        </tr>)}{!filtered.length && <tr><td colSpan={managerMode?11:14} className="ramp-empty-row">{transactions.length ? 'No transactions match the current search or status filter.' : managerMode?'No hay gastos asignados de forma verificable a tus locaciones durante este periodo.':'Ramp returned no transactions for the selected period.'}</td></tr>}</tbody>
      </table></div>
    </section>

    {selected && <div className="ramp-drawer-backdrop" onClick={() => setSelected(null)}><aside className="ramp-drawer" onClick={e => e.stopPropagation()}>
      <div className="ramp-drawer-head"><div><span>RAMP TRANSACTION</span><h2>{selected.merchant}</h2><p>{rampDateTime(selected)} · {money(selected.amount)} · {selected.ageHours}h old</p></div><button onClick={() => setSelected(null)}>×</button></div>
      <div className="ramp-detail-score"><span>Compliance score</span><strong>{selected.score}/100</strong><em className={selected.complianceStatus.toLowerCase().replace(' ', '-')}>{selected.complianceStatus}</em></div>
      <div className="ramp-detail-grid"><div><label>Cardholder</label><strong>{selected.cardholder || 'Not identified'}</strong></div>{!managerMode&&<><div><label>Role / position</label><strong>{selected.role || 'Not assigned'}</strong></div><div><label>Card</label><strong>{selected.cardLastFour ? `•••• ${selected.cardLastFour}` : 'Not returned'}</strong></div></>}<div><label>Merchant place</label><strong>{selected.merchantLocation || 'Not returned'}</strong></div><div><label>Restaurant / location</label><strong>{selected.verifiedRestaurant || selected.restaurant || 'Unassigned'}</strong></div><div><label>Department</label><strong>{selected.department || 'Unassigned'}</strong></div>{!managerMode&&<><div><label>Business entity</label><strong>{selected.entity || 'Not returned'}</strong></div><div><label>Ramp category</label><strong>{selected.category || 'Not categorized'}</strong></div><div><label>Accounting category</label><strong>{selected.accountingCategory || 'Not returned'}</strong></div></>}<div><label>Memo</label><strong>{selected.memo || 'Missing'}</strong></div><div><label>Receipt</label><strong>{selected.receiptAttached ? 'Attached' : 'Missing'}</strong></div><div><label>Transaction state</label><strong>{selected.state}</strong></div><div><label>Deadline</label><strong>{selected.overdue ? 'Overdue' : 'Within 48h'}</strong></div></div>
      <div className="ramp-drawer-section"><label>DETECTED ISSUES</label><FlagPills transaction={selected}/></div>
      {selected.flags.length > 0 && <div className="ramp-recommendation"><label>OPSVISTA RECOMMENDATION</label><p>{managerMode?(selected.overdue?'Open Ramp now and complete the missing memo or receipt. This transaction is already past the 48-hour deadline.':'Open Ramp and complete every missing memo or receipt before the 48-hour deadline.'):(selected.overdue?'This transaction is past the 48-hour evidence deadline. Escalate it now and require the missing memo/receipt before the action can be closed.':'Complete all missing compliance fields, verify any duplicate or anomaly signal, and retain the receipt as supporting evidence before closing this transaction.')}</p></div>}
      <div className="ramp-drawer-actions">{managerMode?<a className="ramp-primary ramp-open-link" href={selected.rampUrl||rampAppUrl} target="_blank" rel="noreferrer">Abrir Ramp ↗</a>:selected.flags.length > 0 ? <button className="ramp-primary" disabled={escalated.includes(selected.id)} onClick={() => escalate(selected)}>{escalated.includes(selected.id) ? 'Added to Action Center' : 'Send to Action Center'}</button> : <button className="ramp-primary" disabled>Transaction compliant</button>}<button onClick={() => setSelected(null)}>Close</button></div>
    </aside></div>}
  </div>;
}
