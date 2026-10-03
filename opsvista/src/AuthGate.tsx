import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { bindAuthenticatedUser, type OpsVistaUser } from './accessControl';
import { supabase } from './supabaseClient';
import { useI18n } from './i18n';
import PushVerification, { securityRequest } from './PushVerification';
import { detachPushOnLogout } from './webPush';

type SessionResponse = { authenticated?: boolean; user?: OpsVistaUser & { email?: string }; error?: string; code?: string };
type AuthStage = 'password' | 'verify' | 'enroll' | 'forgot' | 'reset' | 'push' | 'push_enroll';
type InviteProfile={email:string;firstName:string;lastName:string;title:string;phone:string;recoveryEmail:string};

export default function AuthGate({ children }: { children: ReactNode }) {
  const { t, language, setLanguage } = useI18n();
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const inviteToken = params.get('invite');
  const recoveryMode=params.get('recovery')==='1';
  const [state, setState] = useState<'loading' | 'authenticated' | 'signed-out' | 'error'>(inviteToken ? 'signed-out' : 'loading');
  const [stage, setStage] = useState<AuthStage>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [factorId, setFactorId] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [manualSecret, setManualSecret] = useState('');
  const [qrFailed, setQrFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteComplete, setInviteComplete] = useState(false);
  const [inviteLoading,setInviteLoading]=useState(Boolean(inviteToken));
  const [inviteProfile,setInviteProfile]=useState<InviteProfile>({email:'',firstName:'',lastName:'',title:'',phone:'',recoveryEmail:''});

  const establishServerSession = async (accessToken: string) => {
    const response = await fetch('/api/auth/session', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken }),
    });
    const body = await response.json().catch(() => ({})) as SessionResponse;
    if (!response.ok || !body.user) throw Object.assign(new Error(body.error || 'Unable to authorize this account in OpsVista.'), { code: body.code });
    bindAuthenticatedUser(body.user);
    setState('authenticated');
    setStage('password');
    setPassword('');
    setConfirmPassword('');
    setQrCode(''); setManualSecret('');
    setVerificationCode('');
    setMessage('');
  };

  const prepareMfa = async (authenticatorOnly = false) => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) throw new Error('Your secure session expired. Sign in again.');
    const security = await securityRequest('mfa_status');
    const showPush = (enroll: boolean) => { setStage(enroll ? 'push_enroll' : 'push'); setState('signed-out'); setPassword(''); setMessage(''); };
    const { data: assurance, error: assuranceError } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (assuranceError) throw assuranceError;
    if (security.verified && (assurance.currentLevel === 'aal2' || security.method === 'push')) {
      if (!authenticatorOnly && !security.founder && !security.linked) { showPush(true); return; }
      await establishServerSession(sessionData.session.access_token);
      return;
    }
    if (!authenticatorOnly && security.method === 'push') { showPush(false); return; }
    if (!authenticatorOnly && security.method === 'push_enroll') { showPush(true); return; }
    const { data: factors, error: factorsError } = await supabase.auth.mfa.listFactors();
    if (factorsError) throw factorsError;
    const verified = factors.totp.find(factor => factor.status === 'verified');
    if (verified) {
      setFactorId(verified.id);
      setStage('verify');
      setState('signed-out');
      return;
    }
    // Abandoned, unverified enrollments can otherwise block the next QR setup.
    // Never remove a verified factor from this recovery path.
    for (const pending of factors.all.filter(factor => factor.factor_type === 'totp' && factor.status === 'unverified')) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: pending.id });
      if (error) throw error;
    }
    const { data: enrollment, error: enrollmentError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'OpsVista Authenticator',
    });
    if (enrollmentError) throw enrollmentError;
    setFactorId(enrollment.id);
    const qr = enrollment.totp.qr_code;
    setQrCode(qr.startsWith('<svg') ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qr)}` : qr);
    setManualSecret(enrollment.totp.secret); setQrFailed(false);
    setStage('enroll');
    setState('signed-out');
  };

  useEffect(()=>{
    if(!inviteToken)return;
    let active=true;
    const preview=async()=>{
      setInviteLoading(true);setMessage('');
      try{
        const response=await fetch('/api/auth/setup-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'preview',token:inviteToken})});
        const body=await response.json().catch(()=>({})) as {profile?:InviteProfile;error?:string};
        if(!response.ok||!body.profile)throw new Error(body.error||'Invitation is unavailable.');
        if(active)setInviteProfile(body.profile);
      }catch(error){if(active)setMessage(error instanceof Error?error.message:'Invitation is unavailable.');}
      finally{if(active)setInviteLoading(false);}
    };
    void preview();
    return()=>{active=false};
  },[inviteToken]);

  useEffect(() => {
    if (inviteToken) return;
    let active = true;
    const restore = async () => {
      try {
        const existing = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' });
        const existingBody = await existing.json().catch(() => ({})) as SessionResponse;
        if (existing.ok && existingBody.user && !recoveryMode) {
          if (!active) return;
          bindAuthenticatedUser(existingBody.user);
          setState('authenticated');
          return;
        }
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          if(recoveryMode){
            if(active){setEmail(data.session.user.email||'');setStage('reset');setState('signed-out');}
            return;
          }
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
  }, [inviteToken,recoveryMode]);

  useEffect(()=>{
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,session)=>{
      if(event==='PASSWORD_RECOVERY'){
        setEmail(session?.user.email||'');
        setPassword('');setConfirmPassword('');setMessage('');
        setStage('reset');setState('signed-out');
      }
    });
    return()=>subscription.unsubscribe();
  },[]);

  useEffect(() => {
    if (state !== 'authenticated') return;
    const refresh = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await establishServerSession(data.session.access_token).catch(async (error: { code?: string }) => {
        if (error.code === 'mfa_required') await prepareMfa().catch(() => { setState('signed-out'); setStage('password'); });
        if (error.code === 'session_expired') { setState('signed-out'); setStage('password'); }
      });
    };
    const timer = window.setInterval(() => void refresh(), 45 * 60 * 1000);
    const logout = async (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest('button.danger-outline');
      if (!button || !/Cerrar sesión|Sign out/i.test(button.textContent?.trim()||'')) return;
      event.preventDefault();
      event.stopPropagation();
      await detachPushOnLogout().catch(() => undefined);
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
      setMessage('Incorrect email or password. Use your authorized OpsVista account.');
      setBusy(false);
      return;
    }
    try {
      await prepareMfa();
    } catch (authError) {
      setMessage(authError instanceof Error ? authError.message : 'Could not prepare secure verification.');
    } finally {
      setBusy(false);
    }
  };

  const requestReset=async(event:FormEvent)=>{
    event.preventDefault();setBusy(true);setMessage('');
    try{
      if(!/^\S+@\S+\.\S+$/.test(email.trim()))throw new Error('Enter your OpsVista login email.');
      const redirectTo=`${window.location.origin}${window.location.pathname}?recovery=1`;
      const {error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo});
      if(error)throw error;
      setMessage(t('If this email belongs to an OpsVista account, a secure password-reset link has been sent. Check your inbox and spam folder.', 'Si este correo pertenece a una cuenta OpsVista, se envió un enlace seguro para restablecer la contraseña. Revisa tu bandeja de entrada y spam.'));
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to request password reset.');}
    finally{setBusy(false);}
  };

  const completeReset=async(event:FormEvent)=>{
    event.preventDefault();setMessage('');
    if(password.length<12){setMessage('Password must be at least 12 characters.');return;}
    if(password!==confirmPassword){setMessage('Passwords do not match.');return;}
    setBusy(true);
    try{
      const {error}=await supabase.auth.updateUser({password});
      if(error)throw error;
      window.history.replaceState({},document.title,window.location.pathname);
      setMessage('Password updated. Completing secure verification…');
      await prepareMfa();
    }catch(error){setMessage(error instanceof Error?error.message:'Unable to update password.');}
    finally{setBusy(false);}
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
      setVerificationCode(''); setQrCode(''); setManualSecret('');
      await prepareMfa();
    } catch {
      setMessage(t('The code is invalid or expired. Use the latest code for your OpsVista account and check that your phone’s time is automatic.', 'El código es inválido o venció. Usa el más reciente de tu cuenta OpsVista y verifica que la hora del teléfono esté en automático.'));
    } finally {
      setBusy(false);
    }
  };

  const setupPassword = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    if (!inviteProfile.firstName.trim()||!inviteProfile.lastName.trim()||!inviteProfile.title.trim()||!inviteProfile.phone.trim()||!inviteProfile.recoveryEmail.trim()) { setMessage('Complete your profile and recovery contact before continuing.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(inviteProfile.recoveryEmail.trim())) { setMessage('Enter a valid recovery email.'); return; }
    if(inviteProfile.recoveryEmail.trim().toLowerCase()===inviteProfile.email.trim().toLowerCase()){setMessage('Recovery email must be different from your OpsVista login email.');return;}
    if (password.length < 12) { setMessage('Password must be at least 12 characters.'); return; }
    if (password !== confirmPassword) { setMessage('Passwords do not match.'); return; }
    setBusy(true);
    try{
      const response = await fetch('/api/auth/setup-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: inviteToken, password, ...inviteProfile }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setMessage(body.error || 'Unable to activate account.'); return; }
      setPassword('');
      setConfirmPassword('');
      setInviteComplete(true);
      window.history.replaceState({}, document.title, window.location.pathname);
    } finally {setBusy(false);}
  };

  if (state === 'authenticated') return <>{children}</>;

  const fieldStyle = { width:'100%', boxSizing:'border-box' as const, padding:'12px 13px', border:'1px solid #cbd5e1', borderRadius:10, marginBottom:16, fontSize:15 };
  const shell = (content: ReactNode) => <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#f4f7fb',padding:24,fontFamily:'Inter, system-ui, sans-serif'}}><div style={{width:'min(520px,100%)',background:'#fff',border:'1px solid #dce3ec',borderRadius:18,padding:32,boxShadow:'0 18px 55px rgba(15,23,42,.08)'}}><div style={{display:'flex',alignItems:'center',gap:12,marginBottom:26}}><img src="/icons/opsvista-192.png" alt="" width="42" height="42" style={{borderRadius:12}}/><div><strong style={{fontSize:20}}>OpsVista</strong><div style={{fontSize:12,color:'#64748b',letterSpacing:'.08em'}}>OPERATIONS CENTER</div></div></div><div style={{textAlign:'right',marginBottom:14}}><button type="button" onClick={()=>setLanguage(language==='en'?'es':'en')} style={{border:0,background:'transparent',color:'#12395b',cursor:'pointer'}}>{language==='en'?'Español':'English'}</button></div>{content}</div></div>;
  const alert = message && <div style={{padding:'10px 12px',borderRadius:9,background:message.startsWith('If this email')||message.startsWith('Si este correo')||message.startsWith('Password updated')?'#ecfdf5':'#fff1f2',color:message.startsWith('If this email')||message.startsWith('Si este correo')||message.startsWith('Password updated')?'#166534':'#9f1239',fontSize:13,marginBottom:12}}>{message}</div>;
  const primaryButton = { width:'100%', padding:'12px 16px', borderRadius:10, border:0, background:'#12395b', color:'#fff', fontWeight:800, fontSize:15 };
  const labelStyle={display:'block',fontWeight:700,fontSize:13,marginBottom:6};

  if (inviteToken && !inviteComplete) return shell(inviteLoading?<><h1 style={{fontSize:26,margin:'0 0 8px'}}>Preparing your invitation</h1><p style={{color:'#64748b'}}>Validating your secure OpsVista activation link…</p></>:<form onSubmit={setupPassword}>
    <h1 style={{fontSize:26,margin:'0 0 8px'}}>Activate your OpsVista account</h1>
    <p style={{color:'#64748b',margin:'0 0 24px'}}>Complete your profile, add a recovery contact and create your secure password.</p>
    {alert}
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}><div><label style={labelStyle}>First name</label><input value={inviteProfile.firstName} onChange={e=>setInviteProfile({...inviteProfile,firstName:e.target.value})} required style={fieldStyle}/></div><div><label style={labelStyle}>Last name</label><input value={inviteProfile.lastName} onChange={e=>setInviteProfile({...inviteProfile,lastName:e.target.value})} required style={fieldStyle}/></div></div>
    <label style={labelStyle}>OpsVista login email</label><input type="email" value={inviteProfile.email} readOnly style={{...fieldStyle,background:'#f8fafc',color:'#475569'}}/>
    <label style={labelStyle}>Position / department</label><input value={inviteProfile.title} onChange={e=>setInviteProfile({...inviteProfile,title:e.target.value})} required style={fieldStyle}/>
    <label style={labelStyle}>Phone number</label><input type="tel" value={inviteProfile.phone} onChange={e=>setInviteProfile({...inviteProfile,phone:e.target.value})} placeholder="+1 203 555 0123" required style={fieldStyle}/>
    <label style={labelStyle}>Recovery email</label><input type="email" value={inviteProfile.recoveryEmail} onChange={e=>setInviteProfile({...inviteProfile,recoveryEmail:e.target.value})} placeholder="Personal or backup email" required style={fieldStyle}/><p style={{fontSize:11,color:'#64748b',margin:'-9px 0 16px'}}>Used only as a backup recovery contact. It does not receive OpsVista access.</p>
    <label style={labelStyle}>Create password</label><input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required style={fieldStyle}/>
    <label style={labelStyle}>Confirm password</label><input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required style={fieldStyle}/>
    <button disabled={busy||Boolean(message&&/expired|invalid|used/i.test(message))} type="submit" style={{...primaryButton,opacity:busy?0.55:1}}>{busy?'Activating…':'Activate account'}</button>
  </form>);

  if (inviteComplete) return shell(<><h1 style={{fontSize:26,margin:'0 0 8px'}}>Account activated</h1><p style={{color:'#64748b'}}>Your profile and password are ready. Continue to secure sign in and two-step verification.</p><button onClick={()=>window.location.reload()} style={primaryButton}>Continue to sign in</button></>);

  if(stage==='forgot')return shell(<form onSubmit={requestReset}><h1 style={{fontSize:26,margin:'0 0 8px'}}>{t('Forgot password?','¿Olvidaste tu contraseña?')}</h1><p style={{color:'#64748b',margin:'0 0 24px'}}>{t('Enter your OpsVista login email. We’ll send a secure password-reset link.','Ingresa tu correo de acceso a OpsVista. Te enviaremos un enlace seguro para restablecer tu contraseña.')}</p><label style={labelStyle}>{t('Login email','Correo de acceso')}</label><input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required style={fieldStyle}/>{alert}<button disabled={busy} type="submit" style={{...primaryButton,opacity:busy?0.55:1}}>{busy?t('Sending…','Enviando…'):t('Send reset link','Enviar enlace de recuperación')}</button><button type="button" onClick={()=>{setStage('password');setMessage('')}} style={{...primaryButton,marginTop:10,background:'#fff',color:'#12395b',border:'1px solid #cbd5e1'}}>{t('Back to Client Login','Volver al inicio de sesión')}</button><p style={{fontSize:11,color:'#64748b',margin:'15px 0 0'}}>If you no longer have access to your login email, contact your OpsVista administrator. Your recovery email is kept on file as a backup recovery contact.</p></form>);

  if(stage==='reset')return shell(<form onSubmit={completeReset}><h1 style={{fontSize:26,margin:'0 0 8px'}}>{t('Create a new password','Crear una nueva contraseña')}</h1><p style={{color:'#64748b',margin:'0 0 24px'}}>{t('Choose a new password with at least 12 characters.','Elige una nueva contraseña de al menos 12 caracteres.')}</p><label style={labelStyle}>{t('New password','Nueva contraseña')}</label><input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required style={fieldStyle}/><label style={labelStyle}>{t('Confirm new password','Confirma la nueva contraseña')}</label><input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required style={fieldStyle}/>{alert}<button disabled={busy} type="submit" style={{...primaryButton,opacity:busy?0.55:1}}>{busy?t('Updating…','Actualizando…'):t('Update password','Actualizar contraseña')}</button></form>);

  if (stage === 'push' || stage === 'push_enroll') return shell(<>
    <PushVerification key={stage} enroll={stage === 'push_enroll'} onComplete={async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await establishServerSession(data.session.access_token);
    }} onAlternative={stage === 'push_enroll' ? () => { void prepareMfa(true).catch(error => setMessage(error instanceof Error ? error.message : 'Verification unavailable')); } : undefined} />
    {alert}
    <button type="button" onClick={async()=>{await supabase.auth.signOut();setStage('password');setMessage('');setVerificationCode('')}} style={{...primaryButton,marginTop:10,background:'#fff',color:'#12395b',border:'1px solid #cbd5e1'}}>{t('Use another account','Usar otra cuenta')}</button>
  </>);

  if (stage === 'verify' || stage === 'enroll') return shell(<form onSubmit={verifyMfa}>
    <h1 style={{fontSize:26,margin:'0 0 8px'}}>{t('Two-step verification','Verificación en dos pasos')}</h1>
    {stage === 'enroll' ? <>
      <p style={{color:'#475569',lineHeight:1.6}}>{t('Set up Authenticator once. Then use its 6-digit OpsVista code each time you sign in.','Configura Authenticator una vez. Después usarás su código OpsVista de 6 dígitos para entrar.')}</p>
      <ol style={{paddingLeft:20,lineHeight:1.6}}>
        <li>{t('Open Google Authenticator, Microsoft Authenticator, or your password manager’s verification codes.','Abre Google Authenticator, Microsoft Authenticator o los códigos de verificación de tu gestor de contraseñas.')}</li>
        <li>{t('Choose Add account → Scan QR code.','Elige Agregar cuenta → Escanear código QR.')}</li>
        <li>{t('Scan this QR, then enter the 6-digit code below.','Escanea este QR e ingresa abajo el código de 6 dígitos.')}</li>
      </ol>
      {qrCode && !qrFailed && <img src={qrCode} onError={()=>setQrFailed(true)} alt={t('QR code to link your OpsVista Authenticator','Código QR para vincular tu Authenticator de OpsVista')} style={{display:'block',width:210,height:210,margin:'0 auto 20px',border:'8px solid #fff',boxShadow:'0 0 0 1px #d7e3ee',borderRadius:12}}/>}
      <details open={qrFailed || undefined} style={{marginBottom:20}}><summary style={{cursor:'pointer',fontWeight:700}}>{t('On the same phone, or QR not visible?','¿Estás en el mismo teléfono o no ves el QR?')}</summary>
        <p>{t('In Authenticator, choose Enter setup key. Account: OpsVista. Type: Time based. Enter this key:','En Authenticator, elige Introducir clave de configuración. Cuenta: OpsVista. Tipo: Basada en tiempo. Ingresa esta clave:')}</p>
        <code style={{display:'block',overflowWrap:'anywhere',padding:12,background:'#f1f5f9',userSelect:'all'}}>{manualSecret}</code>
        <p style={{fontSize:12}}>{t('Keep this key private. Do not send it in messages or screenshots.','Mantén esta clave privada. No la envíes en mensajes ni capturas.')}</p>
      </details>
    </> : <>
      <p style={{color:'#475569',lineHeight:1.6}}>{t('Open the Authenticator you previously linked and find the OpsVista entry for this email. Enter its current 6-digit code.','Abre el Authenticator que vinculaste anteriormente y busca la entrada de OpsVista de este correo. Ingresa el código actual de 6 dígitos.')}</p>
      <details style={{marginBottom:20}}><summary style={{cursor:'pointer',fontWeight:700}}>{t('Where is my code or QR?','¿Dónde está mi código o QR?')}</summary>
        <p>{t('Your QR is shown only during initial setup. An existing verified Authenticator is already linked to this account.','El QR se muestra durante la configuración inicial. Esta cuenta ya tiene un Authenticator verificado vinculado.')}</p>
        <p>{t('If you changed phones or never saved the account, contact your administrator to verify your identity and recover the second factor. Resetting your password does not remove this protection.','Si cambiaste de teléfono o nunca guardaste la cuenta, contacta al administrador para verificar tu identidad y recuperar el segundo factor. Restablecer tu contraseña no elimina esta protección.')}</p>
      </details>
    </>}
    <label style={labelStyle} htmlFor="authenticator-code">{t('Security code','Código de seguridad')}</label>
    <input id="authenticator-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={verificationCode} onChange={event=>setVerificationCode(event.target.value.replace(/\D/g,''))} required style={{...fieldStyle,textAlign:'center',fontSize:24,letterSpacing:'.3em',fontWeight:800}}/>
    {alert}
    <button disabled={busy||verificationCode.length!==6} type="submit" style={{...primaryButton,opacity:(busy||verificationCode.length!==6)?0.55:1}}>{busy?t('Verifying…','Verificando…'):t('Verify and continue','Verificar y continuar')}</button>
    <button type="button" onClick={async()=>{await supabase.auth.signOut();setStage('password');setVerificationCode('');setQrCode('');setManualSecret('');setMessage('')}} style={{...primaryButton,marginTop:10,background:'#fff',color:'#12395b',border:'1px solid #cbd5e1'}}>{t('Use another account','Usar otra cuenta')}</button>
  </form>);

  return shell(state === 'loading' ? <><h1 style={{fontSize:24,margin:'0 0 8px'}}>Checking your session</h1><p style={{color:'#64748b',margin:0}}>Securely validating access…</p></> : state === 'error' ? <><h1 style={{fontSize:24,margin:'0 0 8px'}}>Sign-in service unavailable</h1><p style={{color:'#64748b'}}>{message}</p><button onClick={()=>window.location.reload()} style={primaryButton}>Retry</button></> : <form onSubmit={login}><h1 style={{fontSize:26,margin:'0 0 8px'}}>{t('Client Login','Acceso a OpsVista')}</h1><p style={{color:'#64748b',margin:'0 0 24px'}}>{t('Sign in to your secure OpsVista account.','Ingresa a tu cuenta segura de OpsVista.')}</p><label style={labelStyle}>{t('Email','Correo electrónico')}</label><input type="email" autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)} required style={fieldStyle}/><label style={labelStyle}>{t('Password','Contraseña')}</label><input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required style={{...fieldStyle,marginBottom:8}}/><div style={{textAlign:'right',marginBottom:14}}><button type="button" onClick={()=>{setStage('forgot');setMessage('');setPassword('')}} style={{border:0,background:'transparent',color:'#12395b',fontWeight:800,cursor:'pointer',padding:0}}>{t('Forgot password?','¿Olvidaste tu contraseña?')}</button></div>{alert}<button disabled={busy} type="submit" style={{...primaryButton,opacity:busy ? 0.55 : 1}}>{busy?t('Verifying…','Verificando…'):t('Secure sign in','Iniciar sesión')}</button><p style={{fontSize:12,lineHeight:1.5,color:'#64748b',margin:'18px 0 0'}}>Passwords and two-step verification are handled by OpsVista’s secure identity provider. OpsVista administrators cannot see your password.</p></form>);
}
