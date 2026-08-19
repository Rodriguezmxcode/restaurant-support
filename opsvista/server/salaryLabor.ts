type SalaryHistory = Record<string, Array<{ effectiveFrom: string; weeklyAmount: number }>>;

const DAY_MS = 86_400_000;

/**
 * Weekly salaried payroll confirmed from Payroll Summary Reports.
 * Add a dated entry when payroll changes so historical reporting remains accurate.
 */
const SALARY_PAYROLL_HISTORY: SalaryHistory = {
  Avon: [{ effectiveFrom: '2026-01-01', weeklyAmount: 4668.08 }],
  Fairfield: [{ effectiveFrom: '2026-01-01', weeklyAmount: 5001.93 }],
  Danbury: [{ effectiveFrom: '2026-01-01', weeklyAmount: 3700.64 }],
  Stamford: [{ effectiveFrom: '2026-01-01', weeklyAmount: 5313.46 }],
  Orange: [{ effectiveFrom: '2026-01-01', weeklyAmount: 5538.46 }],
  Southington: [{ effectiveFrom: '2026-01-01', weeklyAmount: 2450.00 }],
};

function parseDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid salary labor date: ${value}`);
  return date;
}

function datesInRange(start: string, end: string) {
  const dates: string[] = [];
  for (let date = parseDate(start), last = parseDate(end); date <= last; date = new Date(date.getTime() + DAY_MS)) {
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function environmentOverride(): Record<string, number> {
  const raw = process.env.OPSVISTA_WEEKLY_SALARY_LABOR_JSON;
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).flatMap(([location, value]) => {
    const weekly = Number(value);
    return Number.isFinite(weekly) && weekly >= 0 ? [[location, weekly]] : [];
  }));
}

function weeklySalaryForDate(location: string, date: string, override: Record<string, number>) {
  if (override[location] !== undefined) return override[location];
  return (SALARY_PAYROLL_HISTORY[location] ?? [])
    .filter(entry => entry.effectiveFrom <= date)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]?.weeklyAmount ?? 0;
}

export function allocateSalaryLabor(start: string, end: string, locations: string[]) {
  const dates = datesInRange(start, end);
  const override = environmentOverride();
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  return {
    configured: Object.keys(SALARY_PAYROLL_HISTORY).length > 0 || Object.keys(override).length > 0,
    rows: locations.map(location => {
      const dailyCosts = dates.map(date => weeklySalaryForDate(location, date, override) / 7);
      const salaryLaborCost = dailyCosts.reduce((sum, value) => sum + value, 0);
      const weeklySalaryLaborCost = weeklySalaryForDate(location, end, override);
      return { location, weeklySalaryLaborCost: round(weeklySalaryLaborCost), salaryLaborCost: round(salaryLaborCost) };
    }),
  };
}
