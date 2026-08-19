import { rampDemoTransactions, type RampTransaction } from './rampCompliance';

export type RampDataEnvelope = {
  source: 'live' | 'demo' | 'error';
  fetchedAt?: string;
  transactions: RampTransaction[];
  warning?: string;
};

function demoFallbackAllowed() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
}

function errorText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try { return JSON.stringify(value); } catch { return String(value); }
}

export async function loadRampTransactions(): Promise<RampDataEnvelope> {
  try {
    const response = await fetch('/api/ramp/compliance', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
    });

    const payload = await response.json().catch(() => ({})) as RampDataEnvelope & { error?: string; detail?: string };
    if (!response.ok) throw new Error(errorText(payload.detail) || errorText(payload.error) || `Ramp live API returned ${response.status}`);
    if (!Array.isArray(payload.transactions)) throw new Error('Invalid Ramp payload');
    return { ...payload, source: 'live' };
  } catch (error) {
    const warning = error instanceof Error ? error.message : 'Ramp live data unavailable';

    if (demoFallbackAllowed()) {
      return { source: 'demo', transactions: rampDemoTransactions, warning };
    }

    return {
      source: 'error',
      transactions: [],
      warning: `${warning}. OpsVista will not substitute demo transactions in a non-local environment.`,
    };
  }
}
