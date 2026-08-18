export type RampComplianceFlag =
  | 'missing_receipt'
  | 'missing_memo'
  | 'unassigned_department'
  | 'unknown_cardholder'
  | 'possible_duplicate'
  | 'out_of_policy'
  | 'unusual_spend';

export type RampTransaction = {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  cardholder?: string;
  department?: string;
  memo?: string;
  receiptAttached: boolean;
  state: 'CLEARED' | 'PENDING';
  source: 'Ramp';
  outOfPolicy?: boolean;
  anomalyScore?: number;
};

export type RampComplianceResult = RampTransaction & {
  flags: RampComplianceFlag[];
  complianceStatus: 'Compliant' | 'Needs attention' | 'Critical';
  score: number;
};

export type RampComplianceGroup = {
  key: string;
  totalTransactions: number;
  compliantTransactions: number;
  exceptionTransactions: number;
  totalSpend: number;
  exposedSpend: number;
  missingReceipts: number;
  missingMemos: number;
  critical: number;
  score: number;
};

export const rampDemoTransactions: RampTransaction[] = [
  {
    id: 'ramp-1001', date: '2026-08-13', merchant: 'Concept Design', amount: 125,
    cardholder: 'Roberto Rodriguez', department: '', memo: '', receiptAttached: true,
    state: 'CLEARED', source: 'Ramp'
  },
  {
    id: 'ramp-1002', date: '2026-08-13', merchant: 'The Home Depot', amount: 57.04,
    cardholder: 'Jacob Rodriguez', department: 'Orange', memo: 'Repair materials', receiptAttached: false,
    state: 'CLEARED', source: 'Ramp'
  },
  {
    id: 'ramp-1003', date: '2026-08-13', merchant: 'Exxon', amount: 4.32,
    cardholder: '', department: '', memo: '', receiptAttached: false,
    state: 'CLEARED', source: 'Ramp'
  },
  {
    id: 'ramp-1004', date: '2026-08-13', merchant: 'Exxon', amount: 4.32,
    cardholder: '', department: '', memo: '', receiptAttached: false,
    state: 'CLEARED', source: 'Ramp'
  },
  {
    id: 'ramp-1005', date: '2026-08-12', merchant: 'Amazon Prime', amount: 14.99,
    cardholder: 'Gladys Valdez', department: 'Corporate', memo: 'Office subscription', receiptAttached: true,
    state: 'CLEARED', source: 'Ramp'
  },
  {
    id: 'ramp-1006', date: '2026-08-14', merchant: 'Staples', amount: 53.90,
    cardholder: 'Roberto Rodriguez', department: 'Avon', memo: 'Menu printing and office supplies for Avon', receiptAttached: true,
    state: 'CLEARED', source: 'Ramp'
  },
  {
    id: 'ramp-1007', date: '2026-08-14', merchant: 'Grainger Industrial Supply', amount: 936.50,
    cardholder: 'Roberto Rodriguez', department: 'Stamford', memo: 'Dishwasher relief valve replacement', receiptAttached: true,
    state: 'CLEARED', source: 'Ramp', anomalyScore: 0.88
  },
  {
    id: 'ramp-1008', date: '2026-08-14', merchant: 'ShopRite', amount: 20.97,
    cardholder: 'Jacob Rodriguez', department: 'Orange', memo: 'Groceries for Orange location', receiptAttached: true,
    state: 'CLEARED', source: 'Ramp'
  },
];

