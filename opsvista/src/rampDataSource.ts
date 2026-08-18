import { rampDemoTransactions, type RampTransaction } from './rampCompliance';

export type RampDataEnvelope = {
  source: 'live' | 'demo';
  fetchedAt?: string;
  transactions: RampTransaction[];
  warning?: string;
};

export async function loadRampTransactions(): Promise<RampDataEnvelope> {
  try {
    const response = await fetch('/api/ramp/compliance', {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
    });

    if (!response.ok) throw new Error(`Ramp live API returned ${response.status}`);
    const payload = await response.json() as RampDataEnvelope;
    if (!Array.isArray(payload.transactions)) throw new Error('Invalid Ramp payload');
    return { ...payload, source: 'live' };
  } catch (error) {
    return {
      source: 'demo',
      transactions: rampDemoTransactions,
      warning: error instanceof Error ? error.message : 'Ramp live data unavailable',
    };
  }
}
