import postgres from 'postgres';
import { CopilotError } from './copilotPolicy.js';
import type { SessionUser } from './authSession.js';

let client: ReturnType<typeof postgres> | undefined;
let ready: Promise<unknown> | undefined;
export const copilotConfigured = () => Boolean(process.env.OPENAI_API_KEY?.trim() && (process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL) && process.env.OPSVISTA_COPILOT_ENABLED !== 'false');

// A shared database counter bounds usage across serverless instances. No chat
// text or source payload is persisted here. Rejected reservations roll back.
export async function reserveCopilotRequest(user: SessionUser) {
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!url) throw new CopilotError(503, 'El asistente necesita la conexión de OpsVista.');
  const sql = client ||= postgres(url, { max: 2, idle_timeout: 20, connect_timeout: 5 });
  ready ||= sql`create table if not exists opsvista_copilot_usage (
    scope text not null, bucket timestamptz not null, requests integer not null,
    primary key (scope, bucket))`.catch(error => { ready = undefined; throw error; });
  await ready;
  const org = user.organizationId || 'org-puerto-vallarta';
  await sql.begin(async tx => {
    await tx`delete from opsvista_copilot_usage where bucket < now() - interval '2 days'`;
    const daily = await tx`insert into opsvista_copilot_usage (scope,bucket,requests)
      values (${`org:${org}`},date_trunc('day',now() at time zone 'UTC') at time zone 'UTC',1)
      on conflict (scope,bucket) do update set requests=opsvista_copilot_usage.requests+1
      where opsvista_copilot_usage.requests < 250 returning requests`;
    const hourly = await tx`insert into opsvista_copilot_usage (scope,bucket,requests)
      values (${`user:${org}:${user.id}`},date_trunc('hour',now()),1)
      on conflict (scope,bucket) do update set requests=opsvista_copilot_usage.requests+1
      where opsvista_copilot_usage.requests < 20 returning requests`;
    if (!daily.length || !hourly.length) {
      const now = new Date();
      const next = new Date(now);
      if (!daily.length) next.setUTCHours(24, 0, 0, 0); else next.setUTCMinutes(60, 0, 0);
      throw new CopilotError(429, !daily.length ? 'OpsVista alcanzó su límite diario de consultas de IA. Los módulos siguen disponibles.' : 'Alcanzaste tu límite por hora de consultas de IA en OpsVista. Los módulos siguen disponibles.', { code: 'opsvista_limit', retryAfterSeconds: Math.max(1, Math.ceil((next.getTime() - now.getTime()) / 1000)) });
    }
  });
}
