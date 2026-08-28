import type { RampTransaction } from './rampCompliance';

export type RampDataEnvelope = {
  source: 'live' | 'error';
  fetchedAt?: string;
  fromDate?: string;
  toDate?: string;
  transactions: RampTransaction[];
  warning?: string;
  serverVersion?: string;
  rawTransactionCount?: number;
  userEnrichment?: {
    available: boolean;
    userCount: number;
    matchedTransactions: number;
    directoryMatchedTransactions?: number;
    warning?: string;
  };
};

export type RampDateRange = {
  fromDate: string;
  toDate: string;
};

function errorText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try { return JSON.stringify(value); } catch { return String(value); }
}

export async function loadRampTransactions(range: RampDateRange): Promise<RampDataEnvelope> {
  try {
    const query = new URLSearchParams({ fromDate: range.fromDate, toDate: range.toDate });
    const response = await fetch(`/api/ramp/compliance?${query}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
      cache: 'no-store',
    });

    const payload = await response.json().catch(() => ({})) as RampDataEnvelope & { error?: string; detail?: string };
    if (!response.ok) throw new Error(errorText(payload.detail) || errorText(payload.error) || `Ramp live API returned ${response.status}`);
    if (!Array.isArray(payload.transactions)) throw new Error('Invalid Ramp payload');
    return { ...payload, source: 'live' };
  } catch (error) {
    const warning = error instanceof Error ? error.message : 'Ramp live data unavailable';

    return {
      source: 'error',
      transactions: [],
      warning: `${warning}. OpsVista will not substitute test transactions.`,
    };
  }
}
