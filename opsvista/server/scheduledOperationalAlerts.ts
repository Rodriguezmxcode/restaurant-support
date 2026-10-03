import { alertClock, alertJobDue, alertJobs, alertLocations, canonicalAlertLocation, operationalWeekStart, overdueExpense, performanceWarnings, shiftDay, type AlertJob, type OperationalAlert } from '../shared/operationalAlerts.js';
import { closedBonusWeek, beverageBonusRange } from '../shared/bonusWeek.js';
import { calculateWeeklyBonus } from '../src/bonusEngine.js';
import { listManagedUsers, type ManagedDirectoryUser } from './managementStore.js';
import { alertOrganization, claimAlertJob, finishAlertJob, saveAndDeliverAlert } from './operationalAlertStore.js';
import { defaultAlertPolicy } from '../shared/connectionHealth.js';
import type { AlertOrganization } from './organizationAlerts.js';
import { authorizedSourceSync } from './sourceSyncAuth.js';

const defaultOrganization: AlertOrganization = { id: alertOrganization, name: 'Puerto Vallarta', locations: [...alertLocations], policy: defaultAlertPolicy() };
const legacyCorporateRecipients = new Set(['usr-founder-roberto', 'usr-roberto-ops', 'usr-jacob']);
const locationKey = (value: string) => value.trim().toLocaleLowerCase('en-US');
export function alertUserLocations(user: ManagedDirectoryUser, now = new Date()) {
  return user.locationGrants?.length
    ? user.locationGrants.filter(grant => !grant.expiresAt || Date.parse(grant.expiresAt) > now.getTime()).map(grant => grant.location)
    : user.locations || [];
}
export function scheduledRecipients(alert: OperationalAlert, directory: ManagedDirectoryUser[], now = new Date(), organizationId = alertOrganization) {
  return directory.filter(user => user.active && (!user.organizationId ? organizationId === alertOrganization : user.organizationId === organizationId) && ((organizationId === alertOrganization ? legacyCorporateRecipients.has(user.id) : ['Founder', 'Corporate'].includes(user.role))
    || (user.role === 'Location Manager' && alertUserLocations(user, now).some(location => locationKey(location) === locationKey(alert.location)))
    || (alert.kind === 'reviews' && user.role === 'Online Reputation Manager')
    || (['ramp', 'prices'].includes(alert.kind) && user.role === 'Administration')
    || (alert.kind === 'overtime' && user.role === 'HR'))).map(user => user.id);
}
function dailyTargets(): Record<string, number> {
  try { return JSON.parse(process.env.OPSVISTA_DAILY_SALES_TARGETS_JSON || '{}'); } catch { return {}; }
}
type Detection = { alerts: OperationalAlert[]; note?: string; waiting?: boolean };
export async function detectOperationalAlerts(job: AlertJob, location?: string, now = new Date(), organization: AlertOrganization = defaultOrganization): Promise<Detection> {
  if (organization.id !== alertOrganization && !['reviews', 'prices'].includes(job)) throw new Error('Connection not configured for this organization');
  const { day, hour } = alertClock(now, organization.policy.timeZone);
  const scope = location ? organization.locations.filter(loc => locationKey(loc) === locationKey(location)) : [...organization.locations];
  if (!scope.length) throw new Error('No authorized source locations');
  const canonical = (value: string) => organization.locations.find(loc => locationKey(loc) === locationKey(value));
  const alerts: OperationalAlert[] = [];
  const add = (loc: string, title: string, body: string, module: string, key = day, priority: OperationalAlert['priority'] = 'normal') => {
    const mapped = canonical(loc);
    if (mapped || (organization.id === alertOrganization && loc === 'Corporate Office')) alerts.push({ key: `${job}:${key}:${mapped || loc}`, kind: job, location: mapped || loc, title, body, module, priority });
  };
  if (job === 'performance') {
    const [{ getToastPerformance }, { allocateSalaryLabor }, { intradaySalary }, { getGoogleOperatingSchedules }] = await Promise.all([
      import('./toastPerformance.js'), import('./salaryLabor.js'), import('./intradaySalary.js'), import('./googleBusinessProfile.js'),
    ]);
    const [rows, schedules] = await Promise.all([getToastPerformance(day, day, scope), getGoogleOperatingSchedules(scope).catch(() => ({}))]);
    if (scope.some(loc => !rows.some(row => canonicalAlertLocation(row.location) === loc))) throw new Error('Toast location mapping unavailable');
    const salary = allocateSalaryLabor(day, day, scope);
    const timing = intradaySalary(day, rows.map(row => ({ ...row, salaryLaborCost: salary.rows.find(s => s.location === row.location)?.salaryLaborCost || 0, salaryConfigured: salary.rows.find(s => s.location === row.location)?.salaryConfigured || false })), now, schedules);
    const targets = dailyTargets();
    for (const row of rows) {
      const completeCosts = row.employeeLabor.every(employee => employee.employmentType !== 'unknown' && (employee.employmentType === 'salary' || (employee.hourlyWage !== null && employee.overtimeCostComplete)));
      const total = completeCosts ? timing.rows.find(t => t.location === row.location)?.totalPct ?? null : null;
      const warnings = performanceWarnings(row, hour, total, Number(targets[row.location]));
      // Separate threshold keys allow a later void/sales warning after an earlier
      // labor warning, while each individual threshold is limited to once/day.
      for (const warning of warnings) { add(row.location, `${row.location} · Atención operativa`, `${day} · ${warning} Revisa el detalle antes de ajustar la operación.`, 'Labor Intelligence', `${day}:${warning.split(' ')[0]}`);
        if (alerts.length) alerts[alerts.length - 1].category = warning.startsWith('Labor ') ? 'labor' : 'sales';
      }
    }
    return { alerts, note: `${Object.keys(targets).length ? 'Sales targets configured.' : 'Sales pace waiting for configured daily targets.'} ${timing.applied ? '' : 'Total labor waits for verified operating hours and salary.'}`.trim() };
  }
  if (job === 'overtime') {
    const [{ getToastEmployeeLabor }, { applyToastLaborToScheduleRisk, toastOnlyScheduleRisk }] = await Promise.all([import('./toastPerformance.js'), import('./sevenShiftsClient.js')]);
    const start = operationalWeekStart(day), rows = await getToastEmployeeLabor(start, day, scope);
    const risk = applyToastLaborToScheduleRisk(toastOnlyScheduleRisk(start, shiftDay(start, 6), scope, day, now), rows);
    for (const loc of risk.locations) {
      const hourly = risk.employees.filter(e => e.employmentType === 'hourly' && e.locations.includes(loc.location));
      const hours = hourly.reduce((sum, e) => sum + e.workedHours, 0);
      const near = hourly.filter(e => e.workedHours >= 36 && e.workedHours < 40 && e.actualOvertimeHours === 0).length;
      const pct = hours > 0 ? loc.actualOvertimeHours / hours * 100 : 0;
      if (near || pct > 8) add(loc.location, `${loc.location} · Overtime`, `${start} → ${day}. ${near ? `${near} empleado(s) por hora entre 36 y 40 horas trabajadas. ` : ''}${pct > 8 ? `OT registrado: ${pct.toFixed(1)}% de horas por hora (>8%). ` : ''}Revisa cobertura en Labor Intelligence. Salary y personal sin clasificar no se consideran OT confirmado.`, 'Labor Intelligence');
    }
  }
  if (job === 'tasks') {
    const { weeklyTaskCompliance } = await import('./sevenShiftsClient.js');
    const result = await weeklyTaskCompliance(day, day, scope, false);
    if (scope.some(loc => !result.locations.some(row => canonicalAlertLocation(row.locationName) === loc))) throw new Error('Task location mapping unavailable');
    for (const row of result.locations) if (row.total > 0 && row.incomplete > 0) add(row.locationName, `${row.locationName} · Tasks pendientes`, `${day} · ${row.incomplete} de ${row.total} tareas siguen pendientes a las ${hour}:00 Connecticut. Confirma responsables y completa las tareas del turno antes del cierre.`, 'Evidence Audit');
  }
  if (job === 'logbook') {
    const { listSevenShiftsLogbook, listSevenShiftsLocations } = await import('./sevenShiftsClient.js');
    const previous = shiftDay(day, -1);
    const [entries, mapped] = await Promise.all([listSevenShiftsLogbook(previous, previous, scope), listSevenShiftsLocations()]);
    if (scope.some(loc => !mapped.some(row => canonicalAlertLocation(row.name) === loc))) throw new Error('Logbook location mapping unavailable');
    for (const loc of scope) if (mapped.some(l => canonicalAlertLocation(l.name) === loc) && !entries.some(entry => canonicalAlertLocation(entry.locationName) === loc && (entry.message.trim() || entry.attachments))) add(loc, `${loc} · Falta logbook`, `No se encontró un logbook del ${previous} en 7shifts. Revisa y completa el resumen del turno anterior.`, '7shifts Tasks');
  }
  if (job === 'reviews') {
    const { getGoogleReviewSummaries } = await import('./googleBusinessProfile.js');
    const result = await getGoogleReviewSummaries(shiftDay(day, -29), day, scope, organization.id);
    if (!result.locations.length || result.locations.some(row => row.mappingError)) throw new Error('Location mapping unavailable');
    for (const row of result.locations) {
      if (row.mappingError) continue;
      const low = row.reviews.filter(r => r.rating <= organization.policy.reviewRating && Date.parse(r.createTime) >= now.getTime() - 24 * 3600000);
      const unanswered = row.reviews.filter(r => !r.answered && now.getTime() - Date.parse(r.createTime) >= organization.policy.reviewHours * 3600000);
      if (low.length || unanswered.length) add(row.location, `${row.location} · Google Reviews`, `${low.length} review(s) reciente(s) de hasta ${organization.policy.reviewRating} estrellas; ${unanswered.length} sin respuesta después de ${organization.policy.reviewHours} horas (últimos 30 días). Revisa cada caso y responde desde Google Business Profile.`, 'Google Reviews', day, low.length ? 'high' : 'normal');
    }
  }
  if (job === 'ramp') {
    const { getRampCompliancePayload } = await import('./rampComplianceEndpoint.js');
    const result = await getRampCompliancePayload({ fromDate: shiftDay(day, -29), toDate: day });
    const overdue = result.transactions.filter(tx => overdueExpense(tx, now));
    for (const loc of location ? scope : [...scope, 'Corporate Office']) {
      const rows = overdue.filter(tx => (canonicalAlertLocation(tx.verifiedRestaurant || tx.restaurant || '') || 'Corporate Office') === loc);
      if (rows.length) add(loc, `${loc} · Documentación Ramp`, `${rows.length} gasto(s) liquidado(s) de más de 48 horas requieren documentación: ${rows.filter(tx => !tx.receiptAttached).length} sin recibo y ${rows.filter(tx => !tx.memo?.trim()).length} sin memo. Rango revisado: últimos 30 días.`, 'Ramp Compliance');
    }
  }
  if (job === 'prices') {
    const { getPriceWatch } = await import('./priceWatch.js');
    const result = await getPriceWatch(organization.id, shiftDay(day, -27), day);
    if (now.getTime() - Date.parse(result.fetchedAt) > 3600000) throw new Error('Price source stale');
    for (const loc of scope) {
      const rows = result.alerts.filter(row => row.status !== 'VERIFY' && (row.changePct || 0) >= organization.policy.priceIncreasePct && canonical(row.current.location) === loc && row.current.date >= shiftDay(day, -2));
      if (rows.length) add(loc, `${loc} · Price Watch`, `${rows.length} producto(s) con aumento ≥${organization.policy.priceIncreasePct}% en invoices recientes; ${rows.filter(r => r.status === 'HIGH').length} HIGH (≥10%) y ${rows.filter(r => r.status === 'CRITICAL').length} CRITICAL (≥20%). ${rows.slice(0, 3).map(r => `${r.itemName}: +${r.changePct?.toFixed(1)}%`).join('; ')}. Comparaciones según producto y unidad normalizada; revisa invoices en Price Watch.`, 'Price Watch', day, rows.some(r => r.status === 'CRITICAL') ? 'high' : 'normal');
    }
  }
  if (job === 'bonus') {
    const week = closedBonusWeek(now), alcoholRange = beverageBonusRange(week.end);
    const [{ getToastPerformance }, { weeklyTaskCompliance, listSevenShiftsLogbook }, { getGoogleReviewSummaries }, { getBeverageScore }] = await Promise.all([import('./toastPerformance.js'), import('./sevenShiftsClient.js'), import('./googleBusinessProfile.js'), import('./beverageScore.js')]);
    const [performance, tasks, logs, reviews, beverage] = await Promise.all([
      getToastPerformance(week.start, week.end, scope), weeklyTaskCompliance(week.start, week.end, scope, false), listSevenShiftsLogbook(week.start, week.end, scope), getGoogleReviewSummaries(week.start, week.end, scope), getBeverageScore(alertOrganization, alcoholRange.start, alcoholRange.end),
    ]);
    let waiting = false;
    for (const loc of scope) {
      const p = performance.find(r => canonicalAlertLocation(r.location) === loc), t = tasks.locations.find(r => canonicalAlertLocation(r.locationName) === loc), r = reviews.locations.find(r => r.location === loc), b = beverage.rows.find(r => r.location === loc);
      if (!p || !p.netSales || t?.completionPct == null || !r || r.mappingError) { waiting = true; continue; }
      const count = new Set(logs.filter(r => canonicalAlertLocation(r.locationName) === loc).map(r => r.date)).size;
      const result = calculateWeeklyBonus({ tasksPct: t.completionPct, discountsPct: p.bonusDiscountPct, voidsPct: p.voidPct, overtimeLaborPct: p.overtimeLaborPct, reviewAverage: r.averageRating ?? undefined, reviewCount: r.reviewCount, liquorCostScorePct: b?.points == null || beverage.provisional ? undefined : b.points * 20, leadershipScorePct: Math.min(100, count / 4 * 100), logbookComplete: count >= 4 });
      const ready = result.ready && !beverage.provisional;
      waiting ||= !ready;
      add(loc, `${loc} · Bono semanal ${ready ? 'disponible' : 'preliminar'}`, `${week.start} → ${week.end}. ${result.eligible === true ? 'Cumple los indicadores operativos disponibles.' : `Indicadores por revisar: ${result.eligibilityReasons.join('; ')}.`} ${ready ? `Puntuación: ${result.score?.toFixed(1)}/100.` : 'Puntuación final pendiente de fuentes completas.'} Sujeto a revisión de gerencia; no autoriza pago ni confirma ausencia de incidencias disciplinarias.`, 'Weekly Bonus', `${week.end}:${ready ? 'ready' : 'preliminary'}:${result.eligible}`);
    }
    return { alerts, waiting, note: waiting ? 'Bonus scoring waits for complete sources.' : 'Closed Wednesday–Tuesday week checked.' };
  }
  return { alerts };
}

