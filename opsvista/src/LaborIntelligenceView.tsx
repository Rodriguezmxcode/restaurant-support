import { useMemo, useState } from 'react';
import { evaluateLabor, laborDemoLocations, laborSummary, type LaborInsight } from './laborIntelligence';
import './laborIntelligence.css';

type LaborEscalation = {
  location: string;
  title: string;
  signal: string;
  cause: string;
  recommendation: string;
  impact: string;
  severity: 'High' | 'Medium' | 'Low';
};

type Props = { onEscalate?: (item: LaborEscalation) => void; allowedLocations?: string[] };

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const pct = (value: number) => `${value.toFixed(1)}%`;

export default function LaborIntelligenceView({ onEscalate, allowedLocations }: Props) {
  const rows = useMemo(() => {
    const evaluated = evaluateLabor(laborDemoLocations);
    return allowedLocations ? evaluated.filter(row => allowedLocations.includes(row.location)) : evaluated;
  }, [allowedLocations]);
  const summary = useMemo(() => laborSummary(rows), [rows]);
  const [selected, setSelected] = useState<LaborInsight | null>(rows[0] ?? null);
  const [escalated, setEscalated] = useState<string[]>([]);

  const sendToActionCenter = (row: LaborInsight) => {
    onEscalate?.({
      location: row.location,
      title: `${row.location} labor projected above plan`,
      signal: `Projected labor is ${pct(row.projectedLaborPct)} vs ${pct(row.targetLaborPct)} target; sales are ${pct(row.salesVsForecastPct)} vs forecast.`,
      cause: row.projectedOvertimeHours >= 4
        ? `Scheduled coverage is above demand and projected overtime is ${row.projectedOvertimeHours.toFixed(1)} hours.`
        : 'Scheduled labor remains above the cost level supported by the current sales forecast.',
      recommendation: row.suggestedCutHours > 0
        ? `Review remaining coverage and reduce up to ${row.suggestedCutHours.toFixed(1)} labor hours if demand does not recover. Protect peak and critical positions.`
        : 'Maintain coverage and continue monitoring sales pace before making cuts.',
      impact: `${money(row.projectedSavings)} potential labor savings; ${money(row.overtimeExposure)} overtime exposure`,
      severity: row.severity === 'Action' ? 'High' : row.severity === 'Watch' ? 'Medium' : 'Low',
    });
    setEscalated(items => items.includes(row.location) ? items : [...items, row.location]);
  };

  return <div className="labor-page">
    <section className="labor-summary-grid">
      <article className="labor-card labor-hero"><span>PROJECTED LABOR</span><strong>{pct(summary.projectedLaborPct)}</strong><p>Current labor {pct(summary.currentLaborPct)}</p></article>
      <article className="labor-card"><span>NET SALES</span><strong>{money(summary.sales)}</strong><p>Forecast {money(summary.forecast)}</p></article>
      <article className="labor-card"><span>SPLH</span><strong>{money(summary.splh)}</strong><p>Sales per labor hour</p></article>
      <article className="labor-card labor-warn"><span>POTENTIAL SAVINGS</span><strong>{money(summary.projectedSavings)}</strong><p>From forecast-aligned coverage</p></article>
      <article className="labor-card"><span>OT EXPOSURE</span><strong>{money(summary.overtimeExposure)}</strong><p>Projected premium cost</p></article>
      <article className="labor-card"><span>NEEDS ACTION</span><strong>{summary.actionCount}</strong><p>{summary.watchCount} additional watch locations</p></article>
    </section>

    <section className="labor-guidance">
      <div><strong>OpsVista Labor Guardrail</strong><span>Recommendations never cut blindly. Protect peak demand, required positions, service levels, prep and closing standards before reducing hours.</span></div>
      <div className="labor-guide-chips"><span>Forecast vs actual</span><span>Target labor %</span><span>SPLH</span><span>Overtime</span><span>Financial impact</span></div>
    </section>

    <section className="labor-panel">
      <div className="labor-panel-head"><div><h2>Labor Intelligence by Location</h2><p>Prioritized by labor gap, overtime exposure and recoverable cost.</p></div><span>{rows.length} locations</span></div>
      <div className="labor-table-wrap"><table className="labor-table">
        <thead><tr><th>Location</th><th>Sales vs Forecast</th><th>Current Labor</th><th>Projected Labor</th><th>Target</th><th>SPLH</th><th>Projected OT</th><th>Suggested Cut</th><th>Potential Savings</th><th>Status</th><th></th></tr></thead>
        <tbody>{rows.map(row => <tr key={row.location} className={row.severity === 'Action' ? 'labor-action-row' : ''}>
          <td><strong>{row.location}</strong></td>
          <td className={row.salesVsForecastPct < -5 ? 'labor-negative' : ''}>{pct(row.salesVsForecastPct)}</td>
          <td>{pct(row.currentLaborPct)}</td>
          <td><strong className={row.projectedLaborPct > row.targetLaborPct + 1 ? 'labor-negative' : ''}>{pct(row.projectedLaborPct)}</strong></td>
          <td>{pct(row.targetLaborPct)}</td>
          <td>{money(row.splh)}</td>
          <td>{row.projectedOvertimeHours.toFixed(1)}h</td>
          <td>{row.suggestedCutHours.toFixed(1)}h</td>
          <td className="labor-money">{money(row.projectedSavings)}</td>
          <td><span className={`labor-status ${row.severity.toLowerCase()}`}>{row.severity}</span></td>
          <td><button onClick={() => setSelected(row)}>Review</button></td>
        </tr>)}</tbody>
      </table></div>
    </section>

    {selected && <div className="labor-drawer-backdrop" onClick={() => setSelected(null)}><aside className="labor-drawer" onClick={e => e.stopPropagation()}>
      <div className="labor-drawer-head"><div><span>LABOR INTELLIGENCE</span><h2>{selected.location}</h2><p>Forecast-aware staffing recommendation</p></div><button onClick={() => setSelected(null)}>×</button></div>
      <div className="labor-drawer-grid">
        <div><label>Projected labor</label><strong>{pct(selected.projectedLaborPct)}</strong></div>
        <div><label>Target</label><strong>{pct(selected.targetLaborPct)}</strong></div>
        <div><label>Sales vs forecast</label><strong>{pct(selected.salesVsForecastPct)}</strong></div>
        <div><label>Projected OT</label><strong>{selected.projectedOvertimeHours.toFixed(1)}h</strong></div>
        <div><label>Suggested cut</label><strong>{selected.suggestedCutHours.toFixed(1)}h</strong></div>
        <div><label>Potential savings</label><strong>{money(selected.projectedSavings)}</strong></div>
      </div>
      <div className="labor-signal"><label>SIGNAL</label><p>{selected.location} is projected at {pct(selected.projectedLaborPct)} labor against a {pct(selected.targetLaborPct)} target while sales are {pct(selected.salesVsForecastPct)} versus forecast.</p></div>
      <div className="labor-recommendation"><label>OPSVISTA RECOMMENDATION</label><p>{selected.suggestedCutHours > 0 ? `Review the remaining schedule and reduce up to ${selected.suggestedCutHours.toFixed(1)} hours only if the sales pace does not recover. Protect rush coverage, prep, closing and required positions.` : 'No cut is recommended right now. Continue monitoring sales pace and overtime.'}</p></div>
      <div className="labor-impact"><span>Estimated financial impact</span><strong>{money(selected.projectedSavings)} potential savings</strong><small>{money(selected.overtimeExposure)} projected OT premium exposure</small></div>
      <div className="labor-actions"><button className="labor-primary" disabled={escalated.includes(selected.location) || selected.severity === 'Healthy'} onClick={() => sendToActionCenter(selected)}>{escalated.includes(selected.location) ? 'Added to Action Center' : selected.severity === 'Healthy' ? 'No action needed' : 'Send to Action Center'}</button><button onClick={() => setSelected(null)}>Close</button></div>
    </aside></div>}
  </div>;
}
