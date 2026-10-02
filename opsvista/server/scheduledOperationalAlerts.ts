import { alertClock, alertJobDue, alertJobs, alertLocations, canonicalAlertLocation, operationalWeekStart, overdueExpense, performanceWarnings, shiftDay, type AlertJob, type OperationalAlert } from '../shared/operationalAlerts.js';
import { closedBonusWeek, beverageBonusRange } from '../shared/bonusWeek.js';
import { calculateWeeklyBonus } from '../src/bonusEngine.js';
import { listManagedUsers, type ManagedDirectoryUser } from './managementStore.js';
import { alertOrganization, claimAlertJob, finishAlertJob, saveAndDeliverAlert } from './operationalAlertStore.js';
import { authorizedSourceSync } from './sourceSyncAuth.js';

const corporate = new Set(['usr-founder-roberto', 'usr-roberto-ops', 'usr-jacob']);
export function alertUserLocations(user: ManagedDirectoryUser, now = new Date()) {
  return user.locationGrants?.length
    ? user.locationGrants.filter(grant => !grant.expiresAt || Date.parse(grant.expiresAt) > now.getTime()).map(grant => grant.location)
    : user.locations || [];
}
export function scheduledRecipients(alert: OperationalAlert, directory: ManagedDirectoryUser[], now = new Date()) {
  return directory.filter(user => user.active && (corporate.has(user.id)
    || (user.role === 'Location Manager' && alertUserLocations(user, now).some(location => canonicalAlertLocation(location) === alert.location))
    || (alert.kind === 'reviews' && user.role === 'Online Reputation Manager')
    || (['ramp', 'prices'].includes(alert.kind) && user.role === 'Administration')
    || (alert.kind === 'overtime' && user.role === 'HR'))).map(user => user.id);
}
function dailyTargets(): Record<string, number> {
  try { return JSON.parse(process.env.OPSVISTA_DAILY_SALES_TARGETS_JSON || '{}'); } catch { return {}; }
}
type Detection = { alerts: OperationalAlert[]; note?: string; waiting?: boolean };
export async function detectOperationalAlerts(job: AlertJob, location?: string, now = new Date()): Promise<Detection> {
  const { day, hour } = alertClock(now);
  const scope = location ? [location] : [...alertLocations];
  const alerts: OperationalAlert[] = [];
  const add = (loc: string, title: string, body: string, module: string, key = day, priority: OperationalAlert['priority'] = 'normal') => {
    const canonical = canonicalAlertLocation(loc);
    if (canonical || loc === 'Corporate Office') alerts.push({ key: `${job}:${key}:${canonical || loc}`, kind: job, location: canonical || loc, title, body, module, priority });
  };
  if (job === 'performance') {
    const [{ getToastPerformance }, { allocateSalaryLabor }, { intradaySalary }, { getGoogleOperatingSchedules }] = await Promise.all([
      import('./toastPerformance.js'), import('./salaryLabor.js'), import('./intradaySalary.js'), import('./googleBusinessProfile.js'),
    ]);
    const [rows, schedules] = await Promise.all([getToastPerformance(day, day, scope), getGoogleOperatingSchedules(scope).catch(() => ({}))]);
    if (!rows.length) throw new Error('No Toast locations');
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
    if (!result.locations.length) throw new Error('No task locations');
    for (const row of result.locations) if (row.total > 0 && row.incomplete > 0) add(row.locationName, `${row.locationName} · Tasks pendientes`, `${day} · ${row.incomplete} de ${row.total} tareas siguen pendientes a las ${hour}:00 Connecticut. Confirma responsables y completa las tareas del turno antes del cierre.`, 'Evidence Audit');
  }
  if (job === 'logbook') {
    const { listSevenShiftsLogbook, listSevenShiftsLocations } = await import('./sevenShiftsClient.js');
    const previous = shiftDay(day, -1);
    const [entries, mapped] = await Promise.all([listSevenShiftsLogbook(previous, previous, scope), listSevenShiftsLocations()]);
    for (const loc of scope) if (mapped.some(l => canonicalAlertLocation(l.name) === loc) && !entries.some(entry => canonicalAlertLocation(entry.locationName) === loc && (entry.message.trim() || entry.attachments))) add(loc, `${loc} · Falta logbook`, `No se encontró un logbook del ${previous} en 7shifts. Revisa y completa el resumen del turno anterior.`, '7shifts Tasks');
  }
  if (job === 'reviews') {
    const { getGoogleReviewSummaries } = await import('./googleBusinessProfile.js');
    const result = await getGoogleReviewSummaries(shiftDay(day, -29), day, scope);
    if (result.locations.every(row => row.mappingError)) throw new Error('Review locations unavailable');
    for (const row of result.locations) {
      if (row.mappingError) continue;
      const low = row.reviews.filter(r => r.rating <= 2 && Date.parse(r.createTime) >= Date.parse(`${shiftDay(day, -1)}T00:00:00Z`));
      const unanswered = row.reviews.filter(r => !r.answered && now.getTime() - Date.parse(r.createTime) >= 24 * 3600000);
      if (low.length || unanswered.length) add(row.location, `${row.location} · Google Reviews`, `${low.length} review(s) reciente(s) de 1–2 estrellas; ${unanswered.length} sin respuesta después de 24 horas (últimos 30 días). Revisa cada caso y responde desde Google Business Profile.`, 'Google Reviews', day, low.length ? 'high' : 'normal');
    }
  }
  if (job === 'ramp') {
    const { getRampCompliancePayload } = await import('./rampComplianceEndpoint.js');
    const result = await getRampCompliancePayload({ fromDate: shiftDay(day, -29), toDate: day });
    const overdue = result.transactions.filter(tx => overdueExpense(tx, now));
    for (const loc of [...alertLocations, 'Corporate Office']) {
      const rows = overdue.filter(tx => (canonicalAlertLocation(tx.verifiedRestaurant || tx.restaurant || '') || 'Corporate Office') === loc);
      if (rows.length) add(loc, `${loc} · Documentación Ramp`, `${rows.length} gasto(s) liquidado(s) de más de 48 horas requieren documentación: ${rows.filter(tx => !tx.receiptAttached).length} sin recibo y ${rows.filter(tx => !tx.memo?.trim()).length} sin memo. Rango revisado: últimos 30 días.`, 'Ramp Compliance');
    }
  }
  if (job === 'prices') {
    const { getPriceWatch } = await import('./priceWatch.js');
    const result = await getPriceWatch(alertOrganization, shiftDay(day, -27), day);
    if (now.getTime() - Date.parse(result.fetchedAt) > 3600000) throw new Error('Price source stale');
    for (const loc of alertLocations) {
      const rows = result.alerts.filter(row => row.status !== 'VERIFY' && (row.changePct || 0) >= 5 && canonicalAlertLocation(row.current.location) === loc && row.current.date >= shiftDay(day, -2));
      if (rows.length) add(loc, `${loc} · Price Watch`, `${rows.length} producto(s) con aumento ≥5% en invoices recientes; ${rows.filter(r => r.status === 'HIGH').length} HIGH (≥10%) y ${rows.filter(r => r.status === 'CRITICAL').length} CRITICAL (≥20%). ${rows.slice(0, 3).map(r => `${r.itemName}: +${r.changePct?.toFixed(1)}%`).join('; ')}. Comparaciones según producto y unidad normalizada; revisa invoices en Price Watch.`, 'Price Watch', day, rows.some(r => r.status === 'CRITICAL') ? 'high' : 'normal');
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

export async function runScheduledAlertJob(job: AlertJob, location?: string, now = new Date(), verifyOnly = false) {
  const { day } = alertClock(now);
  // Every send window starts after 09:00 ET; 06:00Z is before that in both
  // standard and daylight time and after the preceding day's final check.
  const daily = ['overtime','logbook','ramp','prices','bonus'].includes(job);
  const key = `${verifyOnly ? 'verify:' : ''}${job}${location ? `:${location}` : ''}`, token = await claimAlertJob(key, now, daily || verifyOnly ? `${day}T06:00:00Z` : undefined, verifyOnly ? 1 : 20);
  if (!token) return { ok: true, busy: true, alerts: 0, accepted: 0 };
  if (!verifyOnly && !alertJobDue(job, now)) {
    await finishAlertJob(key, token, 'quiet', 'Outside this rule’s Connecticut notification window.', now);
    return { ok: true, quiet: true, alerts: 0, accepted: 0 };
  }
  try {
    const result = await detectOperationalAlerts(job, location, now);
    if (verifyOnly) {
      await finishAlertJob(key, token, result.waiting ? 'waiting' : 'ok', result.note || 'Source verified without sending notifications.', now);
      return { ok: true, verified: true, alerts: result.alerts.length, accepted: 0 };
    }
    const directory = await listManagedUsers(alertOrganization);
    let accepted = 0, retryPending = false;
    for (const alert of result.alerts) {
      const delivery = await saveAndDeliverAlert(alert, scheduledRecipients(alert, directory, now));
      accepted += delivery.accepted; retryPending ||= delivery.retryPending;
    }
    await finishAlertJob(key, token, retryPending ? 'retrying' : result.waiting ? 'waiting' : 'ok', retryPending ? 'Push service unavailable; pending recipients will retry.' : result.note || 'Source checked successfully.', now);
    return { ok: true, alerts: result.alerts.length, accepted };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const reason = /not configured|credentials|no est[aá] conectado/i.test(message) ? 'connection_required' : /429|limit/i.test(message) ? 'source_limit' : /timeout|abort|timed out/i.test(message) ? 'source_timeout' : /403|permission|forbidden/i.test(message) ? 'source_permissions' : 'source_unavailable';
    await finishAlertJob(key, token, 'unavailable', reason, now);
    return { ok: false, reason, alerts: 0, accepted: 0 };
  }
}

type Request = { method?: string; headers?: Record<string, string | string[] | undefined>; query?: Record<string, string | string[]> };
type Response = { status: (code: number) => Response; json: (body: unknown) => void; setHeader?: (name: string, value: string) => void };
export async function scheduledAlertsEndpoint(req: Request, res: Response) {
  res.setHeader?.('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!await authorizedSourceSync(req.headers?.authorization, 'alerts')) return res.status(401).json({ error: 'Unauthorized' });
  const job = req.query?.job, location = req.query?.location;
  if (typeof job !== 'string' || !alertJobs.includes(job as AlertJob) || (location !== undefined && (typeof location !== 'string' || !alertLocations.includes(location as typeof alertLocations[number])))) return res.status(400).json({ error: 'Invalid alert job' });
  if (job !== 'bonus' && ['performance', 'overtime', 'tasks'].includes(job) !== Boolean(location)) return res.status(400).json({ error: 'Invalid alert scope' });
  // The existing authenticated half-hour heartbeat also drains preferences
  // digests, even when an operational source is unavailable or in quiet hours.
  if (job === 'reviews' && req.query?.verify !== '1') {
    const { flushPushDigests } = await import('./pushDigestDelivery.js');
    await flushPushDigests();
  }
  const result = await runScheduledAlertJob(job as AlertJob, location as string | undefined, new Date(), req.query?.verify === '1');
  return res.status(result.ok ? 200 : 503).json(result);
}
