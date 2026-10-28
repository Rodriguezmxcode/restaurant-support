import type { OperatingSchedule, OperatingWindow } from '../shared/salaryTiming.js';

type GoogleTime = { hours?: number; minutes?: number; seconds?: number; nanos?: number };
type GoogleDate = { year?: number; month?: number; day?: number };
export type GoogleHoursLocation = {
  name: string; title?: string; storeCode?: string;
  storefrontAddress?: { locality?: string; administrativeArea?: string; regionCode?: string; addressLines?: string[] };
  regularHours?: { periods?: Array<{ openDay: string; closeDay: string; openTime: GoogleTime; closeTime: GoogleTime }> };
  specialHours?: { specialHourPeriods?: Array<{ startDate: GoogleDate; endDate?: GoogleDate; openTime?: GoogleTime; closeTime?: GoogleTime; closed?: boolean }> };
  openInfo?: { status?: string };
  metadata?: { mapsUri?: string };
};
const weekdays = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const isoDate = (date: GoogleDate) => `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;

function clock(value?: GoogleTime) {
  if (!value) throw new Error('Missing time');
  const hours = value.hours ?? 0, minutes = value.minutes ?? 0;
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 24 || minutes < 0 || minutes > 59 || (hours === 24 && minutes !== 0) || value.seconds || value.nanos) throw new Error('Invalid time');
  return { text: `${String(hours % 24).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`, extraDay: hours === 24 ? 1 : 0 };
}
function window(openTime: GoogleTime | undefined, closeTime: GoogleTime | undefined, dayOffset: number): OperatingWindow {
  const open = clock(openTime), close = clock(closeTime);
  const offset = dayOffset + close.extraDay - open.extraDay;
  if (open.extraDay || ![0, 1].includes(offset) || (offset === 0 && close.text <= open.text)) throw new Error('Unsupported interval');
  return { open: open.text, close: close.text, closeDayOffset: offset };
}

/** Read only the location's primary business hours, not delivery/access/kitchen moreHours. */
export function scheduleFromGoogle(location: GoogleHoursLocation, verifiedAt: string): OperatingSchedule | undefined {
  const address = location.storefrontAddress;
  // This integration is scoped to the Connecticut restaurants. Do not assign
  // Eastern time to an unrelated location solely because the name matches.
  if (!['CT', 'Connecticut'].includes(address?.administrativeArea ?? '') || (address?.regionCode && address.regionCode !== 'US')) return undefined;
  const schedule: OperatingSchedule = { timeZone: 'America/New_York', week: {}, dates: {}, source: 'Google Business Profile API', verifiedAt, sourceUrl: location.metadata?.mapsUri };
  if (location.openInfo?.status && location.openInfo.status !== 'OPEN') {
    schedule.week = Object.fromEntries(weekdays.map((_, day) => [String(day), null]));
    return schedule;
  }
  const periods = location.regularHours?.periods;
  if (!periods?.length) return undefined;
  schedule.week = Object.fromEntries(weekdays.map((_, day) => [String(day), null]));
  for (const period of periods) {
    const openDay = weekdays.indexOf(period.openDay), closeDay = weekdays.indexOf(period.closeDay);
    if (openDay < 0 || closeDay < 0) return undefined;
    try {
      const interval = window(period.openTime, period.closeTime, (closeDay - openDay + 7) % 7);
      const existing = schedule.week[String(openDay)];
      schedule.week[String(openDay)] = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), interval];
    } catch { return undefined; }
  }
  const special = new Map<string, NonNullable<GoogleHoursLocation['specialHours']>['specialHourPeriods']>();
  for (const period of location.specialHours?.specialHourPeriods ?? []) {
    const date = isoDate(period.startDate);
    special.set(date, [...(special.get(date) ?? []), period]);
  }
  for (const [date, exceptions] of special) {
    if (exceptions?.some(period => period.closed)) { schedule.dates![date] = null; continue; }
    try {
      schedule.dates![date] = (exceptions ?? []).map(period => {
        const endDate = period.endDate ? isoDate(period.endDate) : date;
        const offset = (Date.parse(`${endDate}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86_400_000;
        return window(period.openTime, period.closeTime, offset);
      });
    } catch { schedule.dates![date] = []; } // Invalid exceptions cannot fall back to regular hours.
  }
  return schedule;
}
