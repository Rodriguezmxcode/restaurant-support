import type { SessionUser } from './authSession.js';
import performanceHandler from '../api/operations/performance.js';
import { listActions } from './actionStore.js';
import { getRampCompliancePayload } from './rampComplianceEndpoint.js';
import { getProviReports } from './proviReports.js';
import { getGoogleReviewSummaries, googleBusinessProfileConfigured } from './googleBusinessProfile.js';
import { getImportedReviewSummaries, reviewImportConfigured } from './reviewImportStore.js';
import { parseCopilotQuery, type CopilotQuery } from './copilotPolicy.js';
import type { CopilotReadResult } from './copilotEngine.js';

type TaskSummary = { locations: { locationName: string; total: number; completed: number; incomplete: number; completionPct: number | null; detailAvailable?: boolean }[]; taskSource?: string };
const text = (value: unknown, max = 400) => typeof value === 'string' ? value.replace(/https?:\/\/\S+/g, '[link omitted]').replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, '[email omitted]').slice(0, max) : '';
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function selectProviReports(reports: Awaited<ReturnType<typeof getProviReports>>, query: CopilotQuery) {
  const matching = reports.filter(row => query.locations.includes(row.location) && row.start <= query.end && row.end >= query.start);
  return { reportCount: matching.length, detailsTruncated: matching.length > 18,
    reports: matching.slice(0, 18).map(row => ({
      location: row.location, start: row.start, end: row.end, savedAt: row.savedAt,
      exactRequestedPeriod: row.start === query.start && row.end === query.end,
      spend: row.spend, orders: row.orders, productCount: row.productCount, distributorCount: row.distributorCount,
      topProducts: row.topProducts.slice(0, 8).map(item => ({ name: text(item.name), distributor: text(item.distributor), quantity: text(item.quantity), spend: item.spend })),
      topProductsTruncated: row.topProducts.length > 8,
      comparison: {
        source: row.comparison.source, updatedAt: row.comparison.updatedAt, pending: row.comparison.pending,
        covered: row.comparison.covered, expected: row.comparison.expected, missingAmounts: row.comparison.missingAmounts,
        invoiceTotal: row.comparison.invoiceTotal, approved: row.comparison.approved, pendingAmount: row.comparison.pendingAmount,
        credits: row.comparison.credits, net: row.comparison.net, difference: row.comparison.difference,
      },
    })),
  };
}

