type SalaryConfig = Record<string, number>;

const DAY_MS = 86_400_000;

function parseDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid salary labor date: ${value}`);
  return date;
}

function inclusiveDays(start: string, end: string) {
  return Math.floor((parseDate(end).getTime() - parseDate(start).getTime()) / DAY_MS) + 1;
}

function salaryConfig(): SalaryConfig {
  const raw = process.env.OPSVISTA_WEEKLY_SALARY_LABOR_JSON;
  if (!raw) return {};
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(parsed).flatMap(([location, value]) => {
    const weekly = Number(value);
    return Number.isFinite(weekly) && weekly >= 0 ? [[location, weekly]] : [];
  }));
}

export function allocateSalaryLabor(start: string, end: string, locations: string[]) {
  const config = salaryConfig();
  const factor = inclusiveDays(start, end) / 7;
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  return {
    configured: Object.keys(config).length > 0,
    rows: locations.map(location => ({
      location,
      weeklySalaryLaborCost: round(config[location] ?? 0),
      salaryLaborCost: round((config[location] ?? 0) * factor),
    })),
  };
}
