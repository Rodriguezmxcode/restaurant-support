import { timingSafeEqual } from 'node:crypto';
// A missing secret must fail closed. Cookies and a spoofed cron User-Agent never authorize a scan.
export function authorizedAlertCron(header: unknown) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 32 || typeof header !== 'string') return false;
  const actual = Buffer.from(header), expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
