import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { beverageLocations, validBeverageRange } from '../shared/beverageMetrics';
import { parseProviEvidenceDrafts, type ProviEvidenceDraft, type ProviSourceFile, type StoredProviEvidence } from '../shared/proviEvidence';

const usd = (value: number | null | undefined) => value === null || value === undefined ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
const stamp = (value: string) => new Date(value).toLocaleString('es-MX', { timeZone: 'America/New_York' });
type EvidenceResponse = {
  evidence?: StoredProviEvidence[];
  canImport?: boolean;
  pdfTextExtractionReady?: boolean;
  visualExtractionConfigured?: boolean;
  documentExtractionReady?: boolean;
  error?: string;
};

async function readEvidence(signal?: AbortSignal): Promise<EvidenceResponse> {
  const response = await fetch('/api/integrations/restaurant365?view=provi', { credentials: 'include', cache: 'no-store', signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'No se pudo abrir la evidencia de Provi.');
  return body;
}
const fileBase64 = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(new Error(`No se pudo leer ${file.name}.`));
  reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
  reader.readAsDataURL(file);
});
const safeMime = (file: File) => file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/jpeg');

function reviewProblem(row: ProviEvidenceDraft): string {
  const missing = [!row.location && 'locación', !row.orderDate && 'fecha de orden', !row.vendor.trim() && 'distribuidor', !(row.orderedAmount > 0) && 'total mayor que cero'].filter(Boolean);
  if (missing.length) return `Completa: ${missing.join(', ')}.`;
  try { parseProviEvidenceDrafts([row]); return ''; }
  catch (reason) { return reason instanceof Error ? reason.message : 'Revisa los datos de esta compra.'; }
}

