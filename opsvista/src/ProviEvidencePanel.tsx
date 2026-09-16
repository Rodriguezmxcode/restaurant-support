import { useCallback, useEffect, useMemo, useState } from 'react';
import { beverageLocations } from '../shared/beverageMetrics';
import type { ProviEvidenceDraft, ProviSourceFile, StoredProviEvidence } from '../shared/proviEvidence';

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

export default function ProviEvidencePanel({ locations, allowImport = false }: { locations?: string[]; allowImport?: boolean }) {
  const [data, setData] = useState<EvidenceResponse>({ evidence: [] });
  const [files, setFiles] = useState<ProviSourceFile[]>([]);
  const [drafts, setDrafts] = useState<ProviEvidenceDraft[]>([]);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    try { setData(await readEvidence()); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No se pudo leer la evidencia.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const controller = new AbortController(); void readEvidence(controller.signal).then(setData).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'No se pudo leer la evidencia.'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, []);

  const scope = locations?.length ? new Set(locations) : null;
  const evidence = useMemo(() => (data.evidence || []).filter(row => !scope || scope.has(row.location)).sort((a, b) => b.orderDate.localeCompare(a.orderDate) || b.savedAt.localeCompare(a.savedAt)), [data.evidence, locations?.join('|')]);

  const chooseFiles = async (selected: FileList | null) => {
    setError(''); setNotice(''); setDrafts([]); setFiles([]);
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
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/integrations/restaurant365', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save-provi-evidence', files, purchases: drafts }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'No se pudo guardar la compra.');
      setNotice(`${body.saved || 0} compra(s) guardada(s) como evidencia Provi.${body.duplicates ? ` ${body.duplicates} duplicada(s) no se volvieron a contar.` : ''}`);
      setDrafts([]); setFiles([]); await load();
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
    {drafts.length > 0 && <div className="provi-evidence-review"><h4>Revisa antes de guardar</h4><p>Estos datos sí afectarán la compra provisional. Corrige cualquier campo que no coincida con la orden.</p>
      {drafts.map((row, index) => <div className="provi-draft" key={`${index}:${row.vendor}`}>
        <div className="provi-draft-grid">
          <label>Locación<select value={row.location} onChange={event => update(index, { location: event.target.value })}><option value="">Selecciona</option>{beverageLocations.filter(name => !scope || scope.has(name)).map(name => <option key={name}>{name}</option>)}</select></label>
          <label>Fecha de orden<input type="date" value={row.orderDate} onChange={event => update(index, { orderDate: event.target.value })}/></label>
          <label>Entrega esperada / visible<input type="date" value={row.deliveryDate || ''} onChange={event => update(index, { deliveryDate: event.target.value || null })}/></label>
          <label>Distribuidor<input value={row.vendor} onChange={event => update(index, { vendor: event.target.value })}/></label>
          <label>Orden / referencia<input value={row.orderNumber || ''} onChange={event => update(index, { orderNumber: event.target.value || null })}/></label>
          <label>Total Provi<input type="number" min="0" step="0.01" value={row.orderedAmount || ''} onChange={event => update(index, { orderedAmount: Number(event.target.value) || 0 })}/></label>
        </div>
        <small>{row.items.length} productos detectados · confianza de lectura {Math.round(row.confidence * 100)}%{row.sourceNote ? ` · ${row.sourceNote}` : ''}</small>
      </div>)}
      <button type="button" className="primary" disabled={busy || drafts.some(row => !row.location || !row.orderDate || !row.vendor || row.orderedAmount <= 0)} onClick={() => void save()}>Guardar como compra Provi provisional</button>
    </div>}
    {!loading && evidence.length > 0 && <div className="provi-scroll"><table><caption>Evidencia Provi y conciliación R365</caption><thead><tr><th>Estado</th><th>Locación</th><th>Orden</th><th>Distribuidor</th><th>Provi ordenado</th><th>R365</th><th>Diferencia</th><th>Evidencia</th></tr></thead><tbody>{evidence.map(row => { const [label, tone] = status(row); return <tr key={row.id}><td><span className={`provi-status ${tone}`}>{label}</span><small>{row.match.reason}</small></td><td>{row.location}</td><td>{row.orderDate}<small>{row.orderNumber || 'Sin número visible'}</small></td><td>{row.vendor}</td><td>{usd(row.orderedAmount)}</td><td>{row.match.invoice ? usd(row.match.invoice.amount) : 'Esperando invoice'}<small>{row.match.invoice?.number || ''}</small></td><td>{row.match.difference === null ? '—' : usd(row.match.difference)}</td><td>{row.sourceFiles.map(file => file.name).join(', ')}<small>Guardado {stamp(row.savedAt)}</small></td></tr>; })}</tbody></table></div>}
    {!loading && !evidence.length && <p className="provi-note">Aún no hay fotos o PDF de compras Provi guardados.</p>}
  </div>;
}
