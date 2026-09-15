import { getIntegrationSnapshot, saveIntegrationSnapshot, invalidateInvoiceSnapshots } from './integrationStore.js';
import { getRestaurant365Changes } from './restaurant365OData.js';
import { claimSource, executeSource, dirtyR365Sources, sourceQueueStatus, withSyncLease, registerSource } from './sourceCache.js';
import { loadSource } from './sourceLoaders.js';

type SyncState = { cursor?: string; checkedAt?: string; lastSuccessAt?: string; error?: string; schedulerSeenAt?: string };
export async function getSourceSyncStatus(organizationId: string) {
  const state = (await getIntegrationSnapshot<SyncState>(organizationId, 'source-sync', 'state'))?.payload || {};
  return { ...state, queue: await sourceQueueStatus(organizationId), intervalMinutes: 30, nightlyUtc: '07:30' };
}
export async function runSourceSync(organizationId = 'org-puerto-vallarta', scheduled = false) {
  return withSyncLease(organizationId, async () => {
    const begin = Date.now(), now = new Date().toISOString();
    const localMonth = new Intl.DateTimeFormat('en-CA',{ timeZone:'America/New_York',year:'numeric',month:'2-digit' }).format(new Date());
    await registerSource(organizationId,'r365-ap',{start:localMonth});
    const state = (await getIntegrationSnapshot<SyncState>(organizationId, 'source-sync', 'state'))?.payload || {};
    if (scheduled) state.schedulerSeenAt = now;
    if (!state.checkedAt || begin - Date.parse(state.checkedAt) >= 25 * 60000) {
      try {
        // A small overlap catches transactions committed at the cursor boundary.
        // Advance the cursor only after both feeds and invalidation succeed.
        const since = new Date(Date.parse(state.cursor || now) - 5 * 60000).toISOString();
        const changed = await getRestaurant365Changes(organizationId, since, now);
        await invalidateInvoiceSnapshots(organizationId, changed);
        if (changed.length) await dirtyR365Sources(organizationId);
        state.cursor = now; state.lastSuccessAt = now; state.error = undefined;
      } catch (error) { state.error = error instanceof Error ? error.message : 'No se pudo comprobar R365'; }
      state.checkedAt = now;
    }
    await saveIntegrationSnapshot(organizationId, 'source-sync', 'state', state);
    let processed = 0, failed = 0;
    // One bounded unit per HTTP request. The scheduler drains the persistent
    // queue in subsequent requests; process termination never loses its work.
    if (Date.now() - begin < 30000) {
      const job = await claimSource(organizationId);
      if (job) { const result = await executeSource(job, loadSource); processed++; if (result.lastError) failed++; }
    }
    const queue = await sourceQueueStatus(organizationId);
    // This endpoint deliberately returns no invoices, totals or credentials.
    return { ok: !state.error && !failed, processed, failed, remaining: queue.remaining, errors: queue.errors, checkedAt: state.checkedAt };
  });
}