export default function ProviEvidencePanel({ locations, allowImport = false }: { locations?: string[]; allowImport?: boolean }) {
  const [data, setData] = useState<EvidenceResponse>({ evidence: [] });
  const [files, setFiles] = useState<ProviSourceFile[]>([]);
  const [drafts, setDrafts] = useState<ProviEvidenceDraft[]>([]);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [batchOrderDate, setBatchOrderDate] = useState('');
  const reviewRef = useRef<HTMLDivElement>(null);
  const reviewId = useId();
  const problems = drafts.map(reviewProblem);
  const missingDates = drafts.filter(row => !row.orderDate).length;
  const load = useCallback(async () => {
    try { setData(await readEvidence()); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo leer la evidencia.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void readEvidence(controller.signal).then(setData).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo leer la evidencia.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, []);

  const scope = locations?.length ? new Set(locations) : null;
  const evidence = useMemo(() => (data.evidence || []).filter(row => !scope || scope.has(row.location)).sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.savedAt.localeCompare(a.savedAt)), [data.evidence, locations?.join('|')]);

  const chooseFiles = async (selected: FileList | null) => {
    setError(''); setNotice(''); setDrafts([]); setFiles([]); setBatchOrderDate('');
    if (!selected?.length) return;
    const picked = [...selected];
    if (picked.length > 4) return setError('Selecciona máximo 4 archivos por compra.');
    if (picked.reduce((sum, file) => sum + file.size, 0) > 3_000_000) return setError('Los archivos pueden pesar hasta 3 MB combinados.');
    setBusy(true);
    try {
      const encoded: ProviSourceFile[] = await Promise.all(picked.map(async file => ({ name: file.name, mime: safeMime(file), data: await fileBase64(file) })));
      setFiles(encoded);
      const response = await fetch('/api/integrations/restaurant365', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'extract-provi-evidence', files: encoded }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo leer la compra.');
      const preferredLocation = locations?.length === 1 ? locations[0] : '';
      const purchases: ProviEvidenceDraft[] = (Array.isArray(body.purchases) ? body.purchases : []).map((row: any) => ({
        location: beverageLocations.includes(row.location) ? row.location : preferredLocation,
        orderDate: typeof row.orderDate === 'string' ? row.orderDate : '',
        deliveryDate: typeof row.deliveryDate === 'string' ? row.deliveryDate : null,
        vendor: typeof row.vendor === 'string' ? row.vendor : '',
        orderNumber: typeof row.orderNumber === 'string' ? row.orderNumber : null,
        orderedAmount: typeof row.orderedAmount === 'number' ? row.orderedAmount : 0,
        items: Array.isArray(row.items) ? row.items.filter((item: any) => item?.name).map((item: any) => ({ name: String(item.name), distributor: String(item.distributor || row.vendor || 'Provi'), quantity: String(item.quantity || 'No visible'), spend: typeof item.spend === 'number' ? item.spend : null })) : [],
        sourceNote: typeof row.sourceNote === 'string' ? row.sourceNote : '',
        confidence: typeof row.confidence === 'number' ? row.confidence : 0,
      }));
      if (!purchases.length) throw new Error('No se identificó ninguna compra en esos archivos.');
      setDrafts(purchases);
      if (body.extractionMode === 'pdf-text') setNotice('PDF leído localmente en OpsVista · sin usar créditos de OpenAI. Revisa los campos antes de guardar.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo leer la evidencia.'); }
    finally { setBusy(false); }
  };
  const update = (index: number, values: Partial<ProviEvidenceDraft>) => setDrafts(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...values } : row));
  const save = async () => {
    if (problems.some(Boolean)) {
      setError('Revisa los campos pendientes de las compras antes de guardar. Tus datos siguen en el formulario.');
      reviewRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/integrations/restaurant365', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-provi-evidence', files, purchases: drafts }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo guardar la compra.');
      setNotice(`${body.saved || 0} compra(s) guardada(s) como evidencia Provi.${body.duplicates ? ` ${body.duplicates} duplicada(s) no se volvieron a contar.` : ''}`);
      setDrafts([]); setFiles([]); setBatchOrderDate(''); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo guardar la compra.'); }
    finally { setBusy(false); }
  };
  const status = (row: StoredProviEvidence) => row.match.status === 'verified' ? ['Verificada con R365', 'verified'] : row.match.status === 'needs_review' ? ['Revisar posible coincidencia', 'review'] : ['Provi provisional', 'provisional'];

  return <div className="provi-evidence">
    <div className="provi-evidence-head"><div><h4>Compras rápidas · PDF, foto o JSON</h4><p>Los PDF que contienen texto se leen dentro de OpsVista sin usar créditos. La compra queda provisional hasta que R365 encuentre y corrobore el invoice.</p></div><span className="provi-reader ready">PDF con texto · sin API</span></div>
    {notice && <p role="status" className="provi-success">{notice}</p>}
    {error && <p role="alert" className="provi-warning">{error}</p>}
    {allowImport && data.canImport && <div className="provi-evidence-actions">
      <label className="provi-upload-button">Subir PDF · sin API<input type="file" accept=".pdf,application/pdf" multiple disabled={busy} onChange={event => { void chooseFiles(event.target.files); event.currentTarget.value = ''; }}/></label>
      <label className="provi-upload-button secondary">Subir foto<input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={busy} onChange={event => { void chooseFiles(event.target.files); event.currentTarget.value = ''; }}/></label>
      <label className="provi-upload-button secondary">Tomar foto<input type="file" accept="image/*" capture="environment" disabled={busy} onChange={event => { void chooseFiles(event.target.files); event.currentTarget.value = ''; }}/></label>
      <small>PDF con texto: lectura local sin créditos. PDF escaneado como imagen y fotografías: requieren lector visual/API. JSON sigue disponible en el importador de reportes.</small>
    </div>}
    {busy && <p role="status">Leyendo o guardando evidencia Provi…</p>}
    {drafts.length > 0 && <div className="provi-evidence-review" ref={reviewRef}><h4>Revisa antes de guardar</h4><p>Estos datos sí afectarán la compra provisional. Corrige cualquier campo que no coincida con la orden. La fecha de orden es obligatoria; entrega y referencia son opcionales.</p>
      {missingDates > 0 && <div className="provi-batch-date">
        <p>Falta la fecha de orden en {missingDates} compra(s). Si corresponden al mismo día, elige la fecha real y aplícala a las que están vacías.</p>
        <label>Fecha de orden para compras sin fecha<input type="date" value={batchOrderDate} disabled={busy} onChange={event => setBatchOrderDate(event.target.value)}/></label>
        <button type="button" disabled={busy || !validBeverageRange(batchOrderDate, batchOrderDate)} onClick={() => { setDrafts(rows => rows.map(row => row.orderDate ? row : { ...row, orderDate: batchOrderDate })); setError(''); }}>Aplicar a fechas faltantes</button>
      </div>}
      {drafts.map((row, index) => <div className="provi-draft" key={index}>
        <h5>Compra {index + 1} · {row.vendor || 'Distribuidor pendiente'}</h5>
        <div className="provi-draft-grid">
          <label>Locación<select value={row.location} disabled={busy} aria-invalid={!beverageLocations.includes(row.location)} aria-describedby={problems[index] ? `${reviewId}-${index}` : undefined} onChange={event => update(index, { location: event.target.value })}><option value="">Selecciona</option>{beverageLocations.filter(name => !scope || scope.has(name)).map(name => <option key={name}>{name}</option>)}</select></label>
          <label>Fecha de orden (obligatoria)<input type="date" value={row.orderDate} disabled={busy} aria-invalid={!validBeverageRange(row.orderDate, row.orderDate)} aria-describedby={problems[index] ? `${reviewId}-${index}` : undefined} onChange={event => update(index, { orderDate: event.target.value })}/>{!row.orderDate && <small className="provi-field-error">Selecciona la fecha real de esta orden.</small>}</label>
          <label>Entrega esperada / visible (opcional)<input type="date" value={row.deliveryDate || ''} disabled={busy} onChange={event => update(index, { deliveryDate: event.target.value || null })}/></label>
          <label>Distribuidor<input value={row.vendor} disabled={busy} maxLength={180} aria-invalid={!row.vendor.trim()} onChange={event => update(index, { vendor: event.target.value })}/></label>
          <label>Orden / referencia (opcional)<input value={row.orderNumber || ''} disabled={busy} maxLength={120} onChange={event => update(index, { orderNumber: event.target.value || null })}/></label>
          <label>Total Provi<input type="number" min="0.01" max="100000000" step="0.01" value={row.orderedAmount || ''} disabled={busy} aria-invalid={!(row.orderedAmount > 0 && row.orderedAmount <= 100000000)} onChange={event => update(index, { orderedAmount: Number(event.target.value) || 0 })}/></label>
        </div>
        {problems[index] && <p className="provi-field-error" id={`${reviewId}-${index}`}>{problems[index]}</p>}
        <small>{row.items.length} productos detectados · confianza de lectura {Math.round(row.confidence * 100)}%{row.sourceNote ? ` · ${row.sourceNote}` : ''}</small>
      </div>)}
      {problems.some(Boolean) && <div className="provi-warning" id={`${reviewId}-summary`} aria-live="polite"><strong>Antes de guardar:</strong><ul>{problems.map((problem, index) => problem ? <li key={index}>Compra {index + 1} · {drafts[index].vendor || 'Sin distribuidor'}: {problem}</li> : null)}</ul></div>}
      <button type="button" className="primary" disabled={busy} aria-describedby={problems.some(Boolean) ? `${reviewId}-summary` : undefined} onClick={() => void save()}>Guardar como compra Provi provisional</button>
    </div>}
    {!loading && evidence.length > 0 && <div className="provi-scroll"><table><caption>Evidencia Provi y conciliación R365</caption><thead><tr><th>Estado</th><th>Locación</th><th>Orden</th><th>Distribuidor</th><th>Provi ordenado</th><th>R365</th><th>Diferencia</th><th>Evidencia</th></tr></thead><tbody>{evidence.map(row => { const [label, tone] = status(row); return <tr key={row.id}><td><span className={`provi-status ${tone}`}>{label}</span><small>{row.match.reason}</small></td><td>{row.location}</td><td>{row.orderDate}<small>{row.orderNumber || 'Sin número visible'}</small></td><td>{row.vendor}</td><td>{usd(row.orderedAmount)}</td><td>{row.match.invoice ? usd(row.match.invoice.amount) : 'Esperando invoice'}<small>{row.match.invoice?.number || ''}</small></td><td>{row.match.difference === null ? '—' : usd(row.match.difference)}</td><td>{row.sourceFiles.map(file => file.name).join(', ')}<small>Guardado {stamp(row.savedAt)}</small></td></tr>; })}</tbody></table></div>}
    {!loading && !evidence.length && <p className="provi-note">Aún no hay fotos o PDF de compras Provi guardados.</p>}
  </div>;
}
