import type { BeverageScoreResponse } from '../shared/beverageScore.js';

// Operator-approved replacement snapshot, not additional invoices. Source: Provi
// report SHA256 64557eaf3714c466bd880f95aadd095c162ff9d9607b8139ddfc85c05248a307
// and Toast category totals supplied by the operator for the SAME 61-day period.
// Never reuse this historical correction for another tenant or reporting cut.
export function reportedBeverageCorrection(organizationId: string, start: string, end: string): BeverageScoreResponse | undefined {
  if (organizationId === 'org-puerto-vallarta' && start === '2026-09-09' && end === '2026-11-03') return novemberApprovedCut(start, end);
  if (organizationId !== 'org-puerto-vallarta' || start !== '2026-09-02' || end !== '2026-10-27') return undefined;
  const amounts: [string, number, number][] = [
    ['Avon', 8486485, 1063286], ['Fairfield', 13097189, 1889969],
    ['Danbury', 9422968, 1424864], ['Southington', 6900191, 1192557],
    ['Orange', 18167740, 3243542], ['Stamford', 22560485, 4432782],
  ];
  return { start, end, readyCount: 6, expectedCount: 6, provisional: false,
    reportingPeriod: { start: '2026-08-28', end: '2026-10-27', label: 'Bebidas · corte aprobado de 61 días', approvedForBonus: true, source: 'Compras Provi y ventas Toast reportadas por el operador. Incluye Drinks/refrescos. Sustituye el comparativo; no suma facturas ni grupos de menú. Ventas al corte informado del 27 de octubre. Puntos aprobados por el operador para este bono; conciliación contable pendiente.' },
    rows: amounts.map(([location, sales, purchases], index) => ({ location, sales: sales / 100, purchases: purchases / 100, pending: 0,
      purchasePct: Math.round(purchases / sales * 10000) / 100,
      rank: index + 1, points: 5 - index, comparable: true,
      issues: ['Corte reportado: 28 ago–27 oct de 2026. Compras / ventas de bebidas, incluidos refrescos. Puntos aprobados por el operador; conciliación contable pendiente. No representa costo consumido ni utilidad.'],
    })),
  };
}

// Operator-approved Nov 3 report replaces this scoring cut in full. It must
// never be added to R365 invoices, the Oct 27 cut, or its own Top 10 detail.
function novemberApprovedCut(start: string, end: string): BeverageScoreResponse {
  const amounts: [string, number, number][] = [
    ['Avon', 8924765, 1112561], ['Southington', 6989472, 1024080],
    ['Danbury', 9418894, 1490451], ['Orange', 18279439, 3214832],
    ['Fairfield', 13223502, 2332933], ['Stamford', 23249598, 4306401],
  ];
  return { start, end, readyCount: 6, expectedCount: 6, provisional: false,
    reportingPeriod: { start: '2026-09-04', end: '2026-11-03', label: 'Bebidas · corte aprobado de 61 días', approvedForBonus: true,
      source: 'Compras Provi del PDF y ventas Toast reportadas por el operador para 4 sep–3 nov 2026. Liquor, Drinks, Beer Bottled, Beer Draft y Wine. Seis locaciones: ventas $800,856.70; compras $134,812.58. Sustituye este comparativo; no suma reportes anteriores, facturas ni subtotales. Puntos aprobados por el operador; conciliación contable pendiente.' },
    rows: amounts.map(([location, sales, purchases], index) => ({ location, sales: sales / 100, purchases: purchases / 100, pending: 0,
      purchasePct: Math.round(purchases / sales * 10000) / 100,
      rank: index + 1, points: 5 - index, comparable: true,
      issues: ['Corte reportado: 4 sep–3 nov de 2026 (61 días). Compras / ventas de bebidas del mismo período, incluidos Drinks. Total por sede contado una sola vez; no se suma al corte anterior ni a R365. Aprobado para bono; no representa costo consumido ni utilidad.'],
    })),
  };
}
