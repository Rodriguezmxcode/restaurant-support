export type RampComplianceFlag =
  | 'missing_receipt'
  | 'missing_memo'
  | 'unassigned_department'
  | 'unknown_cardholder'
  | 'possible_duplicate'
  | 'out_of_policy'
  | 'unusual_spend'
  | 'overdue_evidence';

export type RampTransaction = {
  id: string;
  date: string;
  transactionTime?: string;
  merchant: string;
  merchantLocation?: string;
  amount: number;
  cardholder?: string;
  role?: string;
  department?: string;
  restaurant?: string;
  verifiedRestaurant?: string;
  entity?: string;
  category?: string;
  accountingCategory?: string;
  cardLastFour?: string;
  memo?: string;
  receiptAttached: boolean;
  rampUrl?: string;
  state: 'CLEARED' | 'PENDING';
  source: 'Ramp';
  outOfPolicy?: boolean;
  anomalyScore?: number;
};

export type RampComplianceResult = RampTransaction & {
  flags: RampComplianceFlag[];
  complianceStatus: 'Compliant' | 'Needs attention' | 'Critical';
  score: number;
  ageHours: number;
  overdue: boolean;
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
  overdue: number;
  critical: number;
  score: number;
};

export const RAMP_EVIDENCE_DEADLINE_HOURS = 48;

const duplicateKeys = (transactions: RampTransaction[]) => {
  const counts = new Map<string, number>();
  transactions.forEach(tx => {
    const key = `${tx.date}|${tx.merchant.toLowerCase()}|${tx.amount.toFixed(2)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
};

function transactionAgeHours(tx: RampTransaction, nowMs: number) {
  const raw = tx.transactionTime || `${tx.date}T00:00:00`;
  const started = new Date(raw).getTime();
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((nowMs - started) / 3_600_000));
}

export function evaluateRampCompliance(transactions: RampTransaction[], now = new Date()): RampComplianceResult[] {
  const duplicates = duplicateKeys(transactions);
  const nowMs = now.getTime();

  return transactions.map(tx => {
    const flags: RampComplianceFlag[] = [];
    const missingReceipt = !tx.receiptAttached;
    const missingMemo = !tx.memo?.trim();
    const ageHours = transactionAgeHours(tx, nowMs);
    const overdue = ageHours >= RAMP_EVIDENCE_DEADLINE_HOURS && (missingReceipt || missingMemo);

    if (missingReceipt) flags.push('missing_receipt');
    if (missingMemo) flags.push('missing_memo');
    if (!tx.department?.trim()) flags.push('unassigned_department');
    if (!tx.cardholder?.trim()) flags.push('unknown_cardholder');

    const duplicateKey = `${tx.date}|${tx.merchant.toLowerCase()}|${tx.amount.toFixed(2)}`;
    if ((duplicates.get(duplicateKey) ?? 0) > 1) flags.push('possible_duplicate');
    if (tx.outOfPolicy) flags.push('out_of_policy');
    if ((tx.anomalyScore ?? 0) >= 0.85) flags.push('unusual_spend');
    if (overdue) flags.push('overdue_evidence');

    const hardFlags = flags.filter(flag => ['out_of_policy', 'possible_duplicate', 'overdue_evidence'].includes(flag)).length;
    const score = Math.max(0, 100 - hardFlags * 30 - (flags.length - hardFlags) * 15);
    const complianceStatus: RampComplianceResult['complianceStatus'] =
      hardFlags > 0 || flags.length >= 4 ? 'Critical' : flags.length > 0 ? 'Needs attention' : 'Compliant';

    return { ...tx, flags, score, complianceStatus, ageHours, overdue };
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
  overdue_evidence: 'Evidence overdue >48h',
};

export function rampComplianceSummary(results: RampComplianceResult[]) {
  const total = results.length;
  const compliant = results.filter(tx => tx.complianceStatus === 'Compliant').length;
  const needsAttention = total - compliant;
  const totalSpend = results.reduce((sum, tx) => sum + tx.amount, 0);
  const exposedSpend = results.filter(tx => tx.flags.length > 0).reduce((sum, tx) => sum + tx.amount, 0);
  const overdueSpend = results.filter(tx => tx.overdue).reduce((sum, tx) => sum + tx.amount, 0);
  const flagCount = (flag: RampComplianceFlag) => results.filter(tx => tx.flags.includes(flag)).length;
  const score = total ? Math.round(results.reduce((sum, tx) => sum + tx.score, 0) / total) : 100;

  return {
    total,
    compliant,
    needsAttention,
    totalSpend,
    exposedSpend,
    overdueSpend,
    score,
    missingReceipts: flagCount('missing_receipt'),
    missingMemos: flagCount('missing_memo'),
    unassigned: flagCount('unassigned_department'),
    unknownCardholders: flagCount('unknown_cardholder'),
    duplicates: flagCount('possible_duplicate'),
    unusual: flagCount('unusual_spend'),
    overdue: flagCount('overdue_evidence'),
  };
}

export function groupRampCompliance(
  results: RampComplianceResult[],
  dimension: 'cardholder' | 'department'
): RampComplianceGroup[] {
  const groups = new Map<string, RampComplianceResult[]>();

  results.forEach(tx => {
    const raw = dimension === 'cardholder' ? tx.cardholder : tx.restaurant || tx.department;
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
      overdue: rows.filter(tx => tx.overdue).length,
      critical: rows.filter(tx => tx.complianceStatus === 'Critical').length,
      score,
    };
  }).sort((a, b) => {
    if (b.overdue !== a.overdue) return b.overdue - a.overdue;
    if (b.critical !== a.critical) return b.critical - a.critical;
    if (b.exceptionTransactions !== a.exceptionTransactions) return b.exceptionTransactions - a.exceptionTransactions;
    return b.exposedSpend - a.exposedSpend;
  });
}
