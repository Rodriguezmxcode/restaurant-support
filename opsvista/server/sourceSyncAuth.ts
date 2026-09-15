import { createPublicKey, verify } from 'node:crypto';
const issuer = 'https://token.actions.githubusercontent.com';
const repository = 'Rodriguezmxcode/restaurant-support';
const workflow = `${repository}/.github/workflows/opsvista-source-sync.yml@refs/heads/main`;
let keyCache: { expires: number; keys: any[] } | undefined;
export function validSyncClaims(claims: Record<string, any>, now = Date.now() / 1000) {
  return claims.iss === issuer && claims.aud === 'opsvista-source-sync'
    && claims.repository === repository && claims.repository_id === '1218432655'
    && claims.repository_owner_id === '278524509' && claims.ref === 'refs/heads/main'
    && claims.workflow_ref === workflow && ['schedule','workflow_dispatch','push'].includes(claims.event_name)
    && [
      `repo:${repository}:ref:refs/heads/main`,
      'repo:Rodriguezmxcode@278524509/restaurant-support@1218432655:ref:refs/heads/main',
    ].includes(claims.sub)
    && Number.isFinite(claims.exp) && claims.exp > now
    && Number.isFinite(claims.iat) && claims.iat <= now + 30 && claims.iat > now - 600
    && Number.isFinite(claims.nbf) && claims.nbf <= now + 30;
}
export async function authorizedSourceSync(header: unknown) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ') || header.length > 20000) return false;
  try {
    const token = header.slice(7), parts = token.split('.');
    if (parts.length !== 3) return false;
    const [encodedHeader, encodedClaims, signature] = parts;
    const jwtHeader = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString());
    const claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString());
    if (jwtHeader.alg !== 'RS256' || !validSyncClaims(claims)) return false;
    if (!keyCache || keyCache.expires < Date.now() || !keyCache.keys.some(key => key.kid === jwtHeader.kid)) {
      const response = await fetch(`${issuer}/.well-known/jwks`, { signal: AbortSignal.timeout(10000) });
      if (!response.ok) return false;
      const body = await response.json();
      if (!Array.isArray(body.keys)) return false;
      keyCache = { keys: body.keys, expires: Date.now() + 3600000 };
    }
    const jwk = keyCache.keys.find(key => key.kid === jwtHeader.kid && key.kty === 'RSA');
    if (!jwk) return false;
    return verify('RSA-SHA256', Buffer.from(`${encodedHeader}.${encodedClaims}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(signature,'base64url'));
  } catch { return false; }
}
