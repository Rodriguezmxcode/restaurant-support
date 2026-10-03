import type { SevenShiftsResponse } from './OperationalOverview';

// Toast and 7shifts retain their own display names (e.g. Orange / ORANGE).
// Match only exact normalized names in this already-authorized response.
const locationKey = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export function findOverviewTaskCompliance(tasks: SevenShiftsResponse | null, location: string) {
  const key = locationKey(location);
  if (!key) return undefined;
  return tasks?.locations.find(item => locationKey(item.location) === key);
}
