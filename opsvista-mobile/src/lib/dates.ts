export type RangeKey = 'today' | 'this-week';

function easternToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function plusDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function resolveRange(range: RangeKey) {
  const end = easternToday();
  if (range === 'today') return { start: end, end, label: 'Hoy' };
  const day = new Date(`${end}T00:00:00.000Z`).getUTCDay();
  const start = plusDays(end, -((day - 3 + 7) % 7));
  return { start, end, label: 'Semana operativa' };
}
