import { calculateSalaryTiming, type OperatingSchedule, type SalaryTiming } from '../shared/salaryTiming.js';
import { VERIFIED_GOOGLE_HOURS } from './verifiedGoogleHours.js';

type InputRow = { location: string; salaryLaborCost: number; hourlyLaborCost: number; netSales: number; salaryConfigured: boolean };

export function verifiedHoursFallback(asOf: Date): Record<string, OperatingSchedule> {
  return Object.fromEntries(Object.entries(VERIFIED_GOOGLE_HOURS).filter(([, schedule]) =>
    schedule.verifiedAt && asOf.getTime() - Date.parse(schedule.verifiedAt) <= 7 * 86_400_000));
}

export function intradaySalary(date: string, rows: InputRow[], asOf: Date, schedules: Record<string, OperatingSchedule> = {}): SalaryTiming {
  const normalize = (value: string) => value.trim().toLowerCase();
  const output = rows.map(row => {
    const matches = Object.keys(schedules).filter(key => normalize(row.location) === normalize(key) || normalize(row.location).endsWith(` ${normalize(key)}`));
    const exact = Object.keys(schedules).find(key => normalize(key) === normalize(row.location));
    const key = exact ?? (matches.length === 1 ? matches[0] : undefined);
    return calculateSalaryTiming({
      location: row.location, date, now: asOf, fullDaySalary: row.salaryLaborCost,
      hourlyLabor: row.hourlyLaborCost, netSales: row.netSales, salaryConfigured: row.salaryConfigured,
      schedule: key ? schedules[key] : undefined,
    });
  });
  return { date, asOf: asOf.toISOString(), applied: output.length > 0 && output.every(row => row.accruedSalary !== null), rows: output };
}
