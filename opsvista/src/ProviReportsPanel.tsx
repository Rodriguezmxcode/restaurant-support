import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { parseProviImport, type ProviReport, type ProviResponse, type StoredProviReport } from '../shared/proviReports';
import ProviEvidencePanel from './ProviEvidencePanel';
import './proviReports.css';

const usd = (value: number | null) => value === null ? 'Pendiente' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const sum = (rows: ProviReport[]) => rows.reduce((total, row) => total + Math.round(row.spend * 100), 0) / 100;
const stamp = (value?: string) => value ? new Date(value).toLocaleString('es-MX', { timeZone: 'America/New_York' }) : 'Pendiente';
const periodKey = (row: ProviReport) => `${row.start} → ${row.end}`;
async function readReports(signal?: AbortSignal): Promise<ProviResponse> {
  const response = await fetch('/api/integrations/restaurant365?view=provi', { credentials: 'include', cache: 'no-store', signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'No se pudieron abrir los reportes guardados.');
  return body;
}

function InvoiceTable({ invoices }: { invoices: StoredProviReport['comparison']['invoices'] }) {
  return <div className="provi-scroll provi-invoices"><table><thead><tr><th>Fecha</th><th>Factura / crédito</th><th>Proveedor R365</th><th>Tipo</th><th>Monto</th><th>Estado</th></tr></thead><tbody>{invoices.map(row => <tr key={row.id}><td>{row.date}</td><td>{row.number || row.id}</td><td>{row.vendor}</td><td>{row.kind === 'credit' ? 'Crédito' : 'Factura'}</td><td>{usd(row.amount)}</td><td>{row.approved ? 'Aprobada' : 'Pendiente'}</td></tr>)}</tbody></table></div>;
}
function ReportDetail({ report }: { report: StoredProviReport }) {
  const [invoicesOpen, setInvoicesOpen] = useState(false);
  const [baselineOpen, setBaselineOpen] = useState(false);
  return <details className="provi-report-detail"><summary>{report.location} · {usd(report.spend)} · {report.orders} órdenes · {report.distributorCount} distribuidores</summary>
    <p>{report.productCount} productos en el reporte original. Se recibieron {report.topProducts.length} productos destacados; esta lista es parcial.</p>
    <div className="provi-scroll"><table><caption>Productos destacados de {report.location}</caption><thead><tr><th>Producto</th><th>Distribuidor Provi</th><th>Cantidad original</th><th>Compra reportada</th></tr></thead><tbody>{report.topProducts.map((item, index) => <tr key={`${item.name}:${index}`}><td>{item.name}</td><td>{item.distributor}</td><td>{item.quantity}</td><td>{usd(item.spend)}</td></tr>)}</tbody></table></div>
    <p className="provi-note">{report.sourceNote}</p>
    <details onToggle={event => setInvoicesOpen(event.currentTarget.open)}><summary>Ver {report.comparison.invoices.length} documentos de R365</summary>{invoicesOpen && <InvoiceTable invoices={report.comparison.invoices}/>}</details>
    {report.baseline && <details onToggle={event => setBaselineOpen(event.currentTarget.open)}><summary>Corte original de la revisión · {report.baseline.invoices.length} facturas · {stamp(report.baseline.capturedAt)}</summary>{baselineOpen && <><p>{report.baseline.note}</p><InvoiceTable invoices={report.baseline.invoices}/></>}</details>}
    <p className="provi-note">Guardado en OpsVista: {stamp(report.savedAt)} (Connecticut).</p>
  </details>;
}

export default function ProviReportsPanel({ locations, allowImport = false }: { locations?: string[]; allowImport?: boolean }) {
  const [data, setData] = useState<ProviResponse>({ reports: [], canImport: false });
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [period, setPeriod] = useState(''), [location, setLocation] = useState('');
  const [preview, setPreview] = useState<ProviReport[]>([]), [fileName, setFileName] = useState('');
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try { const body = await readReports(controller.signal); if (!controller.signal.aborted) { setData(body); setError(''); } }
      catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo leer OpsVista.'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load(); const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [reload]);
  const scopeKey = locations?.join('|') || '';
  const scoped = useMemo(() => data.reports.filter(row => !scopeKey || scopeKey.split('|').includes(row.location)), [data.reports, scopeKey]);
  const periods = useMemo(() => [...new Set([...scoped].sort((a, b) => b.end.localeCompare(a.end) || a.start.localeCompare(b.start)).map(periodKey))], [scoped]);
  const activePeriod = periods.includes(period) ? period : periods[0] || '';
  const locationOptions = [...new Set(scoped.filter(row => periodKey(row) === activePeriod).map(row => row.location))].sort();
  const activeLocation = locationOptions.includes(location) ? location : '';
  const rows = scoped.filter(row => periodKey(row) === activePeriod && (!activeLocation || row.location === activeLocation)).sort((a, b) => b.spend - a.spend);
  const previewPeriods = [...new Set(preview.map(periodKey))];
  const choose = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; setNotice(''); setError(''); setPreview([]);
    if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('El archivo puede tener hasta 2 MB.');
      const reports = parseProviImport(JSON.parse(await file.text()));
      setPreview(reports); setFileName(file.name);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Archivo inválido.'); }
  };
  const save = async () => {
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/integrations/restaurant365', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import-provi', data: { schemaVersion: 1, reports: preview } }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error || 'No se pudo guardar la carga.');
      setNotice(`${body.saved} reportes guardados en OpsVista. Repetir la carga actualiza el mismo período sin duplicarlo.`);
      setPreview([]); setData(await readReports());
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar.'); }
    finally { setSaving(false); }
  };
  return <section className="provi-panel" aria-label="Compras Provi guardadas">
    <header><div><h3>Compras Provi · reportes y evidencia</h3><p>Usa foto/PDF para adelantar compras del día y JSON para reportes completos. R365 sigue siendo la corroboración final.</p></div><button type="button" onClick={() => setReload(value => value + 1)} disabled={saving}>Consultar copia actualizada</button></header>
    {notice && <p role="status" className="provi-success">{notice}</p>}
    {error && <p role="alert" className="provi-warning">{error}</p>}
    {loading && <p role="status">Abriendo reportes guardados…</p>}

    <ProviEvidencePanel locations={locations} allowImport={allowImport}/>

    {allowImport && data.canImport && <details className="provi-import"><summary>Cargar reporte Provi JSON</summary>
      <p>Para reportes consolidados, selecciona el JSON preparado para OpsVista. Fotos y PDF se cargan arriba como compras provisionales.</p>
      <label>Archivo de reportes Provi <input aria-label="Archivo de reportes Provi" type="file" accept=".json,application/json" onChange={event => void choose(event)} disabled={saving}/></label>
      {preview.length > 0 && <div className="provi-preview"><strong>{fileName} · {preview.length} reportes · {preview.reduce((total, report) => total + report.topProducts.length, 0)} productos destacados</strong>
        {previewPeriods.map(key => <p key={key}>{key}: {preview.filter(row => periodKey(row) === key).length} locaciones · {usd(sum(preview.filter(row => periodKey(row) === key)))}</p>)}
        <p>Los períodos que se solapan se conservan como reportes separados y no se suman entre sí.</p>
        <button type="button" className="primary" disabled={saving} onClick={() => void save()}>{saving ? 'Guardando en OpsVista…' : 'Guardar reportes en OpsVista'}</button></div>}
    </details>}
    {!loading && !data.reports.length && <p>Aún no hay reportes Provi JSON guardados.</p>}
    {scoped.length > 0 && <><div className="provi-controls"><label>Período de Provi <select value={activePeriod} onChange={event => setPeriod(event.target.value)}>{periods.map(key => <option key={key}>{key}</option>)}</select></label><label>Locación de Provi <select value={activeLocation} onChange={event => setLocation(event.target.value)}><option value="">Todas las locaciones</option>{locationOptions.map(name => <option key={name}>{name}</option>)}</select></label></div>
      <div className="provi-totals"><strong>{usd(sum(rows))}</strong><span>{rows.length} locaciones · {rows.reduce((total, row) => total + row.orders, 0)} órdenes · {activePeriod}</span></div>
      <p className="provi-note">Los reportes JSON conservan sus fechas originales. La evidencia foto/PDF se atribuye primero a la fecha de orden y, al conciliarse, usa el monto real de R365 sin duplicarlo.</p>
      <div className="provi-scroll"><table><caption>Provi frente a R365 · mismo período por locación</caption><thead><tr><th>Locación</th><th>Provi</th><th>Facturas R365</th><th>Créditos</th><th>R365 neto</th><th>Diferencia R365 − Provi</th><th>Revisión</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.location}</th><td>{usd(row.spend)}</td><td>{usd(row.comparison.invoiceTotal)}<small>{row.comparison.invoiceCount} facturas · incluye pendientes</small></td><td>{usd(row.comparison.credits)}<small>{row.comparison.source === 'imported' ? 'Corte antes de créditos' : `${row.comparison.creditCount} créditos`}</small></td><td>{usd(row.comparison.net)}</td><td>{usd(row.comparison.difference)}<small>{row.comparison.source === 'imported' ? 'Antes de créditos' : 'Facturas − créditos − Provi'}</small></td><td><strong>{row.comparison.source === 'automatic' ? 'R365 automático' : row.comparison.source === 'imported' ? 'Corte de revisión guardado' : 'Sincronización inicial'}</strong><small>{row.comparison.covered}/{row.comparison.expected} bloques de R365 disponibles{row.comparison.pending ? ' · Actualización pendiente' : ' · Copia actualizada'}</small><small>{stamp(row.comparison.updatedAt)} (Connecticut)</small><small>{row.comparison.missingAmounts ? `${row.comparison.missingAmounts} documentos sin monto` : ''}</small></td></tr>)}</tbody></table></div>
      <p className="provi-warning">R365 se revisa aproximadamente cada 30 minutos y se concilia por la noche. Una compra de foto/PDF puede mostrarse provisionalmente, pero no debe cerrar puntos finales mientras su evidencia siga pendiente o ambigua.</p>
      {rows.map(report => <ReportDetail key={report.id} report={report}/>)}</>}
  </section>;
}