export async function runScheduledAlertJob(job: AlertJob, location?: string, now = new Date(), verifyOnly = false, organization: AlertOrganization = defaultOrganization) {
  const { day } = alertClock(now, organization.policy.timeZone);
  if (!organization.policy.enabled[job]) return { ok: true, paused: true, alerts: 0, accepted: 0 };
  if (organization.id !== alertOrganization && !['reviews', 'prices'].includes(job)) return { ok: false, reason: 'connection_required', alerts: 0, accepted: 0 };
  // Every send window starts after 09:00 ET; 06:00Z is before that in both
  // standard and daylight time and after the preceding day's final check.
  const daily = ['overtime','logbook','ramp','prices','bonus'].includes(job);
  const key = `${verifyOnly ? 'verify:' : ''}${job}${location ? `:${location}` : ''}`, token = await claimAlertJob(key, now, daily || verifyOnly ? localDayStart(now, organization.policy.timeZone) : undefined, verifyOnly ? 1 : 20, organization.id);
  if (!token) return { ok: true, busy: true, alerts: 0, accepted: 0 };
  if (!verifyOnly && !alertJobDue(job, now, organization.policy.timeZone)) {
    await finishAlertJob(key, token, 'quiet', 'Outside notification window.', now, organization.id);
    return { ok: true, quiet: true, alerts: 0, accepted: 0 };
  }
  try {
    const result = await detectOperationalAlerts(job, location, now, organization);
    if (verifyOnly) {
      await finishAlertJob(key, token, result.waiting ? 'waiting' : 'ok', result.note || 'Source verified without sending notifications.', now, organization.id, !result.waiting);
      return { ok: true, verified: true, alerts: result.alerts.length, accepted: 0 };
    }
    const directory = await listManagedUsers(organization.id);
    let accepted = 0, retryPending = false;
    for (const alert of result.alerts) {
      const delivery = await saveAndDeliverAlert(alert, scheduledRecipients(alert, directory, now, organization.id), organization.id);
      accepted += delivery.accepted; retryPending ||= delivery.retryPending;
    }
    await finishAlertJob(key, token, retryPending ? 'retrying' : result.waiting ? 'waiting' : 'ok', retryPending ? 'Push service unavailable; pending recipients will retry.' : result.note || 'Source checked successfully.', now, organization.id, !result.waiting);
    return { ok: true, alerts: result.alerts.length, accepted };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const reason = /mapping/i.test(message) ? 'location_mapping' : /not configured|credentials|no est[aá] conectado/i.test(message) ? 'connection_required' : /429|limit/i.test(message) ? 'source_limit' : /timeout|abort|timed out/i.test(message) ? 'source_timeout' : /403|permission|forbidden/i.test(message) ? 'source_permissions' : 'source_unavailable';
    await finishAlertJob(key, token, 'unavailable', reason, now, organization.id);
    return { ok: false, reason, alerts: 0, accepted: 0 };
  }
}

