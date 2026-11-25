export type OperatingWindow = { open: string; close: string; closeDayOffset?: number };
type OperatingDay = OperatingWindow | OperatingWindow[] | null;
export type OperatingSchedule = {
  timeZone: string;
  week: Record<string, OperatingDay>;
  dates?: Record<string, OperatingDay>;
  source?: string;
  verifiedAt?: string;
  sourceUrl?: string;
};
export type SalaryTimingRow = {
  location: string;
  status: 'missing_salary' | 'missing_hours' | 'closed' | 'before_open' | 'open' | 'complete';
  timeZone: string | null;
  open: string | null;
  close: string | null;
  operatingHours: number | null;
  elapsedHours: number | null;
  allocatedPct: number | null;
  hourlyAllocation: number | null;
  fullDaySalary: number;
  accruedSalary: number | null;
  remainingSalary: number | null;
  hourlyLabor: number;
  totalAccruedLabor: number | null;
  salaryPct: number | null;
  hourlyPct: number | null;
  totalPct: number | null;
  fullDaySalaryPct: number | null;
  hoursSource?: string;
  hoursVerifiedAt?: string;
  hoursSourceUrl?: string;
};
export type SalaryTiming = {
  date: string;
  asOf: string;
  applied: boolean;
  rows: SalaryTimingRow[];
  hoursError?: string;
};

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const costPct = (cost: number | null, sales: number) => cost !== null && sales > 0 ? roundMoney(cost / sales * 100) : null;

function localParts(instant: Date, timeZone: string) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).map(part => [part.type, part.value]));
}

// Resolve local schedule boundaries to instants so overnight and DST durations
// use elapsed time, rather than the browser's time zone or a fixed UTC offset.
function zonedInstant(date: string, time: string, timeZone: string) {
  const target = Date.parse(`${date}T${time}:00Z`);
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = localParts(new Date(candidate), timeZone);
    const local = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    const correction = target - local;
    if (!correction) return candidate;
    candidate += correction;
  }
  throw new Error('Schedule boundary does not exist in this time zone');
}

const nextDate = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const validTime = (time: unknown): time is string => typeof time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(time);

export function calculateSalaryTiming(input: {
  location: string; date: string; now: Date; fullDaySalary: number;
  hourlyLabor: number; netSales: number; salaryConfigured: boolean;
  schedule?: OperatingSchedule;
}): SalaryTimingRow {
  const { location, date, now, fullDaySalary, hourlyLabor, netSales, salaryConfigured, schedule } = input;
  const base: SalaryTimingRow = {
    location, status: salaryConfigured ? 'missing_hours' : 'missing_salary',
    timeZone: null, open: null, close: null, operatingHours: null, elapsedHours: null,
    allocatedPct: null, hourlyAllocation: null, fullDaySalary,
    accruedSalary: null, remainingSalary: null, hourlyLabor, totalAccruedLabor: null,
    salaryPct: null, hourlyPct: costPct(hourlyLabor, netSales), totalPct: null,
    fullDaySalaryPct: salaryConfigured ? costPct(fullDaySalary, netSales) : null,
  };
  if (!salaryConfigured || !schedule) return base;
  try {
    if (!schedule.timeZone) return base;
    localParts(now, schedule.timeZone); // Validate the configured IANA time zone.
    const weekday = String(new Date(`${date}T12:00:00Z`).getUTCDay());
    const day = Object.prototype.hasOwnProperty.call(schedule.dates ?? {}, date)
      ? schedule.dates![date] : schedule.week?.[weekday];
    // A closed day still carries its fixed payroll commitment; it cannot be
    // divided by zero operating hours or presented as zero payroll expense.
    const source = { hoursSource: schedule.source, hoursVerifiedAt: schedule.verifiedAt, hoursSourceUrl: schedule.sourceUrl };
    if (day === null) return { ...base, ...source, status: 'closed', timeZone: schedule.timeZone };
    if (!day) return base;
    const windows = Array.isArray(day) ? day : [day];
    if (!windows.length) return base;
    const intervals = windows.map(window => {
      if (!validTime(window.open) || !validTime(window.close)) throw new Error('Invalid schedule');
      const offset = window.closeDayOffset ?? (window.close < window.open ? 1 : 0);
      if (offset !== 0 && offset !== 1) throw new Error('Invalid close day');
      const opens = zonedInstant(date, window.open, schedule.timeZone);
      const closes = zonedInstant(offset ? nextDate(date) : date, window.close, schedule.timeZone);
      if (closes <= opens) throw new Error('Invalid interval');
      return { opens, closes, window };
    }).sort((a, b) => a.opens - b.opens);
    if (intervals.some((period, i) => i > 0 && period.opens < intervals[i - 1].closes)) return base;
    const duration = intervals.reduce((sum, period) => sum + period.closes - period.opens, 0);
    if (duration <= 0) return base;
    const elapsed = intervals.reduce((sum, period) => sum + Math.min(period.closes - period.opens, Math.max(0, now.getTime() - period.opens)), 0);
    const fraction = elapsed / duration;
    const accruedSalary = roundMoney(fullDaySalary * fraction);
    const totalAccruedLabor = roundMoney(hourlyLabor + accruedSalary);
    return {
      ...base, ...source, status: elapsed === duration ? 'complete' : elapsed === 0 ? 'before_open' : 'open',
      timeZone: schedule.timeZone, open: intervals[0].window.open, close: intervals[intervals.length - 1].window.close,
      operatingHours: duration / 3_600_000, elapsedHours: elapsed / 3_600_000,
      allocatedPct: roundMoney(fraction * 100), hourlyAllocation: roundMoney(fullDaySalary / (duration / 3_600_000)),
      accruedSalary, remainingSalary: roundMoney(fullDaySalary - accruedSalary), totalAccruedLabor,
      salaryPct: costPct(accruedSalary, netSales), totalPct: costPct(totalAccruedLabor, netSales),
    };
  } catch { return base; }
}
