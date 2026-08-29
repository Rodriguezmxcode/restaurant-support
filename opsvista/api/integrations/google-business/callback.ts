import { readSession } from '../../../server/authSession.js';
import { exchangeAuthorizationCode, googleBusinessRedirectUri, publicOrigin, verifyOAuthState } from '../../../server/googleBusinessOAuth.js';
import { getGoogleBusinessCredentials, saveGoogleBusinessAuthorization } from '../../../server/integrationStore.js';

type ApiRequest = {
  headers: Record<string, string | string[] | undefined> & { cookie?: string };
  query?: Record<string, string | string[]>;
};
type ApiResponse = { status: (code: number) => ApiResponse; json: (body: unknown) => void; setHeader: (name: string, value: string) => void; end: () => void };

const value = (entry?: string | string[]) => Array.isArray(entry) ? entry[0] || '' : entry || '';

function redirect(res: ApiResponse, target: string) {
  res.setHeader('Location', target);
  res.status(302).end();
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  const origin = publicOrigin(req.headers);
  try {
    const user = readSession(req.headers.cookie);
    if (!user || user.role !== 'Founder') throw new Error('Founder session is required to connect Google Business');
    const providerError = value(req.query?.error);
    if (providerError) throw new Error(value(req.query?.error_description) || providerError);
    const state = verifyOAuthState(value(req.query?.state));
    if (state.userId !== user.id) throw new Error('Google authorization belongs to a different OpsVista session');
    const credential = await getGoogleBusinessCredentials(state.organizationId);
    if (!credential) throw new Error('Google OAuth client is not saved in OpsVista');
    const result = await exchangeAuthorizationCode(credential, value(req.query?.code), googleBusinessRedirectUri(req.headers));
    await saveGoogleBusinessAuthorization(state.organizationId, result.refreshToken, result.email);
    redirect(res, `${origin}/?integration=google-business&status=connected`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google authorization failed';
    redirect(res, `${origin}/?integration=google-business&status=error&message=${encodeURIComponent(message)}`);
  }
}