export function localDayStart(now: Date, timeZone: string) {
  const {day} = alertClock(now, timeZone);
  const target = Date.parse(`${day}T00:00:00Z`);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)).map(p=>[p.type,p.value]));
    const actual = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    guess += target - actual;
  }
  return new Date(guess).toISOString();
}

type Request = { method?: string; headers?: Record<string, string | string[] | undefined>; query?: Record<string, string | string[]> };
type Response = { status: (code: number) => Response; json: (body: unknown) => void; setHeader?: (name: string, value: string) => void };
export async function scheduledAlertsEndpoint(req: Request, res: Response) {
  res.setHeader?.('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!await authorizedSourceSync(req.headers?.authorization, 'alerts')) return res.status(401).json({ error: 'Unauthorized' });
  const { activeAlertOrganizations, alertOrganizationContext, supportedJob, connectionInventory } = await import('./organizationAlerts.js');
  const job = req.query?.job, location = req.query?.location;
  if (job === 'plan') {
    const organizations = await activeAlertOrganizations();
    const jobs: {job: AlertJob; location?: string; organizationId: string}[] = [];
    const now = new Date();
    let configurationFailures = 0;
    for (const org of organizations) {
      const token = await claimAlertJob('heartbeat', now, undefined, 1, org.id);
      if (token) await finishAlertJob('heartbeat', token, 'ok', 'Scheduler authenticated.', now, org.id);
      let connections;
      try { connections = await connectionInventory(org.id); } catch { configurationFailures++; continue; }
      const { jobProviders } = await import('../shared/connectionHealth.js');
      for (const kind of alertJobs) {
        if (!supportedJob(org.id, kind) || !org.policy.enabled[kind] || !jobProviders[kind].every(provider => connections.some(connection => connection.id === provider && connection.configured))) continue;
        if (req.query?.verify !== '1' && !alertJobDue(kind, now, org.policy.timeZone)) continue;
        for (const loc of org.locations) jobs.push({job: kind,location: loc,organizationId: org.id});
        // Corporate Ramp expenses remain in the existing organization-wide pass.
        if (kind === 'ramp' && org.id === alertOrganization) jobs.push({job: kind,organizationId: org.id});
      }
    }
    if (req.query?.verify !== '1') {
      const { flushPushDigests } = await import('./pushDigestDelivery.js');
      await flushPushDigests();
    }
    return res.status(200).json({ok:true,jobs,configurationFailures});
  }
  const id = req.query?.organizationId;
  if (id !== undefined && (typeof id !== 'string' || !id || id.length > 160)) return res.status(400).json({error:'Invalid organization'});
  const org = await alertOrganizationContext(typeof id === 'string' ? id : alertOrganization);
  if (typeof job !== 'string' || !alertJobs.includes(job as AlertJob) || (location !== undefined && (typeof location !== 'string' || !org.locations.includes(location)))) return res.status(400).json({error:'Invalid alert job'});
  if (['performance','overtime','tasks'].includes(job) && !location) return res.status(400).json({error:'Location required'});
  if (!supportedJob(org.id, job as AlertJob)) return res.status(400).json({error:'Connection setup required'});
  // Retain the existing heartbeat while the scheduler workflow is upgraded.
  if (job === 'reviews' && req.query?.verify !== '1' && !id) {
    const { flushPushDigests } = await import('./pushDigestDelivery.js');
    await flushPushDigests();
  }
  const result = await runScheduledAlertJob(job as AlertJob, location as string | undefined, new Date(), req.query?.verify === '1', org);
  return res.status(result.ok ? 200 : 503).json(result);
}
