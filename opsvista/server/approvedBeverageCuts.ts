import { addDays } from '../shared/beverageMetrics.js';
import type { BeverageScoreResponse } from '../shared/beverageScore.js';
import { getLatestIntegrationSnapshot, saveIntegrationSnapshot } from './integrationStore.js';
import { approvedBeverageSeeds } from './approvedBeverageSeeds.js';

export type ApprovedBeverageCut = {
  organizationId: string; weekStart: string; reportStart: string; reportEnd: string;
  rows: { location: string; salesCents: number; purchasesCents: number }[];
};
const cohort = ['Avon', 'Danbury', 'Fairfield', 'Orange', 'Southington', 'Stamford'];

export function approvedCutScore(cut: ApprovedBeverageCut, organizationId: string, start: string, end: string): BeverageScoreResponse | undefined {
  if (cut.organizationId !== organizationId || start !== addDays(end, -55)) return undefined;
  if (cut.reportStart > cut.reportEnd || cut.rows.length !== 6 || [...cut.rows.map(r => r.location)].sort().join('|') !== cohort.join('|')) throw new Error('Corte aprobado inválido');
  if (cut.rows.some(r => !Number.isSafeInteger(r.salesCents) || r.salesCents <= 0 || !Number.isSafeInteger(r.purchasesCents) || r.purchasesCents < 0)) throw new Error('Importes aprobados inválidos');
  const ranked = [...cut.rows].sort((a, b) => a.purchasesCents / a.salesCents - b.purchasesCents / b.salesCents || a.location.localeCompare(b.location));
  return { start, end, readyCount: 6, expectedCount: 6, provisional: false,
    reportingPeriod: { start: cut.reportStart, end: cut.reportEnd, label: 'Bebidas · último corte aprobado (independiente de la semana)', approvedForBonus: true,
      source: 'Compras Provi y ventas netas Toast del mismo período. Incluye Liquor, Drinks, Beer Bottled, Beer Draft y Wine. Sustituye el comparativo de bebidas; no suma reportes anteriores ni facturas. No representa costo consumido ni utilidad.' },
    rows: ranked.map((row, index) => {
      const rank = ranked.findIndex(other => other.purchasesCents * row.salesCents === row.purchasesCents * other.salesCents) + 1;
      return { location: row.location, sales: row.salesCents / 100, purchases: row.purchasesCents / 100, pending: 0,
        purchasePct: Math.round(row.purchasesCents / row.salesCents * 10000) / 100,
        rank: rank || index + 1, points: Math.max(0, 6 - rank), comparable: true,
        issues: [`Corte aprobado ${cut.reportStart}–${cut.reportEnd}. Compras contadas una sola vez; ventas de bebidas del mismo período.`] };
    }) };
}

// The repository holds no operator financial seeds. An authenticated deployment
// can include a private seed; the first authorized score read persists it, so
// subsequent ordinary Git deployments continue to read the same approved cut.
export async function getApprovedBeverageCut(organizationId: string, start: string, end: string): Promise<BeverageScoreResponse | undefined> {
  // An operator can lock a private cut to one bonus week through deployment
  // configuration. Keep its report dates and avoid changing other bonus weeks.
  const weekStart = addDays(end, -6);
  const weeklyRecord = process.env['OPSVISTA_BEVERAGE_BONUS_' + weekStart.replace(/-/g, '')];
  if (weeklyRecord && start === addDays(end, -55)) {
    const cut = JSON.parse(weeklyRecord) as ApprovedBeverageCut;
    if (cut.organizationId === organizationId) {
      if (cut.weekStart !== weekStart) throw new Error('Semana del corte aprobado inválida');
      const score = approvedCutScore(cut, organizationId, start, end);
      if (score?.reportingPeriod) score.reportingPeriod.label = `Bebidas · corte aprobado para el bono ${weekStart}–${end}`;
      return score;
    }
  }
  const stored = await getLatestIntegrationSnapshot<ApprovedBeverageCut>(organizationId, 'bonus-beverage-approved');
  const seed = approvedBeverageSeeds.filter(cut => cut.organizationId === organizationId)
    .sort((a, b) => b.reportEnd.localeCompare(a.reportEnd))[0];
  if (stored && (!seed || stored.payload.reportEnd >= seed.reportEnd)) return approvedCutScore(stored.payload, organizationId, start, end);
  if (!seed) return undefined;
  const score = approvedCutScore(seed, organizationId, start, end);
  if (!score) return undefined;
  if (!process.env.OPSVISTA_DATABASE_URL && !process.env.OPSVISTA_DATABASE_DATABASE_URL) throw new Error('No se pudo guardar el corte aprobado de bebidas');
  await saveIntegrationSnapshot(organizationId, 'bonus-beverage-approved', seed.weekStart, seed);
  return score;
}
