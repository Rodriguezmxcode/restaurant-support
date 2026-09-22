// Finance is an isolated reporting source. Nothing here feeds payroll, bonuses,
// payments, operating alerts, Ramp or Restaurant365.
export const financeLocations = ['Avon', 'Danbury', 'Fairfield', 'Orange', 'Southington', 'Stamford'] as const;
export type FinanceLocation = typeof financeLocations[number];
export type FinanceRecord = {
  location: FinanceLocation;
  month: string;
  currency: 'USD';
  status: 'provisional';
  sales: number;
  cogs: number;
  labor: number;
  operatingExpenses: number; // Includes occupancy; see source references.
  operatingResult: number;
  extraordinary: number | null; // Signed, separately disclosed; null = unavailable.
  payrollBasis: string;
  corporateStatus: 'incomplete';
  rampIncluded: number | null; // Already inside expenses; never add it again.
  notes: string[];
  source: { file: string; sha256: string; references: Record<string, string> };
  bank: { asOf: string; closingBalance: number; reference: string; note: string } | null;
};
export type FinanceImport = { format: 'opsvista-finance-v1'; records: FinanceRecord[] };
export type SavedFinanceRecord = { record: FinanceRecord; revision: string; savedAt: string };
export const financeKey = (record: Pick<FinanceRecord, 'location' | 'month'>) => `${record.location}:${record.month}`;
export const toCents = (value: number) => Math.round(value * 100);
export const financeMargin = (result: number, sales: number) => sales > 0 ? result / sales * 100 : null;
export function calendarDays(month: string) {
  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Mes no válido.');
  const [year, part] = month.split('-').map(Number);
  return new Date(Date.UTC(year, part, 0)).getUTCDate();
}
function object(value: unknown, keys?: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Formato de Finanzas no válido.');
  const row = value as Record<string, unknown>;
  if (keys && (Object.keys(row).some(key => !keys.includes(key)) || keys.some(key => !(key in row)))) throw new Error('Campos de Finanzas no válidos.');
  return row;
}
function text(value: unknown, max = 1200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Falta una descripción o referencia válida.');
  return value.trim();
}
function amount(value: unknown, signed = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000 || (!signed && value < 0) || Math.abs(value * 100 - Math.round(value * 100)) > 0.00001) throw new Error('Importe no válido: usa USD con hasta dos decimales.');
  return toCents(value) / 100;
}
export function parseFinanceImport(value: unknown): FinanceImport {
  const root = object(value, ['format', 'records']);
  if (root.format !== 'opsvista-finance-v1' || !Array.isArray(root.records) || !root.records.length || root.records.length > 72) throw new Error('Selecciona un archivo de Finanzas con entre 1 y 72 reportes.');
  const seen = new Set<string>();
  const records = root.records.map(raw => {
    const r = object(raw, ['location', 'month', 'currency', 'status', 'sales', 'cogs', 'labor', 'operatingExpenses', 'operatingResult', 'extraordinary', 'payrollBasis', 'corporateStatus', 'rampIncluded', 'notes', 'source', 'bank']);
    if (!financeLocations.includes(r.location as FinanceLocation) || r.currency !== 'USD' || r.status !== 'provisional' || r.corporateStatus !== 'incomplete') throw new Error('Revisa locación, moneda y estado provisional.');
    const month = text(r.month, 7); calendarDays(month);
    const source = object(r.source, ['file', 'sha256', 'references']);
    const hash = text(source.sha256, 64);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('La fuente debe incluir su identificador SHA-256.');
    const refs = object(source.references);
    const required = ['sales', 'cogs', 'labor', 'operatingExpenses', 'operatingResult'];
    if (required.some(key => !(key in refs)) || Object.keys(refs).some(key => ![...required, 'extraordinary', 'rampIncluded'].includes(key))) throw new Error('Faltan referencias de las cifras principales.');
    const references = Object.fromEntries(Object.entries(refs).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, text(value)]));
    if (!Array.isArray(r.notes) || !r.notes.length || r.notes.length > 20) throw new Error('Incluye las notas del reporte.');
    let bank: FinanceRecord['bank'] = null;
    if (r.bank !== null) {
      const b = object(r.bank, ['asOf', 'closingBalance', 'reference', 'note']);
      if (b.asOf !== `${month}-${calendarDays(month)}`) throw new Error('El cierre bancario debe corresponder al último día del mes reportado.');
      bank = { asOf: String(b.asOf), closingBalance: amount(b.closingBalance, true), reference: text(b.reference), note: text(b.note) };
    }
    const record: FinanceRecord = {
      location: r.location as FinanceLocation, month, currency: 'USD', status: 'provisional',
      sales: amount(r.sales), cogs: amount(r.cogs), labor: amount(r.labor), operatingExpenses: amount(r.operatingExpenses), operatingResult: amount(r.operatingResult, true),
      extraordinary: r.extraordinary === null ? null : amount(r.extraordinary, true), payrollBasis: text(r.payrollBasis), corporateStatus: 'incomplete', rampIncluded: r.rampIncluded === null ? null : amount(r.rampIncluded),
      notes: r.notes.map(note => text(note)), source: { file: text(source.file, 240), sha256: hash, references }, bank,
    };
    const delta = toCents(record.sales) - toCents(record.cogs) - toCents(record.labor) - toCents(record.operatingExpenses) - toCents(record.operatingResult);
    if (Math.abs(delta) > 2) throw new Error(`${record.location} · ${month}: el resultado no concilia con ventas menos costos y gastos.`);
    for (const key of ['extraordinary', 'rampIncluded'] as const) if (record[key] !== null && !references[key]) throw new Error(`Falta la referencia de ${key}.`);
    const key = financeKey(record);
    if (seen.has(key)) throw new Error(`Reporte duplicado: ${key}.`);
    seen.add(key);
    return record;
  });
  return { format: 'opsvista-finance-v1', records: records.sort((a, b) => financeKey(a).localeCompare(financeKey(b))) };
}
export function summarizeFinance(records: FinanceRecord[]) {
  const sum = (key: 'sales' | 'cogs' | 'labor' | 'operatingExpenses' | 'operatingResult') => records.length ? records.reduce((total, row) => total + toCents(row[key]), 0) / 100 : null;
  const sales = sum('sales'), result = sum('operatingResult');
  return { count: records.length, sales, cogs: sum('cogs'), labor: sum('labor'), operatingExpenses: sum('operatingExpenses'), operatingResult: result, margin: sales !== null && result !== null ? financeMargin(result, sales) : null };
}
