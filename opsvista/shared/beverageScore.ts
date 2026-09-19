import { beverageLocations, money, rankBeverages, type BeverageComparison } from './beverageMetrics.js';

export type BeverageScoreRow = Pick<BeverageComparison, 'location' | 'sales' | 'purchases' | 'pending' | 'issues'> & {
  purchasePct: number | null;
  rank: number | null;
  points: number | null;
  comparable: boolean;
};
export type BeverageScoreResponse = {
  start: string; end: string; rows: BeverageScoreRow[];
  readyCount: number; expectedCount: number; provisional: boolean; periodOpen?: boolean; updatedAt?: string; error?: string;
};

// Rank the fixed restaurant cohort before applying any user's location filter.
// Missing data never becomes a zero-cost purchase or zero-point performance.
export function scoreBeverages(comparisons: BeverageComparison[]) {
  const cohort = beverageLocations.map(location => comparisons.find(row => row.location === location));
  const ranked = rankBeverages(cohort.filter((row): row is BeverageComparison => Boolean(row)));
  const readyCount = ranked.filter(row => row.rank !== null).length;
  const rows: BeverageScoreRow[] = ranked.map(row => ({
    location: row.location, sales: row.sales, purchases: row.purchases, pending: row.pending, issues: row.issues,
    // Show the saved ratio for review even when approval or freshness blocks points.
    purchasePct: row.sales !== null && row.sales > 0 && row.purchases !== null && row.purchases >= 0
      ? money(row.purchases / row.sales * 100) : null,
    rank: row.rank, comparable: row.rank !== null,
    points: row.rank !== null && readyCount >= 2 ? Math.max(0, 6 - row.rank) : null,
  }));
  return { rows, readyCount, expectedCount: beverageLocations.length, provisional: readyCount < beverageLocations.length };
}
