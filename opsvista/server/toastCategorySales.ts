import { getToastSalesInputs, type Order, type Selection } from './toastBeverageSales.js';
import { roundSales, type CategorySalesReport, type CategorySalesRow } from '../shared/salesCategories.js';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const active = (item: Selection) => !item.deleted && !item.voided && !item.deferred && !['HOUSE_ACCOUNT_PAY_BALANCE', 'TOAST_CARD_SELL', 'TOAST_CARD_RELOAD'].includes(item.selectionType || '');

// Toast Selection.price includes quantity, modifiers and check/item discounts.
// Refunds are attributed to the original order's businessDate. This is not a
// refund-activity report for the date on which a refund was processed.
// https://doc.toasttab.com/openapi/orders/tag/Data-definitions/schema/Selection/
export function summarizeCategorySales(orders: Order[], names: Map<string, string>, location: string, start: string, end: string): CategorySalesReport {
  const rows = new Map<string, CategorySalesRow>();
  const warnings: CategorySalesReport['warnings'] = { missingPrices: 0, missingGross: 0, missingQuantities: 0, unallocatedRefunds: 0, unidentifiedCategories: 0 };
  const seen = new Set<string>();
  for (const order of orders) {
    if (order.guid && seen.has(order.guid)) continue;
    if (order.guid) seen.add(order.guid);
    const date = String(order.businessDate || '');
    if (date < start.replaceAll('-', '') || date > end.replaceAll('-', '') || order.deleted || order.voided || order.excessFood) continue;
    for (const check of order.checks || []) {
      if (check.deleted || check.voided) continue;
      let attributedRefunds = 0;
      for (const item of check.selections || []) {
        if (!active(item)) continue;
        const refund = Number(item.refundDetails?.refundAmount || 0);
        const taxRefund = Number(item.refundDetails?.taxRefundAmount || 0);
        if (!Number.isFinite(refund) || !Number.isFinite(taxRefund)) throw new Error('Invalid Toast refund');
        attributedRefunds += refund + taxRefund;
        if (!finite(item.price)) { warnings.missingPrices++; continue; }
        const categoryId = item.salesCategory?.guid || 'unassigned';
        const row = rows.get(categoryId) || { location, categoryId, categoryName: names.get(categoryId) || null, quantity: 0, grossSales: 0, discounts: 0, refunds: 0, netSales: 0 };
        if (finite(item.quantity)) { if (row.quantity !== null) row.quantity += item.quantity; }
        else { row.quantity = null; warnings.missingQuantities++; }
        if (finite(item.preDiscountPrice)) {
          if (row.grossSales !== null) row.grossSales += item.preDiscountPrice;
          if (row.discounts !== null) row.discounts += item.preDiscountPrice - item.price;
        } else { row.grossSales = null; row.discounts = null; warnings.missingGross++; }
        row.refunds += refund;
        row.netSales += item.price - refund;
        rows.set(categoryId, row);
      }
      const payments = (check.payments || []).reduce((sum, payment) => sum + Number(payment.refund?.refundAmount || 0), 0);
      const services = (check.appliedServiceCharges || []).reduce((sum, charge) => sum + Number(charge.refundDetails?.refundAmount || 0) + Number(charge.refundDetails?.taxRefundAmount || 0), 0);
      if (Math.abs(payments - attributedRefunds - services) > 0.02) warnings.unallocatedRefunds++;
    }
  }
  const result = [...rows.values()].map(row => ({ ...row,
    quantity: row.quantity === null ? null : roundSales(row.quantity),
    grossSales: row.grossSales === null ? null : roundSales(row.grossSales),
    discounts: row.discounts === null ? null : roundSales(row.discounts),
    refunds: roundSales(row.refunds), netSales: roundSales(row.netSales),
  })).sort((a, b) => b.netSales - a.netSales);
  warnings.unidentifiedCategories = result.filter(row => !row.categoryName).length;
  return { source: 'Toast', start, end, retrievedAt: new Date().toISOString(), rows: result, warnings };
}

const cache = new Map<string, { expires: number; report: CategorySalesReport }>();
const pending = new Map<string, Promise<CategorySalesReport>>();
export async function getToastCategorySales(location: string, start: string, end: string) {
  const key = JSON.stringify([location, start, end]);
  const saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved.report;
  if (pending.has(key)) return pending.get(key)!;
  const request = (async () => {
    const { orders, names } = await getToastSalesInputs(location, start, end);
    const report = summarizeCategorySales(orders, names, location, start, end);
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: Date.now() + 120_000, report });
    return report;
  })();
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}
