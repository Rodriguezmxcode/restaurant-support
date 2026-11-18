export type CategorySalesRow = {
  location: string;
  categoryId: string;
  categoryName: string | null;
  quantity: number | null;
  grossSales: number | null;
  discounts: number | null;
  refunds: number;
  netSales: number;
};
export type CategorySalesReport = {
  source: 'Toast';
  start: string;
  end: string;
  retrievedAt: string;
  rows: CategorySalesRow[];
  warnings: { missingPrices: number; missingGross: number; missingQuantities: number; unallocatedRefunds: number; unidentifiedCategories: number };
};

export const roundSales = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const categoryKey = (row: CategorySalesRow) => row.categoryName ? `name:${row.categoryName}` : `id:${row.location}:${row.categoryId}`;
export function categoryTotals(rows: CategorySalesRow[]) {
  const nullableSum = (key: 'quantity' | 'grossSales' | 'discounts') => rows.some(row => row[key] === null) ? null : roundSales(rows.reduce((sum, row) => sum + (row[key] ?? 0), 0));
  return { quantity: nullableSum('quantity'), grossSales: nullableSum('grossSales'), discounts: nullableSum('discounts'), refunds: roundSales(rows.reduce((sum, row) => sum + row.refunds, 0)), netSales: roundSales(rows.reduce((sum, row) => sum + row.netSales, 0)) };
}
export function mergeCategoryReports(reports: CategorySalesReport[], start: string, end: string): CategorySalesReport {
  const rows = new Map<string, CategorySalesRow>();
  const warnings: CategorySalesReport['warnings'] = { missingPrices: 0, missingGross: 0, missingQuantities: 0, unallocatedRefunds: 0, unidentifiedCategories: 0 };
  for (const report of reports) {
    for (const key of Object.keys(warnings) as (keyof typeof warnings)[]) warnings[key] += report.warnings[key];
    for (const row of report.rows) {
      const key = JSON.stringify([row.location, row.categoryId]);
      const previous = rows.get(key);
      rows.set(key, previous ? { ...previous, categoryName: previous.categoryName ?? row.categoryName, ...categoryTotals([previous, row]) } : { ...row });
    }
  }
  return { source: 'Toast', start, end, retrievedAt: reports.map(report => report.retrievedAt).sort()[0] || new Date().toISOString(), rows: [...rows.values()].sort((a, b) => b.netSales - a.netSales || a.location.localeCompare(b.location)), warnings };
}
