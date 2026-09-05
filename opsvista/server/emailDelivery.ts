import { createHash } from 'node:crypto';

type EmailInput = {
  apiKey: string;
  from: string;
  recipients: string[];
  eventKey: string;
  title: string;
  body: string;
  appUrl: string;
};

export type EmailDeliveryResult =
  | { accepted: true; providerId: string }
  | { accepted: false; error: string };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]!));

export async function deliverNotificationEmail(input: EmailInput, request: typeof fetch = fetch): Promise<EmailDeliveryResult> {
  if (!input.apiKey.trim()) return { accepted: false, error: 'Email sender is not configured' };
  if (!input.recipients.length) return { accepted: false, error: 'No email recipients selected' };
  let appUrl: URL;
  try {
    appUrl = new URL(input.appUrl);
    if (appUrl.protocol !== 'https:' || appUrl.username || appUrl.password) throw new Error('Invalid URL');
  } catch {
    return { accepted: false, error: 'OpsVista email link is not configured correctly' };
  }
  const recipientList = [...new Set(input.recipients)].sort();
  const key = createHash('sha256').update(JSON.stringify([input.eventKey, recipientList])).digest('hex');
  try {
    const response = await request('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `opsvista/${key}` },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        from: input.from, to: recipientList, subject: input.title,
        text: `${input.body}\n\nAbrir OpsVista: ${appUrl.href}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033"><p style="font-size:13px;font-weight:800;letter-spacing:1px;color:#1769ff">OPSVISTA</p><h1 style="font-size:24px">${escapeHtml(input.title)}</h1><p style="font-size:17px;line-height:1.55">${escapeHtml(input.body)}</p><p style="margin:28px 0"><a href="${escapeHtml(appUrl.href)}" style="background:#1769ff;color:white;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:700">Abrir OpsVista</a></p><p style="font-size:12px;color:#738096">Restaurant operating intelligence · Mensaje automático</p></div>`,
      }),
    });
    if (!response.ok) return { accepted: false, error: `Email provider returned ${response.status}` };
    const result = await response.json().catch(() => null) as { id?: unknown } | null;
    if (!result || typeof result.id !== 'string' || !result.id.trim()) {
      return { accepted: false, error: 'Email provider did not confirm acceptance' };
    }
    return { accepted: true, providerId: result.id };
  } catch {
    return { accepted: false, error: 'Email provider could not be reached; delivery is unconfirmed' };
  }
}
