export const beverageLocations = ['Stamford', 'Orange', 'Fairfield', 'Danbury', 'Avon', 'Southington'];
export type BeverageGroup = 'spirits' | 'beer' | 'wine' | 'alcohol' | 'excluded' | 'unclassified';
export type BeverageCategory = { id: string; name: string; group: BeverageGroup; netSales: number; selections: number; items?: { name: string; netSales: number; group?: BeverageGroup }[] };
export type BeverageInvoice = { id: string; number?: string; date: string; vendor: string; approved: boolean; amount: number | null; kind: 'invoice' | 'credit'; suggested: boolean };
export type BeverageSource = {
  location: string; start: string; end: string; fetchedAt: string;
  memory?: { sales: { stored: boolean; updatedAt?: string; pending: boolean; error?: string }; purchases: { stored: boolean; updatedAt?: string; pending: boolean; error?: string } };
  sales: { categories: BeverageCategory[]; missingPrices: number; unallocatedRefunds: number; error?: string };
  purchases: { invoices: BeverageInvoice[]; error?: string };
};
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

// Suggestions are visible and editable. Ambiguous beverage categories stay unclassified.
export function suggestBeverageGroup(name: string): BeverageGroup {
  const value = normalize(name);
  if (/\b(non alcoholic|non alcohol|nonalcoholic|sin alcohol|mocktail|mocktails)\b/.test(value)) return 'excluded';
  if (/\b(beer|beers|cerveza|cervezas)\b/.test(value) && !/\b(wine|liquor|spirits)\b/.test(value)) return 'beer';
  if (/\b(wine|wines|vino|vinos)\b/.test(value) && !/\b(beer|liquor|spirits)\b/.test(value)) return 'wine';
  if (/\b(liquor|spirits|cocktail|cocktails|licor|licores|cocteles|margarita|margaritas|tequila|mezcal)\b/.test(value) && !/\b(beer|wine)\b/.test(value)) return 'spirits';
  if (/^(alcohol|alcoholic beverages|bebidas alcoholicas)$/.test(value)) return 'alcohol';
  if (/^(food|comida|foods|soft drinks|soda|sodas|dessert|desserts|merchandise|retail|gift cards|non alcoholic beverages)$/.test(value)) return 'excluded';
  return 'unclassified';
}
const nonAlcoholicItems = new Set([
  'diet coke','dier coke','coca cola','coca cola vidrio','coke','coke zero','sprite','fanta orange','root beer','ginger beer','ginger ale','club soda','tonic plain',
  'ice tea','iced tea','raspberry iced tea','hot tea','pink lemonade','fresh lemonade','lemonade','jarritos','shirley temple','shirly temple',
  'apple juice','orange juice','o j orange juice','pineapple juice','cranberry','cranberry juice','grapefruit plain','pineapple plain','tomato clamato juice',
  'milk','chocolate milk','chololate milk','soft drinks','hot chocolate','cafe','coffee','regular coffee','employee coffee','cappuccino','cappucinno','espresso','double espresso','americano','latte','cafe mocha',
  'saratoga','saratoga small','saratoga sparkling','saratoga sparkling water','saratoga still','saratoga still water','still water','san pelegrino lg',
  'topochico mineral','topochico mineral small','red bull','dr pepper','arnold palmer','jugo de naranja natural',
  'decaf','pelegrino','pelegrino lg','water still','still saratoga','jugo de naraja','topocchico mineral tall','odouls',
  'side ground beef','tortilla chips','3 estrellados well','botella clase azul vacia','cantarito glass','glass',
]);
export function suggestBeverageItem(name: string, category: BeverageGroup): BeverageGroup {
  if (category === 'excluded') return 'excluded';
  const value = normalize(name).replace(/ kd$/, '');
  if (/\b(virgin|virgen|virgyn|virgyin|vrgn|vrng|vgrn|mocktail|mocktails|non alcoholic|nonalcoholic|sin alcohol)\b/.test(value) || /\bheineken (zero|0 0)\b/.test(value) || nonAlcoholicItems.has(value)) return 'excluded';
  if (['mudslide','titos sour','clase azul plata','blue hawaian','frenchmartini','caipirihna'].includes(value)) return 'spirits';
  if (value==='mimosa') return 'wine';
  if (value==='high noon') return 'alcohol';
  // Alcohol content confirmed by the operator; combined until the recipe's
  // spirits/wine breakdown is verified.
  if (['all dragons','oasis','miami b','tita','cristalino 50'].includes(value)) return 'alcohol';
  if (['tecate','beer','cheladas'].includes(value)) return 'beer';
  if (/\b(margarita|martini|mojito|daiquiri|daquiri|cosmopolitan|tequila)\b/.test(value) || /^lalo(?: |$)/.test(value)) return 'spirits';
  if (/\b(corona|modelo|pacifico|blue moon|heineken|stella|xx lager|xx amber|dogfish|lagunitas|two roads|budlight|bud light|coors light|miller light|michelob|amstel|victoria)\b/.test(value)) return 'beer';
  if (/\b(cabernet|chardonnay|merlot|pinot|tempranillo|prosecco|cava|13 celsius|minimalista|chateau|cote des roses|argento|los vascos|decoy)\b/.test(value)) return 'wine';
  return category;
}
const suggestedVendors = new Set([
  'Brescome Barton Inc.', 'Connecticut Distributors Inc.', 'Eder-Goodman Fine Wine and Spirits',
  'Martignetti Companies - CT', 'Northeast Beverage of Connecticut', 'Star Distributors Inc. - Connecticut',
  'Allan S Goodman Inc', 'Hartford Distributors, Inc.', 'Dichello Distributors Inc',
].map(normalize));
export const suggestBeverageVendor = (name: string) => suggestedVendors.has(normalize(name));
export function addDays(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10);
}
export function validBeverageRange(start: string, end: string, maxDays = 7) {
  const valid = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  return valid(start) && valid(end) && start <= end && (Date.parse(end) - Date.parse(start)) / 86400000 < maxDays;
}
export function beverageChunks(start: string, end: string) {
  const chunks: { start: string; end: string }[] = [];
  for (let cursor = start; cursor <= end;) { const last = addDays(cursor, 6); const until = last < end ? last : end; chunks.push({ start: cursor, end: until }); cursor = addDays(until, 1); }
  return chunks;
}
export type BeverageComparison = {
  location: string; sales: number | null; spirits: number; beer: number; wine: number; alcohol: number;
  purchases: number | null; pending: number; invoiceCount: number; creditCount: number;
  purchasePct: number | null; salesLessPurchases: number | null; purchaseMarginPct: number | null;
  unclassifiedSales: number; issues: string[]; rank: number | null;
};
export function compareBeverages(location: string, sources: BeverageSource[], expectedChunks: number,
  categoryGroups: Record<string, BeverageGroup> = {}, vendors: Record<string, boolean> = {}, itemGroups: Record<string, BeverageGroup> = {}): BeverageComparison {
  const issues: string[] = [];
  const rows = [...new Map(sources.filter(row => row.location === location).map(row => [`${row.start}:${row.end}`, row])).values()];
  const complete = new Set(rows.map(row => `${row.start}:${row.end}`)).size === expectedChunks;
  if (!complete) issues.push('Periodo incompleto');
  let salesReady = complete, purchasesReady = complete;
  const totals = { spirits: 0, beer: 0, wine: 0, alcohol: 0, unclassified: 0, excluded: 0 };
  let purchases = 0, pending = 0, invoiceCount = 0, creditCount = 0, matched = 0, pendingCount = 0;
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.memory?.sales.pending || row.memory?.purchases.pending) issues.push('Actualización pendiente: se muestra la última copia guardada');
    if (row.sales.error) { salesReady = false; issues.push(`Toast: ${row.sales.error}`); }
    if (row.purchases.error) { purchasesReady = false; issues.push(`R365: ${row.purchases.error}`); }
    if (row.sales.missingPrices) { salesReady = false; issues.push(`${row.sales.missingPrices} artículos sin precio`); }
    if (row.sales.unallocatedRefunds) { salesReady = false; issues.push(`${row.sales.unallocatedRefunds} cuentas con reembolso sin conciliar`); }
    for (const category of row.sales.categories) {
      const categoryKey = `${location}:${category.id}`;
      if (category.items?.length) {
        const itemTotal = money(category.items.reduce((sum, item) => sum + item.netSales, 0));
        if (Math.abs(itemTotal-category.netSales) > 0.02) { salesReady = false; issues.push('Desglose de productos incompleto'); }
        for (const item of category.items) {
          const group = itemGroups[`${categoryKey}:${item.name}`] ?? categoryGroups[categoryKey] ?? suggestBeverageItem(item.name, category.group);
          totals[group] += item.netSales;
          if (group === 'unclassified' && item.netSales !== 0) salesReady = false;
        }
      } else {
        const group = categoryGroups[categoryKey] ?? category.group;
        totals[group] += category.netSales;
        if (group === 'unclassified' && category.netSales !== 0) salesReady = false;
      }
    }
    for (const invoice of row.purchases.invoices) {
      if (invoice.vendor === 'Proveedor sin identificar' && vendors[invoice.vendor] === undefined) { purchasesReady = false; issues.push('Identificar proveedor de R365'); }
      if (seen.has(invoice.id)) continue;
      seen.add(invoice.id);
      if (!(vendors[invoice.vendor] ?? (invoice.suggested || suggestBeverageVendor(invoice.vendor)))) continue;
      matched++;
      if (invoice.amount === null || !Number.isFinite(invoice.amount)) { purchasesReady = false; issues.push('Factura seleccionada sin monto'); continue; }
      const amount = (invoice.kind === 'credit' ? -1 : 1) * Math.abs(invoice.amount);
      if (!invoice.approved) { pending += amount; pendingCount++; continue; }
      purchases += amount;
      if (invoice.kind === 'credit') creditCount++; else invoiceCount++;
    }
  }
  if (!matched) { purchasesReady = false; issues.push('Sin compras identificadas: confirmar cobertura'); }
  if (pendingCount) issues.push(`${pendingCount} documentos pendientes de aprobación`);
  if (!salesReady && totals.unclassified !== 0) issues.push('Clasificar categorías de Toast');
  const sales = salesReady ? money(totals.spirits + totals.beer + totals.wine + totals.alcohol) : null;
  const cost = purchasesReady ? money(purchases) : null;
  // No purchase history, pending AP, or negative net purchases cannot win the ranking.
  const sourcePending = rows.some(row => row.memory?.sales.pending || row.memory?.purchases.pending);
  const comparable = !sourcePending && sales !== null && sales > 0 && cost !== null && cost >= 0 && invoiceCount > 0 && !pendingCount;
  if (cost !== null && cost < 0) issues.push('Créditos superiores a compras');
  if (sales !== null && sales <= 0) issues.push('Sin ventas positivas de alcohol');
  const purchasePct = comparable ? money(cost! / sales! * 100) : null;
  return { location, sales, spirits: money(totals.spirits), beer: money(totals.beer), wine: money(totals.wine), alcohol: money(totals.alcohol),
    purchases: cost, pending: money(pending), invoiceCount, creditCount, purchasePct,
    salesLessPurchases: comparable ? money(sales! - cost!) : null, purchaseMarginPct: purchasePct === null ? null : money(100 - purchasePct),
    unclassifiedSales: money(totals.unclassified), issues: [...new Set(issues)], rank: null };
}
export function rankBeverages(rows: BeverageComparison[]) {
  const sorted = [...rows].sort((a, b) => (a.purchasePct ?? Infinity) - (b.purchasePct ?? Infinity) || a.location.localeCompare(b.location));
  let previous: number | null = null, rank = 0;
  return sorted.map((row, index) => {
    if (row.purchasePct === null) return { ...row, rank: null };
    if (row.purchasePct !== previous) rank = index + 1;
    previous = row.purchasePct; return { ...row, rank };
  });
}
