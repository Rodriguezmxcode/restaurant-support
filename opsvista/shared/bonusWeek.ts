import { addDays } from './beverageMetrics.js';

export function easternDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function closedBonusWeek(now = new Date()) {
  const today = easternDay(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const currentStart = addDays(today, -((weekday - 3 + 7) % 7));
  return { start: addDays(currentStart, -7), end: addDays(currentStart, -1) };
}
// Catch up after an outage, but wait until Wednesday 03:30 Connecticut time
// before queuing the newly closed week. Sunday/Monday orders can arrive Tuesday.
export function scheduledBonusWeek(now = new Date()) {
  const today = easternDay(now);
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return weekday === 3 && time < '03:30' ? undefined : closedBonusWeek(now);
}
