export const notificationCategories = ['critical', 'sales', 'labor', 'tasks', 'purchasing', 'reviews', 'finance', 'reports', 'system', 'updates'] as const;
export type NotificationCategory = typeof notificationCategories[number];
export type PushDeliveryMode = 'instant' | 'daily' | 'weekly' | 'off';
export type NotificationPreferences = {
  emailEnabled: boolean; pushEnabled: boolean; smsEnabled: boolean; phone?: string;
  categories: Record<NotificationCategory, PushDeliveryMode>;
  locations: string[] | null; timeZone: string; locale: 'en' | 'es'; revision: number;
};
export type PushEvent = { category?: string; location?: string; actionId?: string; tag?: string; title?: string; body?: string; priority?: 'high' | 'normal' | 'low'; test?: boolean };
export const defaultCategories = (): NotificationPreferences['categories'] => ({ critical: 'instant', sales: 'instant', labor: 'instant', tasks: 'instant', purchasing: 'instant', reviews: 'instant', finance: 'instant', reports: 'instant', system: 'instant', updates: 'off' });
export const defaultNotificationPreferences = (): NotificationPreferences => ({ emailEnabled: true, pushEnabled: true, smsEnabled: false, categories: defaultCategories(), locations: null, timeZone: 'America/New_York', locale: 'en', revision: 0 });
export const locationKey = (value: string) => value.trim().toLocaleLowerCase('en-US');
export function notificationCategory(value = ''): NotificationCategory {
  const key = value.trim().toLowerCase();
  if (notificationCategories.includes(key as NotificationCategory)) return key as NotificationCategory;
  if (/labor|overtime|payroll/.test(key)) return 'labor';
  if (/price|purchas|provi|inventory/.test(key)) return 'purchasing';
  if (/review|guest|reputation/.test(key)) return 'reviews';
  if (/bonus|report|summary|digest/.test(key)) return 'reports';
  if (/finance|payment|invoice|accounts payable/.test(key)) return 'finance';
  if (/system|integration|sync/.test(key)) return 'system';
  if (/sales|venta|revenue|performance|upsell|discount|void/.test(key)) return 'sales';
  return 'tasks'; // Assignments, Ramp evidence, logbooks and maintenance follow-up.
}
export function pushDecision(preferences: NotificationPreferences, event: PushEvent, allowedLocations: string[], globalRole: boolean): PushDeliveryMode {
  if (!preferences.pushEnabled) return 'off';
  const category = notificationCategory(event.category);
  if (event.location) {
    const key = locationKey(event.location);
    if (!allowedLocations.some(location => locationKey(location) === key)) return 'off';
    if (preferences.locations !== null && !preferences.locations.some(location => locationKey(location) === key)) return 'off';
  } else if (!event.test && !['system', 'updates', 'critical'].includes(category)) {
    // An aggregate without a location can contain every restaurant. Never send
    // it to a scoped user or to someone who selected a subset of restaurants.
    if (!globalRole || preferences.locations !== null) return 'off';
  }
  return event.test ? 'instant' : preferences.categories[category];
}
export function effectivePushScope(row: Record<string, unknown>, now = Date.now()) {
  const globalRole = ['Founder', 'Corporate', 'Online Reputation Manager', 'HR', 'Administration', 'Maintenance'].includes(String(row.role));
  const catalog = row.organization_locations as string[] || [];
  const grants = row.location_grants as { location: string; expiresAt?: string }[] || [];
  const assigned = grants.length ? grants.filter(g => !g.expiresAt || Date.parse(g.expiresAt) > now).map(g => g.location) : row.locations as string[] || [];
  const allowedLocations = globalRole ? catalog : assigned.filter(location => catalog.some(item => locationKey(item) === locationKey(location)));
  return { globalRole, allowedLocations: [...new Set(allowedLocations)] };
}
export function digestDueAt(mode: 'daily' | 'weekly', timeZone: string, now = new Date()) {
  const parts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(p => [p.type, p.value]));
  const current = parts(now);
  const target = new Date(`${current.year}-${current.month}-${current.day}T09:00:00Z`);
  target.setUTCDate(target.getUTCDate() + (mode === 'weekly' ? (8 - target.getUTCDay()) % 7 || 7 : 1));
  let utc = target.getTime();
  for (let i = 0; i < 3; i++) {
    const p = parts(new Date(utc));
    const localAsUtc = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);
    utc += target.getTime() - localAsUtc;
  }
  return new Date(utc).toISOString();
}
