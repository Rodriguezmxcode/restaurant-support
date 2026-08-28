export type VerificationStatus = 'Pending' | 'Worked' | 'Did not work' | 'Not enough evidence yet';

export type VerificationMeasurement = {
  actionKey: string;
  measuredAt: string;
  beforeValue?: number;
  afterValue?: number;
  targetValue?: number;
  unit?: string;
  evidenceResolved?: boolean;
  source: string;
  note?: string;
};

export type VerificationResult = {
  status: VerificationStatus;
  summary: string;
  delta?: number;
  estimatedRealizedImpact?: number;
  measuredAt: string;
  source: string;
  confidence: 'High' | 'Medium' | 'Low';
};

export type VerifiableAction = {
  automationKey?: string;
  category: string;
  location: string;
  impact: string;
};

function dollarsFromImpact(text: string) {
  const match = text.replace(/,/g, '').match(/\$([0-9]+(?:\.[0-9]+)?)/);
  return match ? Number(match[1]) : undefined;
}

export function verifyAction(action: VerifiableAction, measurement?: VerificationMeasurement): VerificationResult {
  const measuredAt = measurement?.measuredAt ?? new Date().toISOString();
  const source = measurement?.source ?? 'Awaiting live adapter';

  if (!measurement) {
    return {
      status: 'Not enough evidence yet',
      summary: 'No post-action measurement is available yet. Keep the action in verification until the originating system provides a new reading.',
      measuredAt,
      source,
      confidence: 'Low',
    };
  }

  if (['Ramp Compliance', 'Evidence Audit', 'Tasks'].includes(action.category)) {
    if (measurement.evidenceResolved === true) {
      return {
        status: 'Worked',
        summary: 'The originating compliance/evidence requirement is now resolved and can be closed as verified.',
        measuredAt,
        source,
        confidence: 'High',
      };
    }
    if (measurement.evidenceResolved === false) {
      return {
        status: 'Did not work',
        summary: 'The requirement remains unresolved after the intervention. Reopen or continue the action with a new corrective step.',
        measuredAt,
        source,
        confidence: 'High',
      };
    }
  }

  if (action.category === 'Labor Intelligence') {
    const before = measurement.beforeValue;
    const after = measurement.afterValue;
    const target = measurement.targetValue;
    if (before == null || after == null) {
      return {
        status: 'Not enough evidence yet',
        summary: 'A before/after labor reading is required before OpsVista can verify whether the intervention worked.',
        measuredAt,
        source,
        confidence: 'Low',
      };
    }

    const delta = after - before;
    const improved = after < before;
    const targetMet = target == null ? improved : after <= target;
    const potential = dollarsFromImpact(action.impact);
    const realizedRatio = before === target || target == null ? (improved ? 1 : 0) : Math.max(0, Math.min(1, (before - after) / Math.max(0.01, before - target)));

    return {
      status: targetMet ? 'Worked' : improved ? 'Not enough evidence yet' : 'Did not work',
      summary: targetMet
        ? `The labor reading improved from ${before.toFixed(1)}${measurement.unit ?? '%'} to ${after.toFixed(1)}${measurement.unit ?? '%'} and reached the verification target.`
        : improved
          ? `Labor improved from ${before.toFixed(1)}${measurement.unit ?? '%'} to ${after.toFixed(1)}${measurement.unit ?? '%'}, but has not reached the target yet. Continue monitoring.`
          : `Labor did not improve after the intervention (${before.toFixed(1)}${measurement.unit ?? '%'} → ${after.toFixed(1)}${measurement.unit ?? '%'}).`,
      delta,
      estimatedRealizedImpact: potential == null ? undefined : Math.round(potential * realizedRatio),
      measuredAt,
      source,
      confidence: 'High',
    };
  }

  return {
    status: 'Not enough evidence yet',
    summary: 'OpsVista has a post-action record, but this action type does not yet have a verified comparison rule.',
    measuredAt,
    source,
    confidence: 'Medium',
  };
}
