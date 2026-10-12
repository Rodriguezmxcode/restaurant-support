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
