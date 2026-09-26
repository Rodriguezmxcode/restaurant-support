import type {ActionRecord, PerformanceLocation} from './types';

export const isOpen = (action: ActionRecord) => !['Completed', 'Dismissed'].includes(action.status);
export const inLocation = <T extends {location: string}>(rows: T[], location: string) =>
  location ? rows.filter(row => row.location === location) : rows;
export const prioritize = (actions: ActionRecord[]) => [...actions].sort((a, b) =>
  ({High: 0, Medium: 1, Low: 2}[a.severity] - {High: 0, Medium: 1, Low: 2}[b.severity]) || b.priorityScore - a.priorityScore);
export function summarize(rows: PerformanceLocation[]) {
  if (!rows.length) return null;
  const totals = rows.reduce((sum, row) => ({
    netSales: sum.netSales + row.netSales, totalLaborCost: sum.totalLaborCost + row.totalLaborCost,
    hourlyHours: sum.hourlyHours + row.hourlyHours, overtimeHours: sum.overtimeHours + row.overtimeHours,
  }), {netSales: 0, totalLaborCost: 0, hourlyHours: 0, overtimeHours: 0});
  return {...totals, totalLaborPct: totals.netSales > 0 ? totals.totalLaborCost / totals.netSales * 100 : null};
}
export const money = (value?: number | null) => value == null || !Number.isFinite(value) ? '—' :
  new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', maximumFractionDigits: 0}).format(value);
export const number = (value?: number | null, suffix = '') => value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}${suffix}`;