const duplicateKeys = (transactions: RampTransaction[]) => {
  const counts = new Map<string, number>();
  transactions.forEach(tx => {
    const key = `${tx.date}|${tx.merchant.toLowerCase()}|${tx.amount.toFixed(2)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
};

export function evaluateRampCompliance(transactions: RampTransaction[]): RampComplianceResult[] {
  const duplicates = duplicateKeys(transactions);

  return transactions.map(tx => {
    const flags: RampComplianceFlag[] = [];
    if (!tx.receiptAttached) flags.push('missing_receipt');
    if (!tx.memo?.trim()) flags.push('missing_memo');
    if (!tx.department?.trim()) flags.push('unassigned_department');
    if (!tx.cardholder?.trim()) flags.push('unknown_cardholder');

    const duplicateKey = `${tx.date}|${tx.merchant.toLowerCase()}|${tx.amount.toFixed(2)}`;
    if ((duplicates.get(duplicateKey) ?? 0) > 1) flags.push('possible_duplicate');
    if (tx.outOfPolicy) flags.push('out_of_policy');
    if ((tx.anomalyScore ?? 0) >= 0.85) flags.push('unusual_spend');

    const hardFlags = flags.filter(flag => ['out_of_policy', 'possible_duplicate'].includes(flag)).length;
    const score = Math.max(0, 100 - hardFlags * 30 - (flags.length - hardFlags) * 15);
    const complianceStatus: RampComplianceResult['complianceStatus'] =
      hardFlags > 0 || flags.length >= 4 ? 'Critical' : flags.length > 0 ? 'Needs attention' : 'Compliant';

    return { ...tx, flags, score, complianceStatus };
  });
}

export const rampFlagLabels: Record<RampComplianceFlag, string> = {
  missing_receipt: 'Missing receipt',
  missing_memo: 'Missing memo',
  unassigned_department: 'Unassigned department',
  unknown_cardholder: 'Unknown cardholder',
  possible_duplicate: 'Possible duplicate',
  out_of_policy: 'Out of policy',
  unusual_spend: 'Unusual spend',
};

export function rampComplianceSummary(results: RampComplianceResult[]) {
  const total = results.length;
  const compliant = results.filter(tx => tx.complianceStatus === 'Compliant').length;
  const needsAttention = total - compliant;
  const totalSpend = results.reduce((sum, tx) => sum + tx.amount, 0);
  const exposedSpend = results.filter(tx => tx.flags.length > 0).reduce((sum, tx) => sum + tx.amount, 0);
  const flagCount = (flag: RampComplianceFlag) => results.filter(tx => tx.flags.includes(flag)).length;
  const score = total ? Math.round(results.reduce((sum, tx) => sum + tx.score, 0) / total) : 100;

  return {
    total,
    compliant,
    needsAttention,
    totalSpend,
    exposedSpend,
    score,
    missingReceipts: flagCount('missing_receipt'),
    missingMemos: flagCount('missing_memo'),
    unassigned: flagCount('unassigned_department'),
    unknownCardholders: flagCount('unknown_cardholder'),
    duplicates: flagCount('possible_duplicate'),
    unusual: flagCount('unusual_spend'),
  };
}

export function groupRampCompliance(
  results: RampComplianceResult[],
  dimension: 'cardholder' | 'department'
): RampComplianceGroup[] {
  const groups = new Map<string, RampComplianceResult[]>();

  results.forEach(tx => {
    const raw = dimension === 'cardholder' ? tx.cardholder : tx.department;
    const key = raw?.trim() || (dimension === 'cardholder' ? 'Not identified' : 'Unassigned');
    const existing = groups.get(key) ?? [];
    existing.push(tx);
    groups.set(key, existing);
  });

  return [...groups.entries()].map(([key, rows]) => {
    const compliantTransactions = rows.filter(tx => tx.complianceStatus === 'Compliant').length;
    const exceptionRows = rows.filter(tx => tx.flags.length > 0);
    const totalSpend = rows.reduce((sum, tx) => sum + tx.amount, 0);
    const exposedSpend = exceptionRows.reduce((sum, tx) => sum + tx.amount, 0);
    const score = rows.length ? Math.round(rows.reduce((sum, tx) => sum + tx.score, 0) / rows.length) : 100;

    return {
      key,
      totalTransactions: rows.length,
      compliantTransactions,
      exceptionTransactions: rows.length - compliantTransactions,
      totalSpend,
      exposedSpend,
      missingReceipts: rows.filter(tx => tx.flags.includes('missing_receipt')).length,
      missingMemos: rows.filter(tx => tx.flags.includes('missing_memo')).length,
      critical: rows.filter(tx => tx.complianceStatus === 'Critical').length,
      score,
    };
  }).sort((a, b) => {
    if (b.critical !== a.critical) return b.critical - a.critical;
    if (b.exceptionTransactions !== a.exceptionTransactions) return b.exceptionTransactions - a.exceptionTransactions;
    return b.exposedSpend - a.exposedSpend;
  });
}
