import { useCallback, useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { establishServerSession, endServerSession } from './src/lib/api';
import { supabase } from './src/lib/supabase';
import { AuthScreen, type AuthStage } from './src/screens/AuthScreen';
import { MainScreen } from './src/screens/MainScreen';
import type { OpsVistaUser } from './src/types';

export default function App() {
  const [stage, setStage] = useState<AuthStage>('loading');
  const [user, setUser] = useState<OpsVistaUser | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  const authorizeSession = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) throw new Error('Tu sesión segura expiró. Inicia sesión nuevamente.');
    const authorized = await establishServerSession(data.session.access_token);
    if (mounted.current) {
      setUser(authorized);
      setStage('loading');
      setPassword('');
      setCode('');
      setMessage('');
    }
  }, []);

  const prepareMfa = useCallback(async () => {
    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    if (assurance.currentLevel === 'aal2') {
      await authorizeSession();
      return;
    }
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const verified = factors.totp.find(factor => factor.status === 'verified');
    if (!verified) {
      setStage('setup-required');
      setMessage('Usa el enlace de invitación de OpsVista para configurar la verificación en dos pasos.');
      return;
    }
    setFactorId(verified.id);
    setStage('mfa');
  }, [authorizeSession]);

  const restore = useCallback(async () => {
    setStage('loading');
    setMessage('');
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (mounted.current) setStage('password');
        return;
      }
      await prepareMfa();
    } catch (cause) {
      if (!mounted.current) return;
      setMessage(cause instanceof Error ? cause.message : 'No fue posible validar la sesión.');
      setStage('error');
    }
  }, [prepareMfa]);

  useEffect(() => {
    mounted.current = true;
    void restore();
    return () => { mounted.current = false; };
  }, [restore]);

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => void authorizeSession().catch(() => undefined), 45 * 60 * 1000);
    return () => clearInterval(timer);
  }, [authorizeSession, user]);

  const login = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      await prepareMfa();
    } catch {
      setMessage('Correo o contraseña incorrectos. Usa la misma cuenta que en OpsVista web.');
      setStage('password');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (code.length !== 6 || !factorId) return;
    setBusy(true);
    setMessage('');
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
      if (verifyError) throw verifyError;
      await authorizeSession();
    } catch {
      setMessage('El código no es válido o ya expiró. Intenta con un código nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    await Promise.allSettled([supabase.auth.signOut(), endServerSession()]);
    setUser(null);
    setPassword('');
    setCode('');
    setFactorId('');
    setMessage('');
    setStage('password');
  };

  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <StatusBar style="dark" />
      {user ? (
        <MainScreen user={user} onLogout={() => void reset()} onSessionExpired={authorizeSession} />
      ) : (
        <AuthScreen
          stage={stage}
          email={email}
          password={password}
          code={code}
          busy={busy}
          message={message}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onCodeChange={setCode}
          onLogin={() => void login()}
          onVerify={() => void verify()}
          onReset={() => void reset()}
          onRetry={() => void restore()}
        />
      )}
    </SafeAreaProvider>
  );
}
