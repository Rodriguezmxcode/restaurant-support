export type RuleSeverity = 'High' | 'Medium' | 'Low';
export type SignalSource = 'Ramp Compliance' | 'Labor Intelligence' | 'Evidence Audit' | 'Tasks';

export type AutomationSignal = {
  source: SignalSource;
  sourceId: string;
  location: string;
  detectedAt: string;
  kind:
    | 'ramp_evidence_overdue'
    | 'labor_above_target'
    | 'overtime_exposure'
    | 'evidence_rejected_unresolved'
    | 'critical_task_overdue';
  title: string;
  description: string;
  financialImpact?: number;
  ageHours?: number;
  variancePoints?: number;
  overtimeHours?: number;
  ownerHint?: string;
  metadata?: Record<string, string | number | boolean | undefined>;
};

export type AutomatedActionDraft = {
  automationKey: string;
  location: string;
  category: string;
  title: string;
  severity: RuleSeverity;
  priorityScore: number;
  signal: string;
  cause: string;
  recommendation: string;
  impact: string;
  owner?: string;
  automated: true;
  sources: SignalSource[];
  sourceIds: string[];
  detectedAt: string;
};

export type ExistingActionLike = {
  automationKey?: string;
  status?: string;
};

export type RuleRunResult = {
  actions: AutomatedActionDraft[];
  suppressedDuplicates: number;
  evaluatedSignals: number;
};

const money = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
}).format(value);

function automationKey(signal: AutomationSignal) {
  // Same operational problem at the same location collapses into one action.
  // Source record IDs remain attached for auditability but do not create duplicates.
  return `${signal.location.toLowerCase()}::${signal.kind}`;
}

function priorityScore(signal: AutomationSignal) {
  let score = 25;
  if ((signal.financialImpact ?? 0) >= 500) score += 25;
  else if ((signal.financialImpact ?? 0) >= 150) score += 15;
  else if ((signal.financialImpact ?? 0) > 0) score += 8;

  if ((signal.ageHours ?? 0) >= 72) score += 25;
  else if ((signal.ageHours ?? 0) >= 48) score += 18;
  else if ((signal.ageHours ?? 0) >= 24) score += 8;

  if ((signal.variancePoints ?? 0) >= 4) score += 22;
  else if ((signal.variancePoints ?? 0) >= 3) score += 16;
  else if ((signal.variancePoints ?? 0) >= 2) score += 9;

  if ((signal.overtimeHours ?? 0) >= 10) score += 20;
  else if ((signal.overtimeHours ?? 0) >= 5) score += 12;

  if (signal.kind === 'evidence_rejected_unresolved') score += 15;
  if (signal.kind === 'critical_task_overdue') score += 20;

  return Math.min(100, score);
}

function severityFromScore(score: number): RuleSeverity {
  if (score >= 65) return 'High';
  if (score >= 40) return 'Medium';
  return 'Low';
}

function ruleCopy(signal: AutomationSignal) {
  switch (signal.kind) {
    case 'ramp_evidence_overdue':
      return {
        category: 'Ramp Compliance',
        cause: `${signal.ageHours ?? 48}+ hours have passed and required Ramp evidence is still incomplete.`,
        recommendation: `Have ${signal.ownerHint || 'the cardholder'} complete the receipt/memo requirements and verify the transaction before closing this action.`,
        impact: `${money(signal.financialImpact ?? 0)} spend overdue for evidence`,
      };
    case 'labor_above_target':
      return {
        category: 'Labor Intelligence',
        cause: `Projected labor is ${signal.variancePoints ?? 0} points above target after current sales pacing and scheduled coverage are considered.`,
        recommendation: 'Review forecast-aligned coverage, protect required positions and rush periods, then reduce only excess hours that can be removed safely.',
        impact: signal.financialImpact ? `${money(signal.financialImpact)} potential labor savings` : 'Labor variance requires review',
      };
    case 'overtime_exposure':
      return {
        category: 'Labor Intelligence',
        cause: `${signal.overtimeHours ?? 0} projected overtime hours are exposed under the current schedule/punch pattern.`,
        recommendation: 'Move eligible coverage to employees with lower accumulated hours and verify punches before payroll close.',
        impact: signal.financialImpact ? `${money(signal.financialImpact)} projected overtime exposure` : `${signal.overtimeHours ?? 0} projected overtime hours`,
      };
    case 'evidence_rejected_unresolved':
      return {
        category: 'Evidence Audit',
        cause: 'Evidence was rejected during human review and the correction has not yet been verified.',
        recommendation: `Request a corrected submission from ${signal.ownerHint || 'the responsible team'} and keep the task open until a manager approves the new evidence.`,
        impact: `${signal.ageHours ?? 0} hours unresolved since evidence submission`,
      };
    case 'critical_task_overdue':
      return {
        category: 'Tasks',
        cause: 'A task marked operationally critical remains incomplete beyond its required deadline.',
        recommendation: `Assign ${signal.ownerHint || 'the location manager'} to verify completion and document the resolution before the next operating period.`,
        impact: 'Critical operational task overdue',
      };
  }
}

