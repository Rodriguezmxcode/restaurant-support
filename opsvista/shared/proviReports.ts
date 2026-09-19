import { beverageChunks, beverageLocations, money, suggestBeverageVendor, validBeverageRange, type BeverageInvoice } from './beverageMetrics.js';

export type ProviProduct = { name: string; distributor: string; quantity: string; spend: number };
export type ProviBaseline = { capturedAt: string; note: string; invoices: BeverageInvoice[] };
export type ProviReport = {
  location: string; start: string; end: string; spend: number; orders: number; productCount: number; distributorCount: number;
  topProducts: ProviProduct[]; sourceNote: string; baseline?: ProviBaseline;
};
export type ProviComparison = {
  source: 'automatic' | 'imported' | 'pending'; updatedAt?: string; pending: boolean; covered: number; expected: number;
  invoiceTotal: number | null; approved: number | null; pendingAmount: number | null; credits: number | null;
  net: number | null; difference: number | null; invoiceCount: number; creditCount: number; missingAmounts: number;
  invoices: BeverageInvoice[]; note: string;
};
export type StoredProviReport = ProviReport & { id: string; savedAt: string; comparison: ProviComparison };
export type ProviResponse = { reports: StoredProviReport[]; canImport: boolean; error?: string };
export const proviReportKey = (report: Pick<ProviReport, 'location' | 'start' | 'end'>) => `${report.location}:${report.start}:${report.end}`;
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('El archivo contiene un registro inválido.');
  return value as Record<string, unknown>;
};
const text = (value: unknown, label: string, max = 240) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label}: texto inválido.`);
  return value.trim();
};
const amount = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000000) throw new Error('Importe inválido.');
  return money(value);
};
const count = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1000000) throw new Error('Conteo inválido.');
  return value;
};
const date = (value: unknown) => {
  const result = text(value, 'Fecha', 10);
  if (!validBeverageRange(result, result)) throw new Error('Fecha inválida.');
  return result;
};

export function parseProviImport(input: unknown): ProviReport[] {
  const root = object(input);
  if (root.schemaVersion !== 1 || !Array.isArray(root.reports) || !root.reports.length || root.reports.length > 30) throw new Error('Carga un archivo de reportes Provi de OpsVista (versión 1, máximo 30 reportes).');
  const reports = new Map<string, ProviReport>();
  for (const value of root.reports) {
    const row = object(value), location = text(row.location, 'Locación'), start = date(row.start), end = date(row.end);
    if (!beverageLocations.includes(location) || !validBeverageRange(start, end, 93)) throw new Error('Locación o período de Provi inválido (máximo 93 días).');
    if (!Array.isArray(row.topProducts) || row.topProducts.length > 1000) throw new Error('Lista de productos inválida.');
    const report: ProviReport = {
      location, start, end, spend: amount(row.spend), orders: count(row.orders), productCount: count(row.productCount), distributorCount: count(row.distributorCount),
      sourceNote: text(row.sourceNote, 'Nota de fuente', 2000),
      topProducts: row.topProducts.map(value => { const item = object(value); return { name: text(item.name, 'Producto'), distributor: text(item.distributor, 'Distribuidor'), quantity: text(item.quantity, 'Cantidad'), spend: amount(item.spend) }; }),
    };
    if (report.topProducts.length > report.productCount || money(report.topProducts.reduce((sum, item) => sum + item.spend, 0)) > report.spend + 0.02) throw new Error('Los productos destacados exceden el total del reporte.');
    if (row.baseline !== undefined) {
      const baseline = object(row.baseline), capturedAt = text(baseline.capturedAt, 'Fecha de revisión', 40);
      if (!Number.isFinite(Date.parse(capturedAt)) || !Array.isArray(baseline.invoices) || baseline.invoices.length > 2000) throw new Error('Corte de R365 inválido.');
      const invoices = new Map<string, BeverageInvoice>();
      for (const value of baseline.invoices) {
        const invoice = object(value), number = text(invoice.number, 'Factura'), vendor = text(invoice.vendor, 'Proveedor'), day = date(invoice.date);
        if (day < start || day > end || typeof invoice.approved !== 'boolean' || invoice.kind !== 'invoice') throw new Error('El corte importado debe contener facturas del mismo período y estado válido.');
        const key = JSON.stringify([vendor.toLowerCase(), number.toLowerCase(), day]);
        const parsed: BeverageInvoice = { id: key, number, date: day, vendor, approved: invoice.approved, kind: 'invoice', amount: invoice.amount === null ? null : amount(invoice.amount), suggested: suggestBeverageVendor(vendor) };
        const prior = invoices.get(key);
        if (prior && JSON.stringify(prior) !== JSON.stringify(parsed)) throw new Error('Hay versiones contradictorias de la misma factura.');
        invoices.set(key, parsed);
      }
      report.baseline = { capturedAt, note: text(baseline.note, 'Nota de revisión', 2000), invoices: [...invoices.values()] };
    }
    const key = proviReportKey(report), prior = reports.get(key);
    if (prior && JSON.stringify(prior) !== JSON.stringify(report)) throw new Error('El archivo repite una locación y período con valores diferentes.');
    reports.set(key, report);
  }
  return [...reports.values()];
}

export function summarizeProviComparison(report: ProviReport, slices: { invoices?: BeverageInvoice[]; updatedAt?: string; pending: boolean; error?: string }[]): ProviComparison {
  const expected = beverageChunks(report.start, report.end).length;
  const covered = slices.filter(slice => Array.isArray(slice.invoices)).length;
  const complete = slices.length === expected && covered === expected;
  const source = complete ? 'automatic' : report.baseline ? 'imported' : 'pending';
  const invoices = [...new Map((complete ? slices.flatMap(slice => slice.invoices || []) : report.baseline?.invoices || [])
    .filter(invoice => invoice.date >= report.start && invoice.date <= report.end && (invoice.suggested || suggestBeverageVendor(invoice.vendor)))
    .map(invoice => [invoice.id, invoice])).values()];
  const missingAmounts = invoices.filter(invoice => invoice.amount === null || !Number.isFinite(invoice.amount)).length;
  const sum = (rows: BeverageInvoice[]) => money(rows.reduce((total, row) => total + (row.kind === 'credit' ? -1 : 1) * Math.abs(row.amount || 0), 0));
  const available = source !== 'pending' && !missingAmounts;
  const invoiceTotal = available ? sum(invoices.filter(row => row.kind === 'invoice')) : null;
  const credits = complete && available ? -sum(invoices.filter(row => row.kind === 'credit')) : null;
  const net = complete && available ? sum(invoices) : null;
  const comparisonAmount = complete ? net : invoiceTotal;
  return {
    source, covered, expected, pending: !complete || slices.some(slice => slice.pending || slice.error) || Boolean(missingAmounts),
    updatedAt: complete ? slices.map(slice => slice.updatedAt || '').filter(Boolean).sort()[0] : report.baseline?.capturedAt,
    invoiceTotal, approved: available ? sum(invoices.filter(row => row.approved)) : null, pendingAmount: available ? sum(invoices.filter(row => !row.approved)) : null,
    credits, net, difference: comparisonAmount === null ? null : money(comparisonAmount - report.spend), missingAmounts,
    invoiceCount: invoices.filter(row => row.kind === 'invoice').length, creditCount: invoices.filter(row => row.kind === 'credit').length,
    invoices, note: complete ? 'R365: aprobadas y pendientes; créditos restados. Provi puede usar precios estimados. Verificar cada documento.' : report.baseline?.note || 'La sincronización está recuperando las facturas del período.',
  };
}
