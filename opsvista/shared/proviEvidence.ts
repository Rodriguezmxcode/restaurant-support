import { beverageLocations, money, validBeverageRange, type BeverageInvoice } from './beverageMetrics.js';

export type ProviEvidenceItem = {
  name: string;
  distributor: string;
  quantity: string;
  spend: number | null;
};

export type ProviEvidenceDraft = {
  location: string;
  orderDate: string;
  deliveryDate: string | null;
  vendor: string;
  orderNumber: string | null;
  orderedAmount: number;
  items: ProviEvidenceItem[];
  sourceNote: string;
  confidence: number;
};

export type ProviSourceFile = { name: string; mime: string; data: string };
export type ProviEvidenceStatus = 'provisional' | 'verified' | 'needs_review';
export type ProviEvidenceMatch = {
  status: ProviEvidenceStatus;
  confidence: number;
  reason: string;
  candidateCount: number;
  difference: number | null;
  invoice: BeverageInvoice | null;
};
export type StoredProviEvidence = ProviEvidenceDraft & {
  id: string;
  documentId: string;
  savedAt: string;
  sourceFiles: { name: string; mime: string }[];
  match: ProviEvidenceMatch;
};

const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('La compra contiene datos inválidos.');
  return value as Record<string, unknown>;
};
const text = (value: unknown, label: string, max = 240) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${label}: valor inválido.`);
  return value.trim();
};
const nullableText = (value: unknown, label: string, max = 240) => {
  if (value === null || value === undefined || value === '') return null;
  return text(value, label, max);
};
const day = (value: unknown, label: string) => {
  const result = text(value, label, 10);
  if (!validBeverageRange(result, result)) throw new Error(`${label}: fecha inválida.`);
  return result;
};
const nullableDay = (value: unknown, label: string) => {
  if (value === null || value === undefined || value === '') return null;
  return day(value, label);
};
const amount = (value: unknown, label: string, nullable = false) => {
  if (nullable && (value === null || value === undefined || value === '')) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000000) throw new Error(`${label}: importe inválido.`);
  return money(value);
};

export function parseProviEvidenceDrafts(input: unknown): ProviEvidenceDraft[] {
  if (!Array.isArray(input) || !input.length || input.length > 20) throw new Error('La evidencia debe contener entre 1 y 20 compras.');
  return input.map(value => {
    const row = object(value);
    const location = text(row.location, 'Locación', 80);
    if (!beverageLocations.includes(location)) throw new Error(`Locación Provi no válida: ${location}.`);
    const orderDate = day(row.orderDate, 'Fecha de orden');
    const deliveryDate = nullableDay(row.deliveryDate, 'Fecha de entrega');
    if (deliveryDate && Math.abs(Date.parse(deliveryDate) - Date.parse(orderDate)) > 14 * 86400000) throw new Error('La fecha de entrega está demasiado lejos de la fecha de orden.');
    if (!Array.isArray(row.items) || row.items.length > 250) throw new Error('La lista de productos de Provi es inválida.');
    const confidence = typeof row.confidence === 'number' && Number.isFinite(row.confidence)
      ? Math.max(0, Math.min(1, row.confidence)) : 1;
    return {
      location,
      orderDate,
      deliveryDate,
      vendor: text(row.vendor, 'Distribuidor', 180),
      orderNumber: nullableText(row.orderNumber, 'Número de orden', 120),
      orderedAmount: amount(row.orderedAmount, 'Total de Provi') as number,
      items: row.items.map(value => {
        const item = object(value);
        return {
          name: text(item.name, 'Producto', 240),
          distributor: text(item.distributor, 'Distribuidor del producto', 180),
          quantity: text(item.quantity, 'Cantidad', 80),
          spend: amount(item.spend, 'Importe de producto', true),
        };
      }),
      sourceNote: typeof row.sourceNote === 'string' ? row.sourceNote.trim().slice(0, 2000) : '',
      confidence,
    };
  });
}

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const vendorTokens = (value: string) => normalize(value).split(' ').filter(token => token && !new Set(['inc', 'llc', 'co', 'company', 'companies', 'distributor', 'distributors', 'distribution', 'ct', 'connecticut', 'the']).has(token));
const vendorSimilarity = (left: string, right: string) => {
  const a = vendorTokens(left), b = vendorTokens(right);
  if (!a.length || !b.length) return 0;
  if (a.join(' ') === b.join(' ')) return 1;
  const rightSet = new Set(b), overlap = a.filter(token => rightSet.has(token)).length;
  return overlap / Math.max(a.length, b.length);
};
const numberKey = (value?: string | null) => normalize(value || '').replace(/\s+/g, '');
const dayDistance = (left: string, right: string) => Math.abs(Date.parse(left) - Date.parse(right)) / 86400000;

export function proviEvidenceKey(row: Pick<ProviEvidenceDraft, 'location' | 'orderDate' | 'vendor' | 'orderNumber' | 'orderedAmount'>) {
  const vendor = normalize(row.vendor), order = numberKey(row.orderNumber);
  return order
    ? JSON.stringify([row.location, vendor, order])
    : JSON.stringify([row.location, row.orderDate, vendor, money(row.orderedAmount)]);
}

export function reconcileProviEvidence(evidence: ProviEvidenceDraft, invoices: BeverageInvoice[]): ProviEvidenceMatch {
  const referenceDate = evidence.deliveryDate || evidence.orderDate;
  const candidates = invoices.filter(invoice => invoice.kind === 'invoice' && invoice.amount !== null && Number.isFinite(invoice.amount) && dayDistance(referenceDate, invoice.date) <= 5)
    .map(invoice => {
      const difference = money((invoice.amount || 0) - evidence.orderedAmount);
      const tolerance = Math.max(5, Math.abs(evidence.orderedAmount) * 0.025);
      const amountClose = Math.abs(difference) <= tolerance;
      const vendorScore = vendorSimilarity(evidence.vendor, invoice.vendor);
      const distance = dayDistance(referenceDate, invoice.date);
      const orderKey = numberKey(evidence.orderNumber), invoiceKey = numberKey(invoice.number);
      const numberExact = Boolean(orderKey && invoiceKey && orderKey === invoiceKey);
      const score = Math.min(1,
        (numberExact ? 0.65 : 0) +
        (amountClose ? 0.25 : Math.abs(difference) <= Math.max(20, evidence.orderedAmount * 0.08) ? 0.08 : 0) +
        vendorScore * 0.2 +
        (distance <= 1 ? 0.1 : distance <= 3 ? 0.07 : 0.03));
      return { invoice, difference, amountClose, vendorScore, distance, numberExact, score };
    }).sort((a, b) => b.score - a.score || Math.abs(a.difference) - Math.abs(b.difference));

  const top = candidates[0], second = candidates[1];
  const candidateCount = candidates.filter(candidate => candidate.score >= 0.35).length;
  if (!top || top.score < 0.45) return {
    status: 'provisional', confidence: top?.score || 0, candidateCount,
    reason: 'Todavía no aparece una factura de R365 con suficiente coincidencia.', difference: null, invoice: null,
  };
  const ambiguous = Boolean(second && second.score >= 0.45 && top.score - second.score < 0.08 && !top.numberExact);
  const verified = !ambiguous && top.score >= 0.72 && (top.numberExact || (top.amountClose && top.vendorScore >= 0.5));
  if (verified) return {
    status: 'verified', confidence: money(top.score), candidateCount,
    reason: top.numberExact ? 'Número de orden/factura y datos de compra coinciden.' : 'Proveedor, fecha y monto coinciden con R365.',
    difference: top.difference, invoice: top.invoice,
  };
  return {
    status: 'needs_review', confidence: money(top.score), candidateCount,
    reason: ambiguous ? 'Hay más de una factura posible en R365; se requiere revisión.' : 'Existe una posible factura de R365, pero la coincidencia no es suficiente para unirla automáticamente.',
    difference: top.difference, invoice: top.invoice,
  };
}
