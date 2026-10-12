import { useEffect, useMemo, useState } from 'react';
import { useI18n } from './i18n';
import { categoryKey, categoryTotals, mergeCategoryReports, type CategorySalesReport, type CategorySalesRow } from '../shared/salesCategories';
import './salesCategories.css';

type Props = { start: string; end: string; locations: string[]; refresh: number };
const plusDays = (value: string, days: number) => new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export default function SalesCategoriesPanel({ start, end, locations, refresh }: Props) {
  const { t, language } = useI18n();
  const [state, setState] = useState<{ key: string; report: CategorySalesReport | null; loading: boolean; error: string; completed: number; total: number }>({ key: '', report: null, loading: true, error: '', completed: 0, total: 0 });
  const [category, setCategory] = useState('all');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(false);
  const [retry, setRetry] = useState(0);
  const locationKey = locations.join('|');
  const requestKey = JSON.stringify([start, end, locationKey, refresh, retry]);
  useEffect(() => {
    const controller = new AbortController();
    let failed = false;
    setCategory('all'); setExportError(false);
    const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
    if (!Number.isFinite(days) || days < 1 || days > 31 || !locations.length) {
      setState({ key: requestKey, report: null, loading: false, error: 'range', completed: 0, total: 0 });
      return () => controller.abort();
    }
    // Each request loads at most one week/location, avoiding one oversized
    // request for an entire month's orders across all restaurants.
    const jobs = locations.flatMap(location => {
      const result: { location: string; start: string; end: string }[] = [];
      for (let day = start; day <= end; day = plusDays(day, 7)) result.push({ location, start: day, end: plusDays(day, 6) < end ? plusDays(day, 6) : end });
      return result;
    });
    setState({ key: requestKey, report: null, loading: true, error: '', completed: 0, total: jobs.length });
    const reports: CategorySalesReport[] = [];
    let next = 0;
    const worker = async () => {
      while (!controller.signal.aborted && next < jobs.length) {
        const job = jobs[next++];
        const params = new URLSearchParams({ sales_categories: 'true', ...job });
        const response = await fetch(`/api/operations/performance?${params}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 401 ? 'session' : response.status === 403 ? 'access' : 'source');
        const report = await response.json() as CategorySalesReport;
        if (!Array.isArray(report.rows) || !report.warnings || report.start !== job.start || report.end !== job.end || report.rows.some(row => row.location !== job.location)) throw new Error('source');
        reports.push(report);
        if (!controller.signal.aborted) setState(current => ({ ...current, completed: reports.length }));
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, jobs.length) }, worker)).then(() => {
      if (!controller.signal.aborted) setState({ key: requestKey, report: mergeCategoryReports(reports, start, end), loading: false, error: '', completed: jobs.length, total: jobs.length });
    }).catch(error => {
      if (!controller.signal.aborted) {
        failed = true; controller.abort();
        setState({ key: requestKey, report: null, loading: false, error: error instanceof Error ? error.message : 'source', completed: 0, total: jobs.length });
      }
    });
    return () => { if (!failed) controller.abort(); };
  }, [requestKey]);

  // A previous range can never flash or be exported under new filter labels.
  const current = state.key === requestKey;
  const report = current ? state.report : null;
  const loading = !current || state.loading;
  const error = current ? state.error : '';
  const name = (row: CategorySalesRow) => row.categoryName || `${row.categoryId === 'unassigned' ? t('Unassigned', 'Sin categoría') : t('Unidentified category', 'Categoría sin identificar')} · ${row.location}${row.categoryId === 'unassigned' ? '' : ` · ${row.categoryId.slice(0, 8)}`}`;
  const choices = useMemo(() => [...new Map((report?.rows || []).map(row => [categoryKey(row), row])).values()], [report]);
  const rows = (report?.rows || []).filter(row => category === 'all' || categoryKey(row) === category);
  const totals = categoryTotals(rows);
  const allTotals = categoryTotals(report?.rows || []);
  const grouped = [...rows.reduce((map, row) => {
    const key = categoryKey(row), previous = map.get(key);
    map.set(key, previous ? { ...previous, ...categoryTotals([previous, row]) } : { ...row });
    return map;
  }, new Map<string, CategorySalesRow>()).values()].sort((a, b) => b.netSales - a.netSales);
  const currency = new Intl.NumberFormat(language === 'es' ? 'es-US' : 'en-US', { style: 'currency', currency: 'USD' });
  const quantity = new Intl.NumberFormat(language === 'es' ? 'es-US' : 'en-US', { maximumFractionDigits: 2 });
  const money = (value: number | null) => value === null ? '—' : currency.format(value);
  const share = (net: number) => allTotals.netSales > 0 ? `${(net / allTotals.netSales * 100).toFixed(2)}%` : '—';
  const warnings = report?.warnings;
  const incomplete = Boolean(warnings && Object.values(warnings).some(value => value > 0));
  const notes = t('By order business date in Toast. Excludes taxes, tips, service charges, voids and deferred sales. Quantities are ordered units before refunds. Refunds shown are those attributed to these orders at the time of consultation.', 'Por fecha operativa de la orden en Toast. Excluye impuestos, propinas, cargos de servicio, anulaciones y ventas diferidas. Las cantidades son unidades ordenadas antes de reembolsos. Incluye los reembolsos atribuidos a estas órdenes al momento de la consulta.');
  const warningText = warnings ? [
    warnings.missingPrices ? `${warnings.missingPrices} ${t('items missing price; sales totals are incomplete.', 'artículos sin precio; los totales de venta están incompletos.')}` : '',
    warnings.unallocatedRefunds ? `${warnings.unallocatedRefunds} ${t('checks with refunds that cannot be attributed to a category.', 'cuentas con reembolsos que no se pueden atribuir a una categoría.')}` : '',
    warnings.unidentifiedCategories ? t('Some category names could not be identified in Toast.', 'Algunas categorías no se pudieron identificar en Toast.') : '',
    warnings.missingGross || warnings.missingQuantities ? t('Unavailable amounts or quantities are shown as —.', 'Los importes o cantidades no disponibles aparecen como —.') : '',
  ].filter(Boolean).join(' ') : '';

  async function download() {
    if (!report || loading) return;
    setExporting(true); setExportError(false);
    try {
      const XLSX = await import('xlsx');
      const headers = [t('Location', 'Locación'), t('Category', 'Categoría'), t('Quantity', 'Cantidad'), t('Gross before refunds', 'Bruto antes de reembolsos'), t('Discounts', 'Descuentos'), t('Refunds', 'Reembolsos'), t('Net sales', 'Ventas netas'), t('% of all categories', '% de todas las categorías'), 'Toast category ID'];
      const data = rows.map(row => [row.location, name(row), row.quantity, row.grossSales, row.discounts, row.refunds, row.netSales, allTotals.netSales > 0 ? row.netSales / allTotals.netSales : null, row.categoryId]);
      const sheet = XLSX.utils.aoa_to_sheet([headers, ...data, [t('TOTAL', 'TOTAL'), '', totals.quantity, totals.grossSales, totals.discounts, totals.refunds, totals.netSales, allTotals.netSales > 0 ? totals.netSales / allTotals.netSales : null]]);
      sheet['!cols'] = [{ wch: 20 }, { wch: 36 }, { wch: 14 }, ...Array.from({ length: 4 }, () => ({ wch: 24 })), { wch: 24 }, { wch: 40 }];
      sheet['!autofilter'] = { ref: `A1:I${rows.length + 1}` };
      for (let r = 1; r <= rows.length + 1; r++) for (let c = 3; c <= 7; c++) { const cell = sheet[XLSX.utils.encode_cell({ r, c })]; if (cell?.t === 'n') cell.z = c === 7 ? '0.00%' : '$#,##0.00;[Red]-$#,##0.00'; }
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, sheet, t('Category sales', 'Ventas por categoría'));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
        [t('Source', 'Fuente'), 'Toast'], [t('Start', 'Inicio'), report.start], [t('End', 'Fin'), report.end],
        [t('Locations', 'Locaciones'), locations.join(', ')], [t('Category', 'Categoría'), category === 'all' ? t('All', 'Todas') : name(rows[0])],
        [t('Consulted (UTC)', 'Consultado (UTC)'), report.retrievedAt], [t('Status', 'Estado'), incomplete ? t('Needs review', 'Requiere revisión') : t('Complete', 'Completo')],
        [t('Notes', 'Notas'), notes], [t('Warnings', 'Advertencias'), warningText || t('None', 'Ninguna')],
      ]), t('Report details', 'Detalle del reporte'));
      XLSX.writeFile(workbook, `OpsVista_Toast_Categorias_${report.start}_${report.end}.xlsx`);
    } catch { setExportError(true); } finally { setExporting(false); }
  }

  return <section className="sales-categories" aria-labelledby="sales-category-title" aria-busy={loading}>
    <header className="sc-heading"><div><span className="sc-source">TOAST · {t('SALES REPORT', 'REPORTE DE VENTAS')}</span><h2 id="sales-category-title">{t('Sales by category', 'Ventas por categoría')}</h2><p>{start} → {end} · {locations.join(', ')}</p></div><button type="button" className="sc-download" disabled={!report || loading || !rows.length || exporting} onClick={() => void download()}>{exporting ? t('Preparing…', 'Preparando…') : t('Download Excel ↓', 'Descargar Excel ↓')}</button></header>
    {loading ? <div className="sc-loading" role="status"><strong>{t('Loading category sales from Toast…', 'Consultando ventas por categoría en Toast…')}</strong><p>{state.completed} / {state.total} {t('periods loaded', 'periodos consultados')}</p><progress value={state.completed} max={state.total || 1}/></div> : error ? <div className="sc-warning" role="alert"><p>{error === 'session' ? t('Your session expired. Sign in again.', 'Tu sesión venció. Inicia sesión de nuevo.') : error === 'access' ? t('You do not have access to these locations.', 'No tienes acceso a estas locaciones.') : error === 'range' ? t('Select at least one location and a range of 1–31 days.', 'Selecciona al menos una locación y un periodo de 1 a 31 días.') : t('The complete report could not be retrieved from Toast. Please retry.', 'No se pudo obtener el reporte completo de Toast. Intenta de nuevo.')}</p><button type="button" onClick={() => setRetry(value => value + 1)}>{t('Retry', 'Reintentar')}</button></div> : report && <>
      <div className="sc-tools"><label>{t('Category', 'Categoría')}<select value={category} onChange={event => setCategory(event.target.value)}><option value="all">{t('All categories', 'Todas las categorías')}</option>{choices.map(row => <option key={categoryKey(row)} value={categoryKey(row)}>{name(row)}</option>)}</select></label><span>{t('Consulted', 'Consultado')} {new Intl.DateTimeFormat(language === 'es' ? 'es-US' : 'en-US', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/New_York' }).format(new Date(report.retrievedAt))} ET</span></div>
      {incomplete && <div className="sc-warning" role="status"><strong>{t('Report requires review', 'El reporte requiere revisión')}</strong><p>{warningText}</p></div>}
      <div className="sc-kpis"><div><span>{t('Net sales', 'Ventas netas')}{warnings?.missingPrices ? '*' : ''}</span><strong>{money(totals.netSales)}</strong></div><div><span>{t('Ordered units', 'Unidades ordenadas')}</span><strong>{totals.quantity === null ? '—' : quantity.format(totals.quantity)}</strong></div><div><span>{t('Discounts', 'Descuentos')}</span><strong>{money(totals.discounts)}</strong></div><div><span>{t('Share of sales', 'Participación en ventas')}</span><strong>{share(totals.netSales)}</strong></div></div>
      {!rows.length ? <p className="sc-empty">{t('No category sales found for this period and these locations.', 'No se encontraron ventas por categoría para este periodo y estas locaciones.')}</p> : <>
        <div className="sc-chart"><h3>{t('Top categories · net sales', 'Categorías principales · ventas netas')}</h3>{grouped.slice(0, 8).map(row => <div className="sc-bar-row" key={categoryKey(row)}><div><span>{name(row)}</span><strong>{money(row.netSales)}</strong><small>{share(row.netSales)}</small></div><div className="sc-track" aria-hidden="true"><span style={{ width: `${Math.max(0, row.netSales) / Math.max(1, ...grouped.map(value => value.netSales)) * 100}%` }}/></div></div>)}</div>
        <div className="sc-table-wrap" tabIndex={0} role="region" aria-label={t('Category sales table', 'Tabla de ventas por categoría')}><table><caption>{t('Breakdown by location and Toast category', 'Desglose por locación y categoría de Toast')}</caption><thead><tr>{[t('Location', 'Locación'), t('Category', 'Categoría'), t('Units', 'Unidades'), t('Gross¹', 'Bruto¹'), t('Discounts', 'Descuentos'), t('Refunds', 'Reembolsos'), t('Net sales', 'Ventas netas'), t('Share²', 'Participación²')].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={`${row.location}:${row.categoryId}`}><td>{row.location}</td><th scope="row">{name(row)}</th><td>{row.quantity === null ? '—' : quantity.format(row.quantity)}</td><td>{money(row.grossSales)}</td><td>{money(row.discounts)}</td><td>{money(row.refunds)}</td><td><strong>{money(row.netSales)}</strong></td><td>{share(row.netSales)}</td></tr>)}</tbody><tfoot><tr><th colSpan={2} scope="row">{t('Selected total', 'Total seleccionado')}</th><td>{totals.quantity === null ? '—' : quantity.format(totals.quantity)}</td><td>{money(totals.grossSales)}</td><td>{money(totals.discounts)}</td><td>{money(totals.refunds)}</td><td>{money(totals.netSales)}</td><td>{share(totals.netSales)}</td></tr></tfoot></table></div>
      </>}
      <p className="sc-note">¹ {t('Before discounts and refunds.', 'Antes de descuentos y reembolsos.')} ² {t('Of all categories in the selected locations and period.', 'Sobre todas las categorías de las locaciones y periodo seleccionados.')} {notes}</p>
    </>}
    {exportError && <p role="alert">{t('The file could not be downloaded. Please retry.', 'No se pudo descargar el archivo. Intenta de nuevo.')}</p>}
  </section>;
}
