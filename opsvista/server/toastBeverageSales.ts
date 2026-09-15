import { standardToastRequest, toastLocations } from './toastClient.js';
import { addDays, money, suggestBeverageGroup, type BeverageSource } from '../shared/beverageMetrics.js';

type Selection = { guid?: string; salesCategory?: { guid?: string }; price?: number; quantity?: number; voided?: boolean; deleted?: boolean; deferred?: boolean; selectionType?: string; refundDetails?: { refundAmount?: number; taxRefundAmount?: number }; modifiers?: Selection[] };
type Check = { deleted?: boolean; voided?: boolean; selections?: Selection[]; payments?: { refund?: { refundAmount?: number } }[]; appliedServiceCharges?: { refundDetails?: { refundAmount?: number; taxRefundAmount?: number } }[] };
type Order = { guid?: string; businessDate?: number; deleted?: boolean; voided?: boolean; excessFood?: boolean; checks?: Check[] };
type Category = { guid?: string; name?: string };
const active = (selection: Selection) => !selection.deleted && !selection.voided && !selection.deferred && !['HOUSE_ACCOUNT_PAY_BALANCE', 'TOAST_CARD_SELL', 'TOAST_CARD_RELOAD'].includes(selection.selectionType || '');

export function summarizeBeverageSales(orders: Order[], start: string, end: string, names: Map<string, string>): BeverageSource['sales'] {
  const categories = new Map<string, { id: string; name: string; group: ReturnType<typeof suggestBeverageGroup>; netSales: number; selections: number }>();
  let missingPrices = 0, unallocatedRefunds = 0;
  const seen = new Set<string>();
  for (const order of orders) {
    if (order.guid && seen.has(order.guid)) continue;
    if (order.guid) seen.add(order.guid);
    const day = String(order.businessDate || '');
    if (day < start.replaceAll('-', '') || day > end.replaceAll('-', '') || order.deleted || order.voided || order.excessFood) continue;
    for (const check of order.checks || []) {
      if (check.deleted || check.voided) continue;
      let itemRefunds = 0;
      for (const selection of check.selections || []) {
        if (!active(selection)) continue;
        const id = selection.salesCategory?.guid || 'unassigned';
        const name = names.get(id) || 'Categoría sin identificar';
        const category = categories.get(id) || { id, name, group: suggestBeverageGroup(name), netSales: 0, selections: 0 };
        if (typeof selection.price !== 'number' || !Number.isFinite(selection.price)) { missingPrices++; continue; }
        const refund = Number(selection.refundDetails?.refundAmount || 0);
        // Toast price already includes quantity, modifiers and check/item discounts.
        // RefundDetails includes nested modifier refunds. Never multiply or add them again.
        category.netSales += selection.price - refund; category.selections++;
        itemRefunds += refund + Number(selection.refundDetails?.taxRefundAmount || 0);
        categories.set(id, category);
      }
      const paymentRefunds = (check.payments || []).reduce((sum, payment) => sum + Number(payment.refund?.refundAmount || 0), 0);
      const serviceRefunds = (check.appliedServiceCharges || []).reduce((sum, charge) => sum + Number(charge.refundDetails?.refundAmount || 0) + Number(charge.refundDetails?.taxRefundAmount || 0), 0);
      // Payment refunds can include tax. If money was refunded without item/service
      // attribution, do not allocate it proportionally and invent alcohol revenue.
      if (Math.abs(paymentRefunds - itemRefunds - serviceRefunds) > 0.02) unallocatedRefunds++;
    }
  }
  return { categories: [...categories.values()].map(row => ({ ...row, netSales: money(row.netSales) })), missingPrices, unallocatedRefunds };
}

export async function getToastBeverageSales(location: string, start: string, end: string): Promise<BeverageSource['sales']> {
  const matches = Object.entries(toastLocations()).filter(([name]) => new RegExp(`(^|[^a-z])${location.toLowerCase()}([^a-z]|$)`).test(name.toLowerCase()));
  if (matches.length !== 1) throw new Error(`Toast: correspondencia de ${location} no es única`);
  const guid = matches[0][1], orders: Order[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    for (let page = 1; ; page++) {
      const query = new URLSearchParams({ businessDate: day.replaceAll('-', ''), page: String(page), pageSize: '100' });
      const data = await standardToastRequest(`/orders/v2/ordersBulk?${query}`, guid) as Order[];
      if (!Array.isArray(data)) throw new Error('Toast devolvió órdenes inválidas');
      orders.push(...data);
      if (data.length < 100) break;
      if (page >= 50) throw new Error('Órdenes incompletas: se alcanzó el límite de paginación');
    }
  }
  const ids = [...new Set(orders.flatMap(order => (order.checks || []).flatMap(check => (check.selections || []).filter(active).map(selection => selection.salesCategory?.guid).filter((id): id is string => !!id))))];
  const names = new Map<string, string>();
  // Resolve the categories actually sold, including archived categories; never
  // assume the first page of the configuration catalog is complete.
  for (const id of ids) {
    try {
      const category = await standardToastRequest(`/config/v2/salesCategories/${encodeURIComponent(id)}`, guid) as Category;
      if (category.name) names.set(id, category.name);
    } catch { /* Keep the category visible and unclassified for reconciliation. */ }
  }
  return summarizeBeverageSales(orders, start, end, names);
}