function mergeSignals(signals: AutomationSignal[]): AutomationSignal[] {
  const merged = new Map<string, AutomationSignal>();
  for (const signal of signals) {
    const key = automationKey(signal);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, signal);
      continue;
    }
    const currentScore = priorityScore(current);
    const nextScore = priorityScore(signal);
    merged.set(key, {
      ...(nextScore > currentScore ? signal : current),
      description: [current.description, signal.description].filter((v, i, a) => a.indexOf(v) === i).join(' · '),
      financialImpact: Math.max(current.financialImpact ?? 0, signal.financialImpact ?? 0),
      ageHours: Math.max(current.ageHours ?? 0, signal.ageHours ?? 0),
      variancePoints: Math.max(current.variancePoints ?? 0, signal.variancePoints ?? 0),
      overtimeHours: Math.max(current.overtimeHours ?? 0, signal.overtimeHours ?? 0),
    });
  }
  return [...merged.values()];
}

export function runActionRules(signals: AutomationSignal[], existing: ExistingActionLike[] = []): RuleRunResult {
  const mergedSignals = mergeSignals(signals);
  const activeKeys = new Set(existing.filter(a => !['Completed', 'Dismissed'].includes(a.status ?? '')).map(a => a.automationKey).filter(Boolean));

  const actions = mergedSignals
    .filter(signal => !activeKeys.has(automationKey(signal)))
    .map(signal => {
      const score = priorityScore(signal);
      const copy = ruleCopy(signal);
      return {
        automationKey: automationKey(signal),
        location: signal.location,
        category: copy.category,
        title: signal.title,
        severity: severityFromScore(score),
        priorityScore: score,
        signal: signal.description,
        cause: copy.cause,
        recommendation: copy.recommendation,
        impact: copy.impact,
        owner: signal.ownerHint,
        automated: true as const,
        sources: [signal.source],
        sourceIds: [signal.sourceId],
        detectedAt: signal.detectedAt,
      };
    })
    .sort((a, b) => b.priorityScore - a.priorityScore);

  return {
    actions,
    evaluatedSignals: signals.length,
    suppressedDuplicates: signals.length - mergedSignals.length + (mergedSignals.length - actions.length),
  };
}

export const demoAutomationSignals: AutomationSignal[] = [
  {
    source: 'Ramp Compliance', sourceId: 'ramp-overdue-orange-01', location: 'Orange',
    detectedAt: '2026-08-18T12:45:00-06:00', kind: 'ramp_evidence_overdue',
    title: 'Ramp evidence overdue beyond 48 hours',
    description: 'Two Orange Ramp transactions still require receipt or memo evidence after the 48-hour compliance deadline.',
    financialImpact: 437.82, ageHours: 67, ownerHint: 'Cardholder',
  },
  {
    source: 'Ramp Compliance', sourceId: 'ramp-overdue-orange-02', location: 'Orange',
    detectedAt: '2026-08-18T12:46:00-06:00', kind: 'ramp_evidence_overdue',
    title: 'Ramp evidence overdue beyond 48 hours',
    description: 'Another Orange transaction belongs to the same overdue compliance problem.',
    financialImpact: 188.20, ageHours: 61, ownerHint: 'Cardholder',
  },
  {
    source: 'Labor Intelligence', sourceId: 'labor-orange-20260818', location: 'Orange',
    detectedAt: '2026-08-18T12:47:00-06:00', kind: 'labor_above_target',
    title: 'Projected labor materially above target',
    description: 'Projected labor is 24.8% against a 21.0% target while sales are pacing below forecast.',
    financialImpact: 176, variancePoints: 3.8, ownerHint: 'Orange Manager',
  },
  {
    source: 'Labor Intelligence', sourceId: 'ot-danbury-20260818', location: 'Danbury',
    detectedAt: '2026-08-18T12:48:00-06:00', kind: 'overtime_exposure',
    title: 'Projected overtime exposure increasing',
    description: 'Current kitchen coverage is projected to create overtime before the weekly payroll closes.',
    financialImpact: 428, overtimeHours: 11.5, ownerHint: 'Danbury Manager',
  },
  {
    source: 'Evidence Audit', sourceId: 'ev-stamford-001', location: 'Stamford',
    detectedAt: '2026-08-18T12:49:00-06:00', kind: 'evidence_rejected_unresolved',
    title: 'Rejected closing evidence still unresolved',
    description: 'Walk-in cooler closing evidence was rejected and has not yet been replaced with approved evidence.',
    ageHours: 14, ownerHint: 'Closing team',
  },
];
