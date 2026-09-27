export const alertLocations = ['Stamford', 'Orange', 'Fairfield', 'Danbury', 'Avon', 'Southington'] as const;
export const alertJobs = ['performance', 'overtime', 'tasks', 'logbook', 'reviews', 'ramp', 'prices', 'bonus'] as const;
export type AlertJob = typeof alertJobs[number];
export type OperationalAlert = { key: string; kind: AlertJob; location: string; title: string; body: string; module: string };
export function alertClock(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  return { day, hour: Number(p.hour), weekday: new Date(`${day}T12:00:00Z`).getUTCDay() };
}
export const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const operationalWeekStart = (day: string) => shiftDay(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() - 3 + 7) % 7));
export function alertJobDue(job: AlertJob, now = new Date()) {
  const { hour } = alertClock(now);
  if (hour < 9 || hour >= 23) return false;
  if (job === 'performance') return hour >= 17;
  if (job === 'tasks') return hour >= 21;
  if (job === 'overtime') return hour >= 15;
  return true;
}
export function canonicalAlertLocation(value: string) {
  return alertLocations.find(location => location.toLowerCase() === value.trim().toLowerCase());
}
export function performanceWarnings(row: { netSales: number; bonusDiscountPct: number; voidPct: number }, hour: number, totalLaborPct: number | null, target?: number) {
  if (!Number.isFinite(row.netSales) || row.netSales < 1000) return [];
  const warnings: string[] = [];
  if (totalLaborPct !== null && Number.isFinite(totalLaborPct) && totalLaborPct > 32) warnings.push(`Labor total acumulado ${totalLaborPct.toFixed(1)}% (alerta >32%).`);
  if (row.bonusDiscountPct > 2) warnings.push(`Descuentos ${row.bonusDiscountPct.toFixed(2)}% (>2%; excluye Uber Eats y comidas de empleados).`);
  if (row.voidPct > .5) warnings.push(`Voids ${row.voidPct.toFixed(2)}% (>0.50%).`);
  const pace = hour >= 21 ? .9 : hour >= 18 ? .65 : 0;
  if (target && Number.isFinite(target) && target > 0 && pace && row.netSales < target * pace) warnings.push(`Ventas $${Math.round(row.netSales).toLocaleString('en-US')} por debajo del ${Math.round(pace * 100)}% de la meta diaria configurada ($${Math.round(target).toLocaleString('en-US')}).`);
  return warnings;
}
export function overdueExpense(row: { state: string; amount: number; transactionTime?: string; date: string; memo?: string; receiptAttached: boolean }, now = new Date()) {
  // Without an exact timestamp, wait three full calendar days rather than
  // inventing the transaction time and incorrectly declaring a 48-hour breach.
  const exact = row.transactionTime ? Date.parse(row.transactionTime) : NaN;
  const overdue = Number.isFinite(exact) ? now.getTime() - exact >= 48 * 3600000 : row.date <= shiftDay(alertClock(now).day, -3);
  return row.state === 'CLEARED' && row.amount > 0 && overdue && (!row.memo?.trim() || !row.receiptAttached);
}
