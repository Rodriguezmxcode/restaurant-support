import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { demoUsers, type OpsVistaUser } from './accessControl';
import { supabase } from './supabaseClient';

type SessionResponse = { authenticated?: boolean; user?: OpsVistaUser & { email?: string }; error?: string };
type AuthStage = 'password' | 'verify' | 'enroll';

function bindAuthenticatedUser(user: OpsVistaUser) {
  demoUsers.splice(0, demoUsers.length, user);
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const inviteToken = params.get('invite');
  const [state, setState] = useState<'loading' | 'authenticated' | 'signed-out' | 'error'>(inviteToken ? 'signed-out' : 'loading');
  const [stage, setStage] = useState<AuthStage>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [factorId, setFactorId] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteComplete, setInviteComplete] = useState(false);

  const establishServerSession = async (accessToken: string) => {
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    });
    const body = await response.json().catch(() => ({})) as SessionResponse;
    if (!response.ok || !body.user) throw new Error(body.error || 'Unable to authorize this account in OpsVista.');
    bindAuthenticatedUser(body.user);
    setState('authenticated');
    setStage('password');
    setPassword('');
    setVerificationCode('');
    setMessage('');
  };

  const prepareMfa = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw new Error('Your secure session expired. Sign in again.');
    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    if (assurance.currentLevel === 'aal2') {
      await establishServerSession(sessionData.session.access_token);
      return;
    }
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const verified = factors.totp.find(factor => factor.status === 'verified');
    if (verified) {
      setFactorId(verified.id);
      setStage('verify');
      setState('signed-out');
      return;
    }
    const { data: enrollment, error: enrollmentError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'OpsVista Authenticator',
    });
    if (enrollmentError) throw enrollmentError;
    setFactorId(enrollment.id);
    setQrCode(enrollment.totp.qr_code);
    setStage('enroll');
    setState('signed-out');
  };

  useEffect(() => {
    if (inviteToken) return;
    let active = true;
    const restore = async () => {
      try {
        const existing = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' });
        const existingBody = await existing.json().catch(() => ({})) as SessionResponse;
        if (existing.ok && existingBody.user) {
          if (!active) return;
          bindAuthenticatedUser(existingBody.user);
          setState('authenticated');
          return;
        }
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          await prepareMfa();
          return;
        }
        if (active) setState('signed-out');
      } catch (error) {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : 'Could not reach the authentication service.');
        setState('error');
      }
    };
    void restore();
    return () => { active = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteToken]);

  useEffect(() => {
    if (state !== 'authenticated') return;
    const refresh = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await establishServerSession(data.session.access_token).catch(() => undefined);
    };
    const timer = window.setInterval(() => void refresh(), 45 * 60 * 1000);
    const logout = async (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest('button.danger-outline');
      if (!button || button.textContent?.trim() !== 'Cerrar sesión') return;
      event.preventDefault();
      event.stopPropagation();
      await Promise.allSettled([
        supabase.auth.signOut(),
        fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }),
      ]);
      window.location.assign('/');
    };
    document.addEventListener('click', logout, true);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('click', logout, true);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const login = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      setMessage('Correo o contraseña incorrectos. Usa la misma cuenta que en PV Operations.');
      setBusy(false);
      return;
    }
    try {
      await prepareMfa();
    } catch (authError) {
      setMessage(authError instanceof Error ? authError.message : 'No se pudo preparar la verificación segura.');
    } finally {
      setBusy(false);
    }
  };

  const verifyMfa = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId });
      if (challengeError) throw challengeError;
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challenge.id,
        code: verificationCode.replace(/\s/g, ''),
      });
      if (verifyError) throw verifyError;
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error('The secure session could not be established.');
      await establishServerSession(data.session.access_token);
    } catch {
      setMessage('El código no es válido o ya expiró. Intenta con un código nuevo.');
    } finally {
      setBusy(false);
    }
  };

  const setupPassword = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    if (password.length < 12) { setMessage('Password must be at least 12 characters.'); return; }
    if (password !== confirmPassword) { setMessage('Passwords do not match.'); return; }
    const response = await fetch('/api/auth/setup-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: inviteToken, password }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setMessage(body.error || 'Unable to set password.'); return; }
    setPassword('');
    setConfirmPassword('');
    setInviteComplete(true);
    window.history.replaceState({}, document.title, window.location.pathname);
  };

  if (state === 'authenticated') return <>{children}</>;

  const fieldStyle = { width:'100%', boxSizing:'border-box' as const, padding:'12px 13px', border:'1px solid #cbd5e1', borderRadius:10, marginBottom:16, fontSize:15 };
  const shell = (content: ReactNode) => <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#f4f7fb',padding:24,fontFamily:'Inter, system-ui, sans-serif'}}><div style={{width:'min(460px,100%)',background:'#fff',border:'1px solid #dce3ec',borderRadius:18,padding:32,boxShadow:'0 18px 55px rgba(15,23,42,.08)'}}><div style={{display:'flex',alignItems:'center',gap:12,marginBottom:26}}><div style={{width:42,height:42,borderRadius:12,display:'grid',placeItems:'center',background:'#12395b',color:'#fff',fontWeight:800}}>OV</div><div><strong style={{fontSize:20}}>OpsVista</strong><div style={{fontSize:12,color:'#64748b',letterSpacing:'.08em'}}>OPERATIONS CENTER</div></div></div>{content}</div></div>;
  const alert = message && <div style={{padding:'10px 12px',borderRadius:9,background:'#fff1f2',color:'#9f1239',fontSize:13,marginBottom:12}}>{message}</div>;
  const primaryButton = { width:'100%', padding:'12px 16px', borderRadius:10, border:0, background:'#12395b', color:'#fff', fontWeight:800, fontSize:15 };

  if (inviteToken && !inviteComplete) return shell(<form onSubmit={setupPassword}><h1 style={{fontSize:26,margin:'0 0 8px'}}>Create your OpsVista password</h1><p style={{color:'#64748b',margin:'0 0 24px'}}>This invitation can be used once. Choose a password with at least 12 characters.</p><label style={{display:'block',fontWeight:700,fontSize:13,marginBottom:6}}>Password</label><input type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} required style={fieldStyle}/><label style={{display:'block',fontWeight:700,fontSize:13,marginBottom:6}}>Confirm password</label><input type="password" autoComplete="new-password" value={confirmPassword} onChange={event=>setConfirmPassword(event.target.value)} required style={fieldStyle}/>{alert}<button type="submit" style={primaryButton}>Create password</button></form>);

  if (inviteComplete) return shell(<><h1 style={{fontSize:26,margin:'0 0 8px'}}>Password created</h1><p style={{color:'#64748b'}}>Your invitation has been accepted. You can now sign in.</p><button onClick={()=>window.location.reload()} style={primaryButton}>Continue to sign in</button></>);

  if (stage === 'verify' || stage === 'enroll') return shell(<form onSubmit={verifyMfa}><h1 style={{fontSize:26,margin:'0 0 8px'}}>Verificación en dos pasos</h1><p style={{color:'#64748b',margin:'0 0 24px'}}>{stage === 'enroll' ? 'Escanea este código una sola vez con tu aplicación de autenticación.' : 'Escribe el código de 6 dígitos de tu aplicación de autenticación.'}</p>{stage === 'enroll' && qrCode && <img src={qrCode} alt="Código QR para configurar verificación en dos pasos" style={{display:'block',width:210,height:210,margin:'0 auto 20px',border:'8px solid #fff',boxShadow:'0 0 0 1px #d7e3ee',borderRadius:12}}/>}<label style={{display:'block',fontWeight:700,fontSize:13,marginBottom:6}}>Código de seguridad</label><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={verificationCode} onChange={event=>setVerificationCode(event.target.value.replace(/\D/g,''))} required style={{...fieldStyle,textAlign:'center',fontSize:24,letterSpacing:'.3em',fontWeight:800}}/>{alert}<button disabled={busy||verificationCode.length!==6} type="submit" style={{...primaryButton,opacity:(busy||verificationCode.length!==6) ? 0.55 : 1}}>{busy?'Verificando…':'Verificar y entrar'}</button><button type="button" onClick={async()=>{await supabase.auth.signOut();setStage('password');setVerificationCode('');setMessage('')}} style={{...primaryButton,marginTop:10,background:'#fff',color:'#12395b',border:'1px solid #cbd5e1'}}>Usar otra cuenta</button></form>);

  return shell(state === 'loading' ? <><h1 style={{fontSize:24,margin:'0 0 8px'}}>Checking your session</h1><p style={{color:'#64748b',margin:0}}>Securely validating access…</p></> : state === 'error' ? <><h1 style={{fontSize:24,margin:'0 0 8px'}}>Sign-in service unavailable</h1><p style={{color:'#64748b'}}>{message}</p><button onClick={()=>window.location.reload()} style={primaryButton}>Retry</button></> : <form onSubmit={login}><h1 style={{fontSize:26,margin:'0 0 8px'}}>Bienvenido a OpsVista</h1><p style={{color:'#64748b',margin:'0 0 24px'}}>Usa la misma cuenta segura de PV Operations. Tu sesión permanecerá activa y se renovará automáticamente.</p><label style={{display:'block',fontWeight:700,fontSize:13,marginBottom:6}}>Correo electrónico</label><input type="email" autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)} required style={fieldStyle}/><label style={{display:'block',fontWeight:700,fontSize:13,marginBottom:6}}>Contraseña</label><input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required style={{...fieldStyle,marginBottom:12}}/>{alert}<button disabled={busy} type="submit" style={{...primaryButton,opacity:busy ? 0.55 : 1}}>{busy?'Verificando…':'Entrar de forma segura'}</button><p style={{fontSize:12,lineHeight:1.5,color:'#64748b',margin:'18px 0 0'}}>La contraseña y la verificación en dos pasos son administradas por el mismo proveedor de identidad de PV Operations. OpsVista no puede ver tu contraseña.</p></form>);
}
