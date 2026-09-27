import { issueSession, readSession, readPushAssurance, sessionCookie, sessionForSupabaseIdentity } from '../../server/authSession.js';
import { verifySupabaseIdentity } from '../../server/supabaseAuth.js';
import { getOrganizationMembership } from '../../server/organizationStore.js';
import { isSameOriginPushRequest } from '../../server/webPushDelivery.js';
import { webPushPublicKey } from '../../server/webPushStore.js';
import { pushMfaDevice, validPushAssurance, startPushChallenge, verifyPushChallenge, verifyRecoveryCode, PushMfaError } from '../../server/pushMfaStore.js';

type ApiRequest = {
  method?: string;
  headers?: Record<string, string | undefined>;
  body?: { accessToken?: string; action?: string; challengeId?: string; code?: string; subscription?: unknown; locale?: string };
};
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void; setHeader?: (name: string, value: string) => void };

export default async function handler(req: ApiRequest, res: ApiResponse) {
  res.setHeader?.('Cache-Control', 'private, no-store');
  if (!req.method || req.method === 'GET') {
    const user = readSession(req.headers?.cookie);
    if (!user) return res.status(401).json({ authenticated: false });
    if (user.organizationId && user.organizationId !== 'org-puerto-vallarta') {
      try {
        const membership = await getOrganizationMembership(user.id);
        if (!membership || membership.organizationId !== user.organizationId) return res.status(403).json({ authenticated: false });
        return res.status(200).json({ authenticated: true, user: { ...user, ...membership } });
      } catch { return res.status(503).json({ error: 'Unable to load your organization' }); }
    }
    return res.status(200).json({ authenticated: true, user });
  }
  if (req.method !== 'POST') { res.setHeader?.('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method not allowed' }); }
  if (!isSameOriginPushRequest(req.headers)) return res.status(403).json({ error: 'Same-origin JSON request required' });
  try {
    const identity = await verifySupabaseIdentity(req.body?.accessToken || '', 'aal1');
    if (!identity) return res.status(401).json({ error: 'Your secure session expired. Sign in again.', code: 'session_expired' });
    const user = await sessionForSupabaseIdentity(identity.email);
    if (!user) return res.status(403).json({ error: 'This account is not authorized in OpsVista' });
    const action = req.body?.action || 'session';
    const founder = user.role === 'Founder';
    const device = founder ? null : await pushMfaDevice(user);
    const current = readSession(req.headers?.cookie);
    const sameUser = current?.id === user.id && current?.organizationId === user.organizationId;
    const proof = sameUser ? readPushAssurance(req.headers?.cookie) : undefined;
    const validProof = !founder && await validPushAssurance(user, identity.sessionId, proof);
    // Once push is enrolled, an AAL2 token alone is insufficient: a password
    // holder could enroll a new provider TOTP factor when none existed there.
    // Only the already linked push factor or its recovery codes authorize access.
    const strongIdentity = validProof || (identity.aal === 'aal2' && (founder || !device));
    if (action === 'session') {
      if (!strongIdentity) return res.status(401).json({ error: 'Two-step verification required', code: 'mfa_required' });
      res.setHeader?.('Set-Cookie', sessionCookie(issueSession(user, validProof ? proof : undefined)));
      return res.status(200).json({ authenticated: true, user });
    }
    if (action === 'mfa_status') {
      if (founder) return res.status(200).json({ method: 'authenticator', founder: true, verified: strongIdentity });
      const canEnroll = strongIdentity || (!device && !identity.hasVerifiedMfa && identity.passwordVerified);
      return res.status(200).json({ method: device ? 'push' : identity.hasVerifiedMfa ? 'authenticator' : 'push_enroll',
        linked: Boolean(device), canEnroll, verified: strongIdentity, ...(canEnroll ? { publicKey: await webPushPublicKey() } : {}) });
    }
    // Founder always uses the provider's authenticator factor. Push and recovery
    // codes cannot authorize, replace or enroll a Founder factor.
    if (founder) return res.status(403).json({ error: 'Founder accounts require Authenticator', code: 'founder_authenticator' });
    if (!identity.passwordVerified && identity.aal !== 'aal2') return res.status(401).json({ error: 'Sign in with your password first.', code: 'password_required' });
    if (action === 'push_start') return res.status(200).json(await startPushChallenge(user, identity.sessionId));
    if (action === 'push_verify' || action === 'recovery_verify') {
      const verified = action === 'push_verify'
        ? (await verifyPushChallenge(user, identity.sessionId, req.body?.challengeId || '', req.body?.code || '', 'login')).proof
        : await verifyRecoveryCode(user, identity.sessionId, req.body?.code || '');
      res.setHeader?.('Set-Cookie', sessionCookie(issueSession(user, verified)));
      return res.status(200).json({ authenticated: true, user });
    }
    if (action === 'push_enroll_start' || action === 'push_enroll_verify') {
      const existing = await pushMfaDevice(user);
      // First-factor bootstrapping is permitted only before ANY factor exists.
      // An existing device or provider factor must be proven before replacement.
      if (!strongIdentity && (existing || identity.hasVerifiedMfa || !identity.passwordVerified)) {
        return res.status(403).json({ error: 'Verify your existing second factor before linking a phone.', code: 'mfa_required' });
      }
      if (action === 'push_enroll_start') return res.status(200).json(await startPushChallenge(user, identity.sessionId, {
        subscription: req.body?.subscription, locale: req.body?.locale || 'en',
      }));
      const result = await verifyPushChallenge(user, identity.sessionId, req.body?.challengeId || '', req.body?.code || '', 'enroll');
      res.setHeader?.('Set-Cookie', sessionCookie(issueSession(user, result.proof)));
      return res.status(200).json({ authenticated: true, user, recoveryCodes: result.recoveryCodes });
    }
    return res.status(400).json({ error: 'Unknown authentication action' });
  } catch (error) {
    if (error instanceof PushMfaError) return res.status(error.status).json({ error: error.code, code: error.code });
    // Authentication codes, tokens, subscriptions and identity-provider responses
    // must never appear in application logs or error responses.
    return res.status(503).json({ error: 'Secure verification is temporarily unavailable. Try again.', code: 'unavailable' });
  }
}
