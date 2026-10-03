import { useEffect, useMemo, useState, useRef } from 'react';
import { addDays, beverageChunks, beverageLocations, compareBeverages, rankBeverages, suggestBeverageItem, suggestBeverageVendor, type BeverageGroup, type BeverageSource } from '../shared/beverageMetrics';

const usd = (value: number | null) => value === null ? 'Sin conciliar' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const pct = (value: number | null) => value === null ? '—' : `${value.toFixed(2)}%`;
const labels: Record<BeverageGroup, string> = { spirits: 'Destilados y cócteles', beer: 'Cerveza', wine: 'Vino', alcohol: 'Alcohol combinado', excluded: 'Excluir', unclassified: 'Por clasificar' };
const cell = { padding: 10, borderBottom: '1px solid #e2e8f0', textAlign: 'left' as const };

export default function BeverageBonusPanel({ start, end, locations, canRead }: { start: string; end: string; locations: string[]; canRead: boolean }) {
  const [windowMode, setWindowMode] = useState<'selected' | 'rolling'>('selected');
  const [enabled, setEnabled] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const lastRefresh = useRef(0);
  const [sources, setSources] = useState<BeverageSource[]>([]);
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState<Record<string, BeverageGroup>>({});
  const [itemGroups, setItemGroups] = useState<Record<string, BeverageGroup>>({});
  const [vendors, setVendors] = useState<Record<string, boolean>>({});
  const scopeKey = locations.filter(location => beverageLocations.includes(location)).join('|');
  const reportStart = windowMode === 'rolling' ? addDays(end, -55) : start;
  const chunks = useMemo(() => beverageChunks(reportStart, end), [reportStart, end]);
  const expected = chunks.length * scopeKey.split('|').filter(Boolean).length;

  useEffect(() => {
    setSources([]);
    if (!canRead || !enabled || !scopeKey) { setLoading(false); return; }
    const controller = new AbortController();
    const forceRefresh = refresh > lastRefresh.current;
    lastRefresh.current = refresh;
    let cursor = 0;
    const jobs = scopeKey.split('|').flatMap(location => chunks.map(chunk => ({ location, ...chunk })));
    setLoading(true);
    const worker = async () => {
      while (!controller.signal.aborted && cursor < jobs.length) {
        const job = jobs[cursor++];
        let source: BeverageSource;
        try {
          const query = new URLSearchParams({ view: 'beverage', entity: job.location, start: job.start, end: job.end });
          if (forceRefresh) query.set('refresh','1');
          const response = await fetch(`/api/integrations/restaurant365?${query}`, { credentials: 'include', cache: 'no-store', signal: controller.signal });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || 'Fuente no disponible');
          if (body.location !== job.location || body.start !== job.start || body.end !== job.end || !Array.isArray(body.sales?.categories) || !Array.isArray(body.purchases?.invoices)) throw new Error('Respuesta de fuentes inválida');
          source = body;
        } catch (error) {
          if (controller.signal.aborted) return;
          const message = error instanceof Error ? error.message : 'Fuente no disponible';
          source = { ...job, fetchedAt: new Date().toISOString(), sales: { categories: [], missingPrices: 0, unallocatedRefunds: 0, error: message }, purchases: { invoices: [], error: message } };
        }
        if (!controller.signal.aborted) setSources(previous => [...previous, source]);
      }
    };
    void Promise.all([worker(), worker()]).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [canRead, enabled, scopeKey, chunks, refresh]);

  const rows = useMemo(() => rankBeverages(scopeKey.split('|').filter(Boolean).map(location => compareBeverages(location, sources, chunks.length, groups, vendors, itemGroups))), [scopeKey, sources, chunks.length, groups, vendors, itemGroups]);
  const weeklyRows = useMemo(()=>sources.map(source=>({start:source.start,end:source.end,...compareBeverages(source.location,[source],1,groups,vendors,itemGroups)})).sort((a,b)=>a.location.localeCompare(b.location)||a.start.localeCompare(b.start)),[sources,groups,vendors,itemGroups]);
  const categoryRows = useMemo(() => {
    const all = new Map<string, { location: string; id: string; name: string; group: BeverageGroup; netSales: number; items: Map<string, number> }>();
    for (const source of sources) for (const category of source.sales.categories) {
      const key = `${source.location}:${category.id}`, previous = all.get(key);
      const items = previous?.items || new Map<string, number>();
      for (const item of category.items || []) items.set(item.name, (items.get(item.name) || 0) + item.netSales);
      all.set(key, { ...category, location: source.location, netSales: category.netSales + (previous?.netSales || 0), items });
    }
    return [...all.values()].sort((a, b) => a.location.localeCompare(b.location) || a.name.localeCompare(b.name));
  }, [sources]);
  const invoiceRows = useMemo(() => {
    const all = new Map<string, BeverageSource['purchases']['invoices'][number] & { location: string }>();
    for (const source of sources) for (const invoice of source.purchases.invoices) all.set(`${source.location}:${invoice.id}`, { ...invoice, suggested: invoice.suggested || suggestBeverageVendor(invoice.vendor), location: source.location });
    return [...all.values()].sort((a, b) => a.location.localeCompare(b.location) || a.date.localeCompare(b.date));
  }, [sources]);
  const vendorRows = useMemo(() => {
    const all = new Map<string, { vendor: string; suggested: boolean; count: number }>();
    for (const invoice of invoiceRows) {
      const previous = all.get(invoice.vendor);
      all.set(invoice.vendor, { vendor: invoice.vendor, suggested: invoice.suggested, count: (previous?.count || 0) + 1 });
    }
    return [...all.values()].sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.vendor.localeCompare(b.vendor));
  }, [invoiceRows]);

  return <section id="beverage-bonus" aria-labelledby="beverage-bonus-title" style={{ border: '1px solid #cbd5e1', borderRadius: 12, padding: 16, display: 'grid', gap: 14 }}>
    <div><h3 id="beverage-bonus-title" style={{ margin: '0 0 8px' }}>Alcohol · conciliación</h3>
      <p style={{ margin: 0 }}>R365 + Toast · Revisa las compras, ventas y excepciones que alimentan el Bono semanal.</p></div>
    {!canRead ? <p>El desglose de facturas está disponible para los perfiles con acceso a Restaurant365.</p> : <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label>Período de conciliación de alcohol <select value={windowMode} onChange={event => setWindowMode(event.target.value as 'selected' | 'rolling')}>
          <option value="rolling">Últimas 8 semanas hasta la fecha seleccionada</option><option value="selected">Período contable seleccionado</option>
        </select></label>
        <strong>{reportStart} → {end}</strong>
        <button type="button" disabled={loading} onClick={() => { if(enabled)setRefresh(value => value + 1); else setEnabled(true); }}>{loading ? 'Abriendo datos de OpsVista…' : enabled ? 'Buscar actualizaciones ahora' : 'Abrir desglose guardado'}</button>
      </div>
      <p style={{margin:0,color:'#475569'}}>Las consultas se guardan en OpsVista y se reutilizan al volver a entrar. La sincronización incorpora facturas nuevas y cambios de R365. Una primera consulta puede tardar mientras se recuperan los datos que aún no están guardados.</p>
      <p style={{ margin: 0, color: '#475569' }}>Ranking: menor porcentaje de facturas de compra netas de créditos ÷ ventas netas de alcohol. La diferencia ventas − compras es un indicador de compras; la utilidad bruta requiere inventario inicial, inventario final y transferencias. Se excluyen Corporate Office y Middletown.</p>
      {enabled && <>
        <div role="status" aria-live="polite">{loading ? `Abriendo ${sources.length} de ${expected} consultas. El ranking se completa al terminar.` : `${sources.length} de ${expected} consultas disponibles.`} {sources.length > 0 && `Datos verificados desde: ${new Date(sources.map(source => source.fetchedAt).sort()[0]).toLocaleString('es-MX',{timeZone:'America/New_York'})} (Connecticut).`} {sources.some(source=>source.memory?.sales.pending||source.memory?.purchases.pending) && 'Hay actualizaciones pendientes; se conserva la última copia y el ranking espera la conciliación.'}</div>
        <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <caption style={{ textAlign: 'left', fontWeight: 700, padding: '8px 0' }}>Conciliación de compras y ventas por locación</caption>
          <thead><tr>{['Rank', 'Locación', 'Ventas de alcohol', 'Compras − créditos', 'Incluido: AP pendiente', 'Compras / ventas', 'Ventas − compras', 'Margen sobre compras', 'Estado'].map(label => <th key={label} scope="col" style={cell}>{label}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.location}>
            <td style={cell}>{loading || row.rank === null ? '—' : `#${row.rank}`}</td><th scope="row" style={cell}>{row.location}</th>
            <td style={cell}><strong>{usd(row.sales)}</strong>{row.sales !== null && <small style={{ display: 'block' }}>Destilados/cócteles: {usd(row.spirits)}<br/>Cerveza: {usd(row.beer)}<br/>Vino: {usd(row.wine)}{row.alcohol !== 0 && <><br/>Alcohol combinado: {usd(row.alcohol)}</>}</small>}</td>
            <td style={cell}>{usd(row.purchases)}<small style={{ display: 'block' }}>{row.invoiceCount} facturas · {row.creditCount} créditos</small></td>
            <td style={cell}>{row.purchases === null ? 'Sin conciliar' : usd(row.pending)}</td><td style={cell}>{pct(row.purchasePct)}</td><td style={cell}>{usd(row.salesLessPurchases)}</td><td style={cell}>{pct(row.purchaseMarginPct)}</td>
            <td style={{ ...cell, maxWidth: 280, fontSize: 13 }}>{row.issues.length ? row.issues.join(' · ') : 'Comparativo disponible; verificar proveedores y cobertura de facturas'}</td>
          </tr>)}</tbody>
        </table></div>
        <details><summary style={{cursor:'pointer',fontWeight:700}}>Compras y ventas por semana · verificar las 8 semanas</summary>
          <p>El total incluye facturas aprobadas y pendientes de aprobación de pago, menos créditos. La columna de pendientes muestra la parte ya incluida en ese total. Revisa cada semana para confirmar la cobertura de las ocho semanas.</p>
          <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}>
            <thead><tr>{['Locación','Semana','Ventas de alcohol','Compras netas totales','De ellas: pendientes netas','Facturas / créditos','Estado'].map(label=><th key={label} style={cell}>{label}</th>)}</tr></thead>
            <tbody>{weeklyRows.map(row=><tr key={`${row.location}:${row.start}`}><th scope="row" style={cell}>{row.location}</th><td style={cell}>{row.start} → {row.end}</td><td style={cell}>{usd(row.sales)}</td><td style={cell}>{usd(row.purchases)}</td><td style={cell}>{row.purchases===null?'Sin conciliar':usd(row.pending)}</td><td style={cell}>{row.invoiceCount} / {row.creditCount}</td><td style={cell}>{row.issues.join(' · ')||'Datos disponibles; revisar proveedores'}</td></tr>)}</tbody>
          </table></div>
        </details>
        <details><summary style={{ cursor: 'pointer', fontWeight: 700 }}>Desglose de ventas y clasificación de categorías ({categoryRows.length})</summary>
          <p>Verifica las categorías y sus productos. La clasificación por producto separa refrescos, café, cerveza y vino aunque estén dentro de Liquor. “Beverage” u otros nombres ambiguos requieren clasificación. Los cambios afectan solamente este comparativo durante esta visita.</p>
          <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['Locación', 'Categoría Toast', 'Ventas netas', 'Clasificación'].map(label => <th key={label} style={cell}>{label}</th>)}</tr></thead>
            <tbody>{categoryRows.map(row => <tr key={`${row.location}:${row.id}`}><td style={cell}>{row.location}</td><td style={cell}>{row.name}{row.items.size > 0 && <details><summary>Ver {row.items.size} productos</summary><ul>{[...row.items].sort((a,b) => b[1]-a[1]).map(([name, amount]) => <li key={name} style={{marginBottom:6}}>{name}: {usd(amount)} <select aria-label={`Clasificar producto ${name} de ${row.location} en ${row.name}`} value={itemGroups[`${row.location}:${row.id}:${name}`] ?? groups[`${row.location}:${row.id}`] ?? suggestBeverageItem(name, row.group)} onChange={event => setItemGroups(previous => ({...previous, [`${row.location}:${row.id}:${name}`]:event.target.value as BeverageGroup}))}>{Object.entries(labels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></li>)}</ul></details>}</td><td style={cell}>{usd(row.netSales)}</td><td style={cell}><select aria-label={`Clasificar ${row.name} de ${row.location}`} value={groups[`${row.location}:${row.id}`] ?? row.group} onChange={event => setGroups(previous => ({ ...previous, [`${row.location}:${row.id}`]: event.target.value as BeverageGroup }))}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td></tr>)}</tbody>
          </table></div>
        </details>
        <details><summary style={{ cursor: 'pointer', fontWeight: 700 }}>Proveedores e invoices de R365 ({invoiceRows.length})</summary>
          <p>Los proveedores sugeridos requieren revisión: una factura puede contener bebidas sin alcohol, depósitos u otros cargos. Las facturas seleccionadas se incluyen por su importe completo; los créditos se restan. La aprobación de pago pendiente no excluye la compra. Las fuentes incompletas, la evidencia sin conciliar y los documentos sin monto mantienen los puntos pendientes.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>{vendorRows.map(row => <label key={row.vendor}><input type="checkbox" checked={vendors[row.vendor] ?? row.suggested} onChange={event => setVendors(previous => ({ ...previous, [row.vendor]: event.target.checked }))}/> {row.vendor} ({row.count})</label>)}</div>
          <div style={{ overflowX: 'auto', maxHeight: 460, marginTop: 12 }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr>{['Locación', 'Fecha', 'Invoice', 'Proveedor', 'Tipo', 'Monto', 'Estado', 'Incluido'].map(label => <th key={label} style={cell}>{label}</th>)}</tr></thead>
            <tbody>{invoiceRows.map(row => <tr key={`${row.location}:${row.id}`}><td style={cell}>{row.location}</td><td style={cell}>{row.date}</td><td style={cell}>{row.number || row.id}</td><td style={cell}>{row.vendor}</td><td style={cell}>{row.kind === 'credit' ? 'Crédito' : 'Factura'}</td><td style={cell}>{usd(row.amount)}</td><td style={cell}>{row.approved ? 'Aprobada' : 'Pendiente'}</td><td style={cell}>{(vendors[row.vendor] ?? row.suggested) ? 'Sí' : 'No'}</td></tr>)}</tbody>
          </table></div>
        </details>
      </>}
    </>}
  </section>;
}
