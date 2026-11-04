// Fetch a complete, consistent batch before the UI replaces any prior data.
export async function collectInvoices(request, { start, end }, onProgress = () => {}) {
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(start) || !validDate(end) || start > end || Date.parse(end) - Date.parse(start) >= 31 * 86400000) throw new Error('Selecciona un período de hasta 31 días.');
  for (let attempt = 0; attempt < 2; attempt++) {
    const rows = [], ids = new Set();
    let snapshot, total, offset = 0, pending = false;
    try {
      for (let page = 0; page < 51; page++) {
        onProgress(rows.length);
        const query = new URLSearchParams({ start, end, limit: '200', offset: String(offset) });
        if (snapshot) query.set('snapshot_at', snapshot);
        const result = await request('invoices?' + query);
        const p = result.pagination;
        if (result.api_version !== '1' || result.organization_id !== 'org-puerto-vallarta' || !Array.isArray(result.data) || !p || !Number.isInteger(p.total) || p.total < 0 || p.total > 10200 || p.offset !== offset || !p.snapshot_at || p.snapshot_at !== result.source?.snapshot_at) throw new Error('Respuesta de OpsVista incompleta. Se conserva la consulta anterior.');
        if (snapshot && (snapshot !== p.snapshot_at || total !== p.total)) throw new Error('La copia cambió durante la consulta. Vuelve a sincronizar.');
        snapshot = p.snapshot_at; total = p.total; pending ||= result.source.refresh_pending === true;
        for (const row of result.data) {
          if (!row.id || ids.has(row.id) || typeof row.location_id !== 'string' || (row.amount !== null && (typeof row.amount !== 'number' || !Number.isFinite(row.amount)))) throw new Error('Hay facturas duplicadas o incompletas en la respuesta.');
          ids.add(row.id); rows.push(row);
        }
        if (p.next_offset === null) {
          if (rows.length !== total) throw new Error('La descarga de facturas quedó incompleta.');
          return { rows, snapshot, pending, start, end };
        }
        if (!Number.isInteger(p.next_offset) || p.next_offset !== offset + result.data.length || p.next_offset <= offset || p.next_offset > 10000) throw new Error('La paginación de facturas no es válida.');
        offset = p.next_offset;
      }
      throw new Error('La consulta supera el límite de páginas; selecciona menos días.');
    } catch (error) {
      if (error.status === 409 && error.code === 'snapshot_changed' && attempt === 0) continue;
      throw error;
    }
  }
}
