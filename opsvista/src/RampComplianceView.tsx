import { useEffect, useMemo, useState } from 'react';
import {
  evaluateRampCompliance,
  rampComplianceSummary,
  rampFlagLabels,
  type RampComplianceResult,
  type RampTransaction,
} from './rampCompliance';
import { loadRampTransactions } from './rampDataSource';
import './rampCompliance.css';

type Escalation = {
  location: string;
  title: string;
  signal: string;
  cause: string;
  recommendation: string;
  impact: string;
  severity: 'High' | 'Medium' | 'Low';
};

type Props = { onEscalate?: (item: Escalation) => void };

const money = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD'
}).format(value);

function FlagPills({ transaction }: { transaction: RampComplianceResult }) {
  if (!transaction.flags.length) return <span className="ramp-flag compliant">Compliant</span>;
  return <div className="ramp-flags">{transaction.flags.map(flag =>
    <span key={flag} className={`ramp-flag ${flag}`}>{rampFlagLabels[flag]}</span>
  )}</div>;
}

export default function RampComplianceView({ onEscalate }: Props) {
  const [transactions, setTransactions] = useState<RampTransaction[]>([]);
  const [dataSource, setDataSource] = useState<'loading' | 'live' | 'demo'>('loading');
  const [dataWarning, setDataWarning] = useState<string | undefined>();
  const [fetchedAt, setFetchedAt] = useState<string | undefined>();
  const [status, setStatus] = useState('All');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<RampComplianceResult | null>(null);
  const [escalated, setEscalated] = useState<string[]>([]);

  const refresh = async () => {
    setDataSource('loading');
    const envelope = await loadRampTransactions();
    setTransactions(envelope.transactions);
    setDataSource(envelope.source);
    setDataWarning(envelope.warning);
    setFetchedAt(envelope.fetchedAt);
  };

  useEffect(() => { void refresh(); }, []);

  const results = useMemo(() => evaluateRampCompliance(transactions), [transactions]);
  const summary = useMemo(() => rampComplianceSummary(results), [results]);

  const filtered = results.filter(tx => {
    const statusMatch = status === 'All' || tx.complianceStatus === status;
    const q = query.trim().toLowerCase();
    const queryMatch = !q || [tx.merchant, tx.cardholder, tx.department, tx.memo, ...tx.flags]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
    return statusMatch && queryMatch;
  });

  const escalate = (tx: RampComplianceResult) => {
    const location = tx.department?.trim() || 'Corporate';
    onEscalate?.({
      location,
      title: `${tx.merchant} requires Ramp compliance follow-up`,
      signal: `${tx.flags.length} compliance issue${tx.flags.length === 1 ? '' : 's'} detected on a ${money(tx.amount)} Ramp transaction.`,
      cause: tx.flags.map(flag => rampFlagLabels[flag]).join(', '),
      recommendation: `Have ${tx.cardholder || 'the cardholder'} complete the missing Ramp requirements and verify the transaction before closing the action.`,
      impact: `${money(tx.amount)} spend requiring compliance review`,
      severity: tx.complianceStatus === 'Critical' ? 'High' : 'Medium',
    });
    setEscalated(ids => ids.includes(tx.id) ? ids : [...ids, tx.id]);
  };

  return <div className="ramp-page">
    <section className="ramp-live-strip">
      <div>
        <span className={`ramp-source-badge ${dataSource}`}>{dataSource === 'live' ? 'LIVE RAMP DATA' : dataSource === 'demo' ? 'DEMO DATA' : 'CONNECTING...'}</span>
        <strong>{dataSource === 'live' ? 'Connected to Ramp' : dataSource === 'demo' ? 'Live Ramp endpoint not available yet' : 'Connecting to Ramp...'}</strong>
        <small>{fetchedAt ? `Last sync ${new Date(fetchedAt).toLocaleString()}` : dataWarning || 'Checking secure server connection'}</small>
      </div>
      <button onClick={() => void refresh()} disabled={dataSource === 'loading'}>↻ Refresh Ramp</button>
    </section>

    <section className="ramp-summary-grid">
      <article className="ramp-summary-card hero-score"><span>RAMP COMPLIANCE SCORE</span><strong>{summary.score}</strong><small>/100</small><p>{summary.compliant} of {summary.total} transactions fully compliant</p></article>
      <article className="ramp-summary-card"><span>SPEND REVIEWED</span><strong>{money(summary.totalSpend)}</strong><p>{summary.total} transactions in current view</p></article>
      <article className="ramp-summary-card attention"><span>REQUIRES ATTENTION</span><strong>{summary.needsAttention}</strong><p>{money(summary.exposedSpend)} exposed spend</p></article>
      <article className="ramp-summary-card"><span>MISSING RECEIPTS</span><strong>{summary.missingReceipts}</strong><p>Receipt evidence required</p></article>
      <article className="ramp-summary-card"><span>MISSING MEMOS</span><strong>{summary.missingMemos}</strong><p>Purpose of spend incomplete</p></article>
      <article className="ramp-summary-card"><span>POSSIBLE DUPLICATES</span><strong>{summary.duplicates}</strong><p>Needs human verification</p></article>
    </section>

    <section className="ramp-policy-strip">
      <div><strong>OpsVista Compliance Policy</strong><span>Every Ramp transaction should identify who spent, where it belongs, why it was spent, and include required evidence.</span></div>
      <div className="ramp-policy-chips"><span>Cardholder</span><span>Department / Restaurant</span><span>Memo</span><span>Receipt</span></div>
    </section>

    <section className="ramp-table-panel">
      <div className="ramp-table-head">
        <div><h2>Ramp Compliance Queue</h2><p>Exceptions are prioritized before they become accounting or accountability problems.</p></div>
        <div className="ramp-controls"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search merchant, cardholder or flag..."/><select value={status} onChange={e => setStatus(e.target.value)}><option>All</option><option>Critical</option><option>Needs attention</option><option>Compliant</option></select></div>
      </div>
      <div className="ramp-table-wrap"><table className="ramp-table">
        <thead><tr><th>Date</th><th>Merchant</th><th>Cardholder</th><th>Department / Restaurant</th><th>Memo</th><th>Amount</th><th>Compliance</th><th></th></tr></thead>
        <tbody>{filtered.map(tx => <tr key={tx.id} className={tx.complianceStatus === 'Critical' ? 'critical-row' : ''}>
          <td>{tx.date}</td><td><strong>{tx.merchant}</strong><small>Ramp · {tx.state}</small></td>
          <td className={!tx.cardholder ? 'missing-cell' : ''}>{tx.cardholder || 'Not identified'}</td>
          <td className={!tx.department ? 'missing-cell' : ''}>{tx.department || 'Unassigned'}</td>
          <td className={!tx.memo ? 'missing-cell' : ''}>{tx.memo || 'Memo missing'}</td>
          <td className="amount-cell">{money(tx.amount)}</td><td><FlagPills transaction={tx}/></td>
          <td><button className="ramp-review-btn" onClick={() => setSelected(tx)}>Review</button></td>
        </tr>)}</tbody>
      </table></div>
    </section>

    {selected && <div className="ramp-drawer-backdrop" onClick={() => setSelected(null)}><aside className="ramp-drawer" onClick={e => e.stopPropagation()}>
      <div className="ramp-drawer-head"><div><span>RAMP TRANSACTION</span><h2>{selected.merchant}</h2><p>{selected.date} · {money(selected.amount)}</p></div><button onClick={() => setSelected(null)}>×</button></div>
      <div className="ramp-detail-score"><span>Compliance score</span><strong>{selected.score}/100</strong><em className={selected.complianceStatus.toLowerCase().replace(' ', '-')}>{selected.complianceStatus}</em></div>
      <div className="ramp-detail-grid"><div><label>Cardholder</label><strong>{selected.cardholder || 'Not identified'}</strong></div><div><label>Department / Restaurant</label><strong>{selected.department || 'Unassigned'}</strong></div><div><label>Memo</label><strong>{selected.memo || 'Missing'}</strong></div><div><label>Receipt</label><strong>{selected.receiptAttached ? 'Attached' : 'Missing'}</strong></div></div>
      <div className="ramp-drawer-section"><label>DETECTED ISSUES</label><FlagPills transaction={selected}/></div>
      {selected.flags.length > 0 && <div className="ramp-recommendation"><label>OPSVISTA RECOMMENDATION</label><p>Complete all missing compliance fields, verify any duplicate or anomaly signal, and retain the receipt as supporting evidence before closing this transaction.</p></div>}
      <div className="ramp-drawer-actions">{selected.flags.length > 0 ? <button className="ramp-primary" disabled={escalated.includes(selected.id)} onClick={() => escalate(selected)}>{escalated.includes(selected.id) ? 'Added to Action Center' : 'Send to Action Center'}</button> : <button className="ramp-primary" disabled>Transaction compliant</button>}<button onClick={() => setSelected(null)}>Close</button></div>
    </aside></div>}
  </div>;
}
