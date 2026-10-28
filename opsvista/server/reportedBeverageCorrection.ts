import type { BeverageScoreResponse } from '../shared/beverageScore.js';

// Operator-approved replacement snapshot, not additional invoices. Source: Provi
// report SHA256 64557eaf3714c466bd880f95aadd095c162ff9d9607b8139ddfc85c05248a307
// and Toast category totals supplied by the operator for the SAME 61-day period.
// Never reuse this historical correction for another tenant or reporting cut.
export function reportedBeverageCorrection(organizationId: string, start: string, end: string): BeverageScoreResponse | undefined {
  if (organizationId !== 'org-puerto-vallarta' || start !== '2026-09-02' || end !== '2026-10-27') return undefined;
  const amounts: [string, number, number][] = [
    ['Avon', 8486485, 1063286], ['Fairfield', 13097189, 1889969],
    ['Danbury', 9422968, 1424864], ['Southington', 6900191, 1192557],
    ['Orange', 18167740, 3243542], ['Stamford', 22560485, 4432782],
  ];
  return { start, end, readyCount: 0, expectedCount: 6, provisional: true,
    reportingPeriod: { start: '2026-08-28', end: '2026-10-27', label: 'Bebidas · corte reportado de 61 días', source: 'Compras Provi y ventas Toast reportadas por el operador. Incluye Drinks/refrescos. Sustituye el comparativo; no suma facturas ni grupos de menú. Ventas al corte informado del 27 de octubre; pendiente de conciliación.' },
    rows: amounts.map(([location, sales, purchases]) => ({ location, sales: sales / 100, purchases: purchases / 100, pending: 0,
      purchasePct: Math.round(purchases / sales * 10000) / 100,
      rank: null, points: null, comparable: false,
      issues: ['Corte reportado: 28 ago–27 oct de 2026. Compras / ventas de bebidas, incluidos refrescos. Pendiente de conciliación; no representa costo consumido ni utilidad.'],
    })),
  };
}
