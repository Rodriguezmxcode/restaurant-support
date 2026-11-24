import postgres from 'postgres';
import { getGoogleReviewSummaries } from './googleBusinessProfile.js';
import { deliverNotificationEmail } from './emailDelivery.js';
import { alertClock } from '../shared/operationalAlerts.js';

const hour = 3600000;
const recipient = 'sergio@puertovallartausa.com';
let pool: ReturnType<typeof postgres> | undefined;
let schema: Promise<void> | undefined;

export function replyStage(rating: number, age: number, answered: boolean) {
  if (answered || !Number.isInteger(rating) || rating < 1 || rating > 5) return 0;
  if (rating >= 4) return age >= 48 * hour ? 48 : 0;
  if (age >= 6 * hour) return 6;
  return age >= 3 * hour ? 3 : 0;
}

export async function checkReviewReplyEmail(location: string, verify: boolean) {
  const apiKey = process.env.RESEND_API_KEY;
  const url = process.env.OPSVISTA_DATABASE_URL || process.env.OPSVISTA_DATABASE_DATABASE_URL;
  if (!apiKey || !url) throw new Error('Review email configuration unavailable');
  const sql = pool ||= postgres(url, { ssl: 'require', max: 2, idle_timeout: 10, connect_timeout: 10 });
  schema ||= (async () => {
    await sql`create table if not exists opsvista_review_email_checks (location text primary key, checked_at timestamptz not null)`;
    await sql`create table if not exists opsvista_review_email_sent (event_key text primary key, provider_id text not null)`;
  })().catch(error => { schema = undefined; throw error; });
  await schema;
  const now = new Date();
  if (!verify) await sql`insert into opsvista_review_email_checks values (${location}, ${new Date(now.getTime() - hour / 2).toISOString()}) on conflict do nothing`;
  const [checkpoint] = await sql`select checked_at from opsvista_review_email_checks where location = ${location}`;
  // On activation include reviews whose deadlines fell due during the previous scheduler interval.
  const last = checkpoint ? new Date(checkpoint.checked_at).getTime() : now.getTime() - hour / 2;
  const start = alertClock(new Date(last - 48 * hour), 'America/New_York').day;
  const end = alertClock(now, 'America/New_York').day;
  const data = await getGoogleReviewSummaries(start, end, [location]);
  const row = data.locations[0];
  if (!row || row.mappingError) throw new Error('Google review location unavailable');
  let accepted = 0;
  for (const review of row.reviews) {
    const created = Date.parse(review.createTime);
    const stage = replyStage(review.rating, now.getTime() - created, review.answered);
    if (!stage || created + stage * hour < last || verify) continue;
    const eventKey = JSON.stringify(['pv-review-email', location, review.id, stage]);
    if ((await sql`select 1 from opsvista_review_email_sent where event_key = ${eventKey}`).length) continue;
    const when = new Intl.DateTimeFormat('es-US', {timeZone:'America/New_York',dateStyle:'short',timeStyle:'short'}).format(created);
    const result = await deliverNotificationEmail({
      apiKey, from: process.env.OPSVISTA_EMAIL_FROM || 'OpsVista Alerts <alerts@getopsvista.com>',
      recipients: [recipient], eventKey,
      title: `${location} · Reseña de ${review.rating} ★ · ${stage === 3 ? 'Recordatorio' : 'Plazo vencido'}`,
      body: `Sergio, la reseña de ${review.reviewer} publicada el ${when} (hora de Connecticut) sigue sin respuesta. ${stage === 3 ? 'El plazo para responder es de 6 horas desde la publicación.' : 'Ya pasó el plazo de ' + stage + ' horas. Por favor responde en Google Business Profile.'}`,
      appUrl: 'https://business.google.com/locations', linkLabel: 'Abrir Google Business Profile',
    });
    if (!result.accepted) throw new Error(result.error);
    await sql`insert into opsvista_review_email_sent values (${eventKey}, ${result.providerId}) on conflict do nothing`;
    accepted++;
  }
  if (!verify) await sql`insert into opsvista_review_email_checks values (${location}, ${now.toISOString()})
    on conflict (location) do update set checked_at = greatest(opsvista_review_email_checks.checked_at, excluded.checked_at)`;
  return {ok: true, accepted};
}
