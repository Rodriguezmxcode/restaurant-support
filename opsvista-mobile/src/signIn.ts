import {createClient} from '@supabase/supabase-js';
import {authApi} from './api';
import {SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL} from './supabaseConfig';
import type {OpsVistaUser} from './types';

const {auth} = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
});

type Verification =
  | {method: 'push'; id: string}
  | {method: 'authenticator'; id: string};
type SignIn = {user: OpsVistaUser} | {verification: Verification};

export async function beginSignIn(email: string, password: string): Promise<SignIn> {
  const {data, error} = await auth.signInWithPassword({email, password});
  if (error || !data.session) throw new Error('No pudimos iniciar sesión. Revisa tu correo y contraseña.');

  try {
    const token = data.session.access_token;
    const status = await authApi.security<{method: 'push' | 'push_enroll' | 'authenticator'; verified: boolean}>(token, 'mfa_status');
    if (status.verified) {
      await authApi.security(token, 'session');
      return {user: await confirmSession()};
    }
    if (status.method === 'push') {
      const {challengeId} = await authApi.security<{challengeId: string}>(token, 'push_start');
      return {verification: {method: 'push', id: challengeId}};
    }
    if (status.method === 'authenticator') {
      const factors = await auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      const factor = factors.data.totp.find(item => item.status === 'verified');
      if (factor) return {verification: {method: 'authenticator', id: factor.id}};
    }
    throw new Error('Configura la verificación en dos pasos en OpsVista web antes de entrar desde el iPhone.');
  } catch (reason) {
    await clearSignIn();
    throw reason;
  }
}

export async function completeSignIn(verification: Verification, code: string) {
  if (verification.method === 'authenticator') {
    const result = await auth.mfa.challengeAndVerify({factorId: verification.id, code});
    if (result.error) throw new Error('El código del Authenticator es inválido o venció.');
  }
  const {data} = await auth.getSession();
  if (!data.session) throw new Error('La sesión venció. Vuelve a iniciar sesión.');
  const token = data.session.access_token;
  if (verification.method === 'push') {
    await authApi.security(token, 'push_verify', {challengeId: verification.id, code});
  } else {
    await authApi.security(token, 'session');
  }
  return confirmSession();
}

async function confirmSession() {
  try {
    const result = await authApi.session();
    if (!result.authenticated || !result.user) throw new Error('Sesión no disponible.');
    return result.user;
  } finally {
    await clearSignIn();
  }
}

export async function clearSignIn() {
  await auth.signOut({scope: 'local'}).catch(() => undefined);
}
