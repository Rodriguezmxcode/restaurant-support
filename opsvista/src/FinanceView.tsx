import { useEffect, useState } from 'react';
import type { OpsVistaUser } from './accessControl';
import { useI18n } from './i18n';
import { calendarDays, companyFinanceResult, corporateFinanceKey, financeImportKeys, financeKey, financeLocations, financeMargin, parseFinanceImport, summarizeFinance, type CorporateFinanceRecord, type FinanceImport, type FinanceRecord, type SavedCorporateFinanceRecord, type SavedFinanceRecord } from '../shared/finance';
import './FinanceView.css';

const endpoint = '/api/workflows?resource=finance';
type Review = { batch: FinanceImport; expected: Record<string, string | null>; previous: SavedFinanceRecord[] };
function SourceDetails({ record }: { record: FinanceRecord }) {
  const { t, locale } = useI18n();
  const money = (n: number | null) => n === null ? t('Not available', 'No disponible') : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(n);
  return <details className="finance-source"><summary>{record.location} · {record.month} — {t('Source and notes', 'Fuente y notas')}</summary>
    <p><strong>{t('Payroll basis', 'Base de nómina')}:</strong> {record.payrollBasis}</p>
    <p><strong>{t('Ramp already included in expenses', 'Ramp ya incluido en gastos')}:</strong> {money(record.rampIncluded)}. {t('Corporate costs remain incomplete.', 'La integración de costos corporativos sigue incompleta.')}</p>
    <p><strong>{t('Extraordinary result, separate from operations', 'Resultado extraordinario, separado de la operación')}:</strong> {money(record.extraordinary)}</p>
    <ul>{record.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
    <p className="finance-file">{record.source.file}</p>
    <dl className="finance-references">{Object.entries(record.source.references).map(([key, ref]) => <div key={key}><dt>{({ sales: t('Sales', 'Ventas'), cogs: t('Cost', 'Costo'), labor: t('Labor', 'Nómina'), operatingExpenses: t('Expenses + occupancy', 'Gastos + ocupación'), operatingResult: t('Operating result', 'Resultado operativo'), extraordinary: t('Extraordinary', 'Extraordinarios'), rampIncluded: t('Ramp included', 'Ramp incluido') } as Record<string, string>)[key]}</dt><dd>{ref}</dd></div>)}</dl>
  </details>;
}

function CorporateReport({ records, corporate }: { records: FinanceRecord[]; corporate: CorporateFinanceRecord | undefined }) {
  const { t, locale } = useI18n();
  const money = (value: number | null) => value === null ? t('Pending', 'Pendiente') : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(value);
  const result = companyFinanceResult(records, corporate);
  return <section className="finance-panel"><h2>{t('Corporate office · monthly reconciliation', 'Oficina corporativa · conciliación mensual')}</h2>
    <p><strong>{result.reconciledResult === null ? t('Company result after corporate costs: pending', 'Resultado de la empresa después del corporativo: pendiente') : t('Provisional company result', 'Resultado provisional de la empresa')}{result.reconciledResult !== null && `: ${money(result.reconciledResult)}`}</strong></p>
    <p>{t('The restaurant total must be reduced by corporate expenses not already included in those P&L reports. Existing allocations must not be deducted twice.', 'Al total de los restaurantes se le resta el gasto corporativo que aún no esté incluido en esos P&L. Las asignaciones existentes no deben descontarse dos veces.')}</p>
    {corporate ? <><div className="finance-table-wrap"><table><thead><tr><th scope="col">{t('Corporate expense', 'Gasto corporativo')}</th><th scope="col">USD</th></tr></thead><tbody>{[
      [t('Labor', 'Nómina'), corporate.labor], [t('Operating expenses', 'Gastos operativos'), corporate.operatingExpenses], [t('Rent / occupancy', 'Renta / ocupación'), corporate.occupancy], ['COGS', corporate.cogs], [t('Other expenses', 'Otros gastos'), corporate.otherExpenses], [t('Reported corporate total', 'Total corporativo reportado'), corporate.totalExpenses],
    ].map(([label, value]) => <tr key={String(label)}><th scope="row">{label}</th><td>{money(Number(value))}</td></tr>)}</tbody></table></div>
      <p>{t('Portion already allocated in restaurant reports', 'Parte ya asignada en los P&L de los restaurantes')}: <strong>{money(corporate.alreadyAllocated)}</strong></p>
      {result.simpleDifference !== null && <div className="finance-notice"><strong>{t('Simple subtraction · pending reconciliation', 'Resta simple · pendiente de conciliación')}: {money(result.simpleDifference)}</strong><p>{t('Restaurant results minus the full corporate total. This reference may deduct expenses already allocated to restaurants and is not the reconciled company result.', 'Resultados de restaurantes menos el total corporativo completo. Esta referencia puede descontar gastos ya asignados a restaurantes y no es el resultado conciliado de la empresa.')}</p></div>}
      <p className="finance-file">{corporate.sourceLabel}</p><ul>{corporate.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
    </> : <p>{t('No corporate report imported for this month.', 'No hay reporte corporativo importado para este mes.')}</p>}
  </section>;
}

export function FinanceReport({ records, corporate = [] }: { records: FinanceRecord[]; corporate?: CorporateFinanceRecord[] }) {
  const { t, locale } = useI18n();
  const months = [...new Set([...records, ...corporate].map(row => row.month))].sort().reverse();
  const [selection, setSelection] = useState('');
  const [location, setLocation] = useState('all');
  const month = months.includes(selection) ? selection : months[0] || '';
  const selectedLocations = location === 'all' ? [...financeLocations] : financeLocations.filter(name => name === location);
  const selected = records.filter(row => row.month === month && selectedLocations.includes(row.location));
  const total = summarizeFinance(selected);
  const money = (n: number | null) => n === null ? '—' : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(n);
  const pct = (n: number | null) => n === null ? '—' : `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n)}%`;
  const labelMonth = (m: string) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${m}-01T12:00:00Z`));
  if (!records.length && !corporate.length) return <section className="finance-panel finance-empty"><h2>{t('Ready for your P&L reports', 'Listo para tus P&L')}</h2><p>{t('Import the reviewed Finance file to see sales, costs and operating results by restaurant.', 'Importa el archivo revisado de Finanzas para consultar ventas, costos y resultados operativos por restaurante.')}</p><p>{t('No reports imported yet.', 'Todavía no hay reportes importados.')}</p></section>;
  return <>
    <div className="finance-toolbar">
      <label>{t('Period', 'Período')}<select value={month} onChange={e => setSelection(e.target.value)}>{months.map(m => <option key={m} value={m}>{labelMonth(m)}</option>)}</select></label>
      <label>{t('Location', 'Locación')}<select value={location} onChange={e => setLocation(e.target.value)}><option value="all">{t('All six restaurants', 'Los seis restaurantes')}</option>{financeLocations.map(name => <option key={name}>{name}</option>)}</select></label>
      <span>{selected.length}/{selectedLocations.length} {t('reports available', 'reportes disponibles')} · USD</span>
    </div>
    <div className="finance-notice"><strong>{t('Provisional results', 'Resultados provisionales')}</strong><p>{t('Corporate costs are incomplete. Payroll methods and purchase timing can differ across restaurants and months; review source notes before comparing.', 'Los costos corporativos están incompletos. La base de nómina y el momento de las compras pueden variar entre restaurantes y meses; revisa las notas antes de comparar.')}</p>{month >= '2026-09' && <p>{t('Payroll criterion for this month', 'Criterio de nómina para este mes')}: {calendarDays(month)} {t('calendar days; each report retains its documented basis.', 'días calendario; cada reporte conserva su base documentada.')}</p>}</div>
    <div className="finance-metrics">{[
      [t('Net sales', 'Ventas netas'), money(total.sales)],
      [t('Reported cost', 'Costo reportado'), money(total.cogs)],
      [t('Reported labor', 'Nómina reportada'), money(total.labor)],
      [location === 'all' ? t('Sum of reported results', 'Suma de resultados reportados') : t('Operating result · P&L', 'Resultado operativo · P&L'), money(total.operatingResult)],
    ].map(([label, value]) => <section className="finance-metric" key={label}><span>{label}</span><strong>{value}</strong></section>)}</div>
    {location === 'all' && <CorporateReport records={selected} corporate={corporate.find(row => row.month === month)}/>}
    <p className="finance-caption">{t('Reported operating margin', 'Margen operativo reportado')}: <strong>{pct(total.margin)}</strong> · {t('Expenses and occupancy', 'Gastos y ocupación')}: {money(total.operatingExpenses)}. {selected.length !== selectedLocations.length && t('Partial total: only available reports are included.', 'Total parcial: solo incluye los reportes disponibles.')}</p>
    <section className="finance-panel"><h2>{t('Restaurant results', 'Resultados por restaurante')}</h2><div className="finance-table-wrap"><table><caption>{labelMonth(month)} · {t('provisional USD', 'USD provisionales')}</caption><thead><tr>{[t('Restaurant', 'Restaurante'), t('Sales', 'Ventas'), t('Cost', 'Costo'), t('Labor', 'Nómina'), t('Expenses + occupancy', 'Gastos + ocupación'), t('Operating result', 'Resultado operativo'), t('Margin', 'Margen')].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{selectedLocations.map(name => {
      const row = selected.find(r => r.location === name);
      return <tr key={name}><th scope="row">{name}</th>{row ? <><td>{money(row.sales)}</td><td>{money(row.cogs)}</td><td>{money(row.labor)}</td><td>{money(row.operatingExpenses)}</td><td className={row.operatingResult < 0 ? 'finance-negative' : 'finance-result'}>{money(row.operatingResult)}</td><td>{pct(financeMargin(row.operatingResult, row.sales))}</td></> : <td colSpan={6}>{t('No report for this period', 'Sin reporte para este período')}</td>}</tr>;
    })}</tbody></table></div></section>
    <section className="finance-panel"><h2>{t('Monthly comparison', 'Comparativa mensual')}</h2><p>{t('The original payroll and cost bases are preserved. These figures are not normalized.', 'Se conservan las bases originales de nómina y costos. Estas cifras no están homologadas.')}</p><div className="finance-table-wrap"><table><thead><tr>{[t('Month', 'Mes'), t('Coverage', 'Cobertura'), t('Sales', 'Ventas'), t('Operating result', 'Resultado operativo'), t('Margin', 'Margen')].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{[...months].reverse().map(m => {
      const rows = records.filter(row => row.month === m && selectedLocations.includes(row.location)), sum = summarizeFinance(rows);
      return <tr key={m}><th scope="row">{labelMonth(m)}</th><td>{rows.length}/{selectedLocations.length}</td><td>{money(sum.sales)}</td><td>{money(sum.operatingResult)}</td><td>{pct(sum.margin)}</td></tr>;
    })}</tbody></table></div></section>
    <section className="finance-panel"><h2>{t('Extraordinary items', 'Partidas extraordinarias')}</h2><p>{t('Shown separately from the operating result. Missing disclosure is not treated as zero.', 'Se muestran separadas del resultado operativo. Un dato no disponible no se interpreta como cero.')}</p><div className="finance-table-wrap"><table><thead><tr><th scope="col">{t('Restaurant', 'Restaurante')}</th><th scope="col">{t('Signed extraordinary result', 'Resultado extraordinario con signo')}</th></tr></thead><tbody>{selected.map(row => <tr key={row.location}><th scope="row">{row.location}</th><td>{row.extraordinary === null ? t('Not disclosed', 'No informado') : money(row.extraordinary)}</td></tr>)}</tbody></table></div></section>
    <section className="finance-panel"><h2>{t('Historical bank closing balances', 'Saldos bancarios de cierre histórico')}</h2><p>{t('From the bank reconciliation in each workbook. These are not current balances or available cash, and may not cover all accounts.', 'Proceden de la conciliación de cada archivo. No son saldos actuales ni efectivo disponible y pueden no incluir todas las cuentas.')}</p><div className="finance-table-wrap"><table><thead><tr>{[t('Restaurant', 'Restaurante'), t('As of', 'Fecha de corte'), t('Closing balance', 'Saldo al cierre'), t('Source / coverage', 'Fuente / cobertura')].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{selected.map(row => <tr key={row.location}><th scope="row">{row.location}</th><td>{row.bank?.asOf || '—'}</td><td>{row.bank ? money(row.bank.closingBalance) : t('Not available', 'No disponible')}</td><td className="finance-bank-note">{row.bank ? <>{row.bank.reference}<br/>{row.bank.note}</> : '—'}</td></tr>)}</tbody></table></div></section>
    <section className="finance-panel"><h2>{t('Sources and accounting criteria', 'Fuentes y criterios contables')}</h2>{selected.map(record => <SourceDetails key={financeKey(record)} record={record}/>)}</section>
  </>;
}

export default function FinanceView({ currentUser, readOnly }: { currentUser: OpsVistaUser; readOnly: boolean }) {
  const { t } = useI18n();
  const [saved, setSaved] = useState<SavedFinanceRecord[]>([]);
  const [savedCorporate, setSavedCorporate] = useState<SavedCorporateFinanceRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [review, setReview] = useState<Review | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const canImport = !readOnly && ['Founder', 'Corporate'].includes(currentUser.role);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoaded(false); setError(''); setReview(null);
    void (async () => {
      try {
        const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || 'Finanzas no está disponible.');
        setSaved(body.records); setSavedCorporate(body.corporate || []); setLoaded(true);
      } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Finanzas no está disponible.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [currentUser.id, loadVersion]);
  async function selectFile(file: File | undefined) {
    setReview(null); setError(''); setMessage('');
    if (!file) return;
    try {
      if (file.size > 450_000) throw new Error(t('The file is too large.', 'El archivo es demasiado grande.'));
      const batch = parseFinanceImport(JSON.parse(await file.text()));
      const current = new Map([...saved.map(row => [financeKey(row.record), row.revision] as const), ...savedCorporate.map(row => [corporateFinanceKey(row.record), row.revision] as const)]);
      const expected = Object.fromEntries(financeImportKeys(batch).map(key => [key, current.get(key) ?? null]));
      setReview({ batch, expected, previous: saved });
    } catch (err) { setError(err instanceof Error ? err.message : t('Invalid Finance file.', 'Archivo de Finanzas no válido.')); }
  }
  async function confirmImport() {
    if (!review || saving || !canImport) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const response = await fetch(endpoint, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-OpsVista-Finance': 'import' }, body: JSON.stringify({ batch: review.batch, expected: review.expected }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || t('Could not save.', 'No se pudo guardar.'));
      setMessage(`${t('Reports saved', 'Reportes guardados')}: ${body.saved}. ${t('Already present', 'Ya existentes')}: ${body.unchanged}.`);
      setReview(null); setLoadVersion(v => v + 1);
    } catch (err) { setError(err instanceof Error ? err.message : t('Could not confirm the save. Retry this file.', 'No se pudo confirmar el guardado. Reintenta el mismo archivo.')); }
    finally { setSaving(false); }
  }
  return <div className="finance-view">
    <div className="finance-scope">{t('Finance only · These P&L reports and criteria stay within this module.', 'Solo Finanzas · Estos P&L y sus criterios permanecen dentro de este módulo.')}</div>
    {message && <p role="status" className="finance-success">{message}</p>}
    {error && <div role="alert" className="finance-error">{error} <button disabled={saving} onClick={() => setLoadVersion(v => v + 1)}>{t('Reload reports', 'Actualizar reportes')}</button></div>}
    {loading && <p role="status">{t('Loading Finance…', 'Cargando Finanzas…')}</p>}
    {loaded && canImport && <section className="finance-panel"><h2>{t('Import reviewed P&L', 'Importar P&L revisados')}</h2><p>{t('Choose the consolidated Finance JSON file. Review its periods, figures and source notes before saving.', 'Selecciona el archivo JSON consolidado de Finanzas. Revisa períodos, cifras y notas de origen antes de guardar.')}</p><label className="finance-upload">{t('Finance file', 'Archivo de Finanzas')}<input type="file" accept=".json,application/json" disabled={saving} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void selectFile(file); }}/></label></section>}
    {loaded && review && <section className="finance-panel finance-review"><h2>{t('Review import', 'Revisar importación')}</h2><p>{review.batch.records.length} {t('restaurant reports', 'reportes de restaurantes')} + {review.batch.corporate.length} {t('corporate reports', 'reportes corporativos')} · {[...new Set([...review.batch.records, ...review.batch.corporate].map(row => row.month))].sort().join(' · ')}</p><p>{t('Existing reports will receive a new version if their content changes. Previous versions are retained.', 'Los reportes existentes recibirán una nueva versión si cambia su contenido. Las versiones anteriores se conservan.')}</p>
      {review.batch.records.map(record => { const old = review.previous.find(row => financeKey(row.record) === financeKey(record)); return <div key={financeKey(record)}><p><strong>{record.location} · {record.month}</strong> — {old ? t('Review replacement', 'Revisar actualización') : t('New report', 'Nuevo reporte')} · {t('Operating result', 'Resultado operativo')}: {old ? `${old.record.operatingResult.toFixed(2)} → ` : ''}{record.operatingResult.toFixed(2)} USD</p><SourceDetails record={record}/></div>; })}
      <FinanceReport records={review.batch.records} corporate={review.batch.corporate}/>
      <div className="finance-actions"><button className="primary" disabled={saving} onClick={() => void confirmImport()}>{saving ? t('Saving…', 'Guardando…') : t('Confirm and save in Finance', 'Confirmar y guardar en Finanzas')}</button><button disabled={saving} onClick={() => setReview(null)}>{t('Cancel', 'Cancelar')}</button></div>
    </section>}
    {loaded && !review && <FinanceReport records={saved.map(row => row.record)} corporate={savedCorporate.map(row => row.record)}/>}
    {loaded && saved.length > 0 && !review && <p className="finance-caption">{t('Last saved', 'Último guardado')}: {new Date(Math.max(...saved.map(row => new Date(row.savedAt).getTime()))).toLocaleString()}</p>}
  </div>;
}