export function copilotSourceReader(user: SessionUser, cookie: string | undefined, tasks: (start: string, end: string, scope: string[]) => Promise<TaskSummary>) {
  return async (input: CopilotQuery): Promise<CopilotReadResult> => {
    // Recheck at the execution boundary, even if a caller skips model validation.
    const query = parseCopilotQuery(input, user);
    const { start, end, locations } = query;
    const org = user.organizationId || 'org-puerto-vallarta';
    if (query.dataset === 'performance') {
      let code = 200, body: any;
      const res = { status(value: number) { code = value; return res; }, json(value: unknown) { body = value; }, setHeader() {} };
      await performanceHandler({ method: 'GET', headers: { cookie }, query: { start, end, locations: locations.join(','), include_tasks: 'false', salary_basis: 'elapsed' } }, res);
      if (code !== 200 || !Array.isArray(body?.locations) || body.locations.some((row: any) => !locations.includes(row.location))) throw new Error('Performance unavailable');
      const missingLocations = locations.filter(name => !body.locations.some((row: any) => row.location === name));
      const totals = { ...body.totals };
      if (!totals.netSales) for (const key of ['discountPct', 'bonusDiscountPct', 'voidPct', 'laborPct', 'hourlyLaborPct', 'salaryLaborPct', 'totalLaborPct']) totals[key] = null;
      return { label: 'Toast · labor y ventas de OpsVista', note: `${start} → ${end}. Corte de consulta; las marcaciones pueden actualizarse. ${body.notes?.salaryLabor || ''}${missingLocations.length ? ` Faltan: ${missingLocations.join(', ')}.` : ''}`,
        data: { start, end, missingLocations, totals, salaryLaborConfigured: body.salaryLaborConfigured,
          locations: body.locations.map((row: any) => ({ location: row.location, netSales: row.netSales, hourlyHours: row.hourlyHours, overtimeHours: row.overtimeHours, hourlyLaborCost: row.hourlyLaborCost, salaryLaborCost: row.salaryLaborCost, totalLaborCost: row.totalLaborCost, totalLaborPct: row.netSales ? row.totalLaborPct : null, discountAmount: row.discountAmount, bonusDiscountAmount: row.bonusDiscountAmount, voidAmount: row.voidAmount })),
          salaryTiming: body.salaryTiming, notes: body.notes,
        } };
    }
    if (query.dataset === 'ramp') {
      const result = await getRampCompliancePayload({ fromDate: start, toDate: end }, { locationScoped: true, allowedLocations: locations });
      const rows = result.transactions;
      const details = [...rows].sort((a, b) => Number(a.receiptAttached && Boolean(a.memo?.trim())) - Number(b.receiptAttached && Boolean(b.memo?.trim())) || b.amount - a.amount);
      return { label: 'Ramp · gastos y evidencia', note: 'Solo transacciones asignadas a las locaciones solicitadas; excluye sin asignación. Incluye pendientes y cargos negativos/créditos. Detalle limitado a 30; totales sobre todos los registros recuperados. La fuente consulta hasta 5,000 registros antes de filtrar.',
        data: { start, end, transactionCount: rows.length, signedAmount: money(rows.reduce((sum, row) => sum + row.amount, 0)),
          missingReceipts: rows.filter(row => !row.receiptAttached).length, missingMemos: rows.filter(row => !row.memo?.trim()).length,
          pendingAmount: money(rows.filter(row => row.state === 'PENDING').reduce((sum, row) => sum + row.amount, 0)),
          detailsTruncated: rows.length > 30,
          transactions: details.slice(0, 30).map(row => ({ date: row.date, merchant: text(row.merchant), amount: row.amount, location: text(row.verifiedRestaurant || row.restaurant), cardholder: text(row.cardholder), state: row.state, receiptAttached: row.receiptAttached, memoPresent: Boolean(row.memo?.trim()) })),
        } };
    }
    if (query.dataset === 'tasks') {
      const result = await tasks(start, end, locations);
      const rows = result.locations.filter(row => locations.includes(row.locationName));
      const missingLocations = locations.filter(name => !rows.some(row => row.locationName === name));
      const total = rows.reduce((sum, row) => sum + row.total, 0), completed = rows.reduce((sum, row) => sum + row.completed, 0);
      return { label: '7shifts · tareas', note: `Resumen de cumplimiento; no contiene los nombres de todas las tareas pendientes. Fuente: ${text(result.taskSource || 'daily-summary')}.${missingLocations.length ? ` Faltan: ${missingLocations.join(', ')}.` : ''}`,
        data: { start, end, missingLocations, total, completed, incomplete: total - completed, completionPct: total ? money(completed / total * 100) : null,
          locations: rows.map(row => ({ location: row.locationName, total: row.total, completed: row.completed, incomplete: row.incomplete, completionPct: row.completionPct })),
        } };
    }
    if (query.dataset === 'actions') {
      const rows = (await listActions(user)).filter(row => locations.includes(row.location));
      return { label: 'OpsVista · Action Center', note: 'Estado actual; las fechas solicitadas no filtran acciones. Hasta 1,000 registros de origen; no es un histórico completo. Detalle de las primeras 25 por prioridad.',
        data: { snapshot: 'current', retrievedCount: rows.length,
          counts: Object.fromEntries(['Open', 'Assigned', 'Investigating', 'Completed', 'Dismissed'].map(status => [status, rows.filter(row => row.status === status).length])),
          detailsTruncated: rows.length > 25,
          actions: rows.slice(0, 25).map(row => ({ location: row.location, title: text(row.title), status: row.status, severity: row.severity, owner: text(row.ownerName), dueAt: row.dueAt, updatedAt: row.updatedAt })),
        } };
    }
    if (query.dataset === 'provi') return { label: 'Provi · reportes guardados y conciliación R365', note: 'Reportes importados que coinciden o se cruzan con el período pedido. Cada monto pertenece al período completo de su reporte: no sumar períodos superpuestos ni atribuirlos a un día o período menor. No incluye archivos de evidencia que aún no forman parte de un reporte.', data: selectProviReports(await getProviReports(org), query) };
    let result: any;
    let fallback = false;
    if (await googleBusinessProfileConfigured(org)) {
      try { result = await getGoogleReviewSummaries(start, end, locations, org); } catch { /* Use the existing verified import fallback. */ }
    }
    if (!result && reviewImportConfigured()) {
      const imported = await getImportedReviewSummaries(start, end, locations);
      if (imported.hasData) { result = imported; fallback = true; }
    }
    if (!result?.locations) throw new Error('Reviews unavailable');
    const rows = result.locations.filter((row: any) => locations.includes(row.location));
    return { label: fallback ? 'Vista Social · reseñas importadas' : 'Google Business Profile · reseñas', note: fallback ? 'Google no disponible; se consultó el reporte importado, no reseñas en vivo.' : 'Reseñas del período consultadas en Google Business Profile.',
      data: { start, end, fallback, lastUpdated: result.lastUpdated || null, coverageWarning: fallback ? 'El reporte importado no prueba cobertura completa de cada día/locación; sin reseñas reportadas no significa cero reseñas reales.' : null, missingLocations: locations.filter(name => !rows.some((row: any) => row.location === name && !row.mappingError)),
        locations: rows.map((row: any) => ({ location: row.location, reviewCount: row.mappingError || (fallback && !row.reviewCount) ? null : row.reviewCount, averageRating: row.averageRating, lowRatingCount: row.mappingError || (fallback && !row.reviewCount) ? null : row.lowRatingCount, unansweredCount: row.mappingError ? null : row.unansweredCount, mappingUnavailable: Boolean(row.mappingError),
          reviewsTruncated: (row.reviews?.length || 0) > 3,
          reviews: (row.reviews || []).slice(0, 3).map((review: any) => ({ rating: review.rating, comment: text(review.comment, 600), date: review.createTime, answered: review.answered })),
        })),
      } };
  };
}
