import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { bindAuthenticatedUser, type OpsVistaUser } from './accessControl';
import { supabase } from './supabaseClient';

type SessionResponse = { authenticated?: boolean; user?: OpsVistaUser & { email?: string }; error?: string };
type AuthStage = 'password' | 'verify' | 'enroll' | 'forgot' | 'reset';
type InviteProfile={email:string;firstName:string;lastName:string;title:string;phone:string;recoveryEmail:string};

export default function AuthGate({ children }: { children: ReactNode }) {
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
    if (!response.ok || !body.user) throw new Error(body.error || 'Unable to authorize this account in OpsVista.');
    bindAuthenticatedUser(body.user);
    setState('authenticated');
    setStage('password');
    setPassword('');
    setConfirmPassword('');
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
      if (data.session) await establishServerSession(data.session.access_token).catch(() => undefined);
    };
    const timer = window.setInterval(() => void refresh(), 45 * 60 * 1000);
    const logout = async (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest('button.danger-outline');
      if (!button || !/Cerrar sesión|Sign out/i.test(button.textContent?.trim()||'')) return;
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
      setMessage('If this email belongs to an OpsVista account, a secure password-reset link has been sent. Check your inbox and spam folder.');
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
      await establishServerSession(data.session.access_token);
    } catch {
      setMessage('The code is invalid or expired. Try a new code.');
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
  const shell = (content: ReactNode) => <div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#f4f7fb',padding:24,fontFamily:'Inter, system-ui, sans-serif'}}><div style={{width:'min(520px,100%)',background:'#fff',border:'1px solid #dce3ec',borderRadius:18,padding:32,boxShadow:'0 18px 55px rgba(15,23,42,.08)'}}><div style={{display:'flex',alignItems:'center',gap:12,marginBottom:26}}><div style={{width:42,height:42,borderRadius:12,display:'grid',placeItems:'center',background:'#12395b',color:'#fff',fontWeight:800}}>OV</div><div><strong style={{fontSize:20}}>OpsVista</strong><div style={{fontSize:12,color:'#64748b',letterSpacing:'.08em'}}>OPERATIONS CENTER</div></div></div>{content}</div></div>;
  const alert = message && <div style={{padding:'10px 12px',borderRadius:9,background:message.startsWith('If this email')||message.startsWith('Password updated')?'#ecfdf5':'#fff1f2',color:message.startsWith('If this email')||message.startsWith('Password updated')?'#166534':'#9f1239',fontSize:13,marginBottom:12}}>{message}</div>;
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

  if(stage==='forgot')return shell(<form onSubmit={requestReset}><h1 style={{fontSize:26,margin:'0 0 8px'}}>Forgot password?</h1><p style={{color:'#64748b',margin:'0 0 24px'}}>Enter your OpsVista login email. We’ll send a secure password-reset link.</p><label style={labelStyle}>Login email</label><input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required style={fieldStyle}/>{alert}<button disabled={busy} type="submit" style={{...primaryButton,opacity:busy?0.55:1}}>{busy?'Sending…':'Send reset link'}</button><button type="button" onClick={()=>{setStage('password');setMessage('')}} style={{...primaryButton,marginTop:10,background:'#fff',color:'#12395b',border:'1px solid #cbd5e1'}}>Back to Client Login</button><p style={{fontSize:11,color:'#64748b',margin:'15px 0 0'}}>If you no longer have access to your login email, contact your OpsVista administrator. Your recovery email is kept on file as a backup recovery contact.</p></form>);

  if(stage==='reset')return shell(<form onSubmit={completeReset}><h1 style={{fontSize:26,margin:'0 0 8px'}}>Create a new password</h1><p style={{color:'#64748b',margin:'0 0 24px'}}>Choose a new password with at least 12 characters.</p><label style={labelStyle}>New password</label><input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required style={fieldStyle}/><label style={labelStyle}>Confirm new password</label><input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required style={fieldStyle}/>{alert}<button disabled={busy} type="submit" style={{...primaryButton,opacity:busy?0.55:1}}>{busy?'Updating…':'Update password'}</button></form>);

  if (stage === 'verify' || stage === 'enroll') return shell(<form onSubmit={verifyMfa}><h1 style={{fontSize:26,margin:'0 0 8px'}}>Two-step verification</h1><p style={{color:'#64748b',margin:'0 0 24px'}}>{stage === 'enroll' ? 'Scan this code once with your authenticator app.' : 'Enter the 6-digit code from your authenticator app.'}</p>{stage === 'enroll' && qrCode && <img src={qrCode} alt="QR code for two-step verification" style={{display:'block',width:210,height:210,margin:'0 auto 20px',border:'8px solid #fff',boxShadow:'0 0 0 1px #d7e3ee',borderRadius:12}}/>}<label style={labelStyle}>Security code</label><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={verificationCode} onChange={event=>setVerificationCode(event.target.value.replace(/\D/g,''))} required style={{...fieldStyle,textAlign:'center',fontSize:24,letterSpacing:'.3em',fontWeight:800}}/>{alert}<button disabled={busy||verificationCode.length!==6} type="submit" style={{...primaryButton,opacity:(busy||verificationCode.length!==6) ? 0.55 : 1}}>{busy?'Verifying…':'Verify and enter'}</button><button type="button" onClick={async()=>{await supabase.auth.signOut();setStage('password');setVerificationCode('');setMessage('')}} style={{...primaryButton,marginTop:10,background:'#fff',color:'#12395b',border:'1px solid #cbd5e1'}}>Use another account</button></form>);

  return shell(state === 'loading' ? <><h1 style={{fontSize:24,margin:'0 0 8px'}}>Checking your session</h1><p style={{color:'#64748b',margin:0}}>Securely validating access…</p></> : state === 'error' ? <><h1 style={{fontSize:24,margin:'0 0 8px'}}>Sign-in service unavailable</h1><p style={{color:'#64748b'}}>{message}</p><button onClick={()=>window.location.reload()} style={primaryButton}>Retry</button></> : <form onSubmit={login}><h1 style={{fontSize:26,margin:'0 0 8px'}}>Client Login</h1><p style={{color:'#64748b',margin:'0 0 24px'}}>Sign in to your secure OpsVista account.</p><label style={labelStyle}>Email</label><input type="email" autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)} required style={fieldStyle}/><label style={labelStyle}>Password</label><input type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)} required style={{...fieldStyle,marginBottom:8}}/><div style={{textAlign:'right',marginBottom:14}}><button type="button" onClick={()=>{setStage('forgot');setMessage('');setPassword('')}} style={{border:0,background:'transparent',color:'#12395b',fontWeight:800,cursor:'pointer',padding:0}}>Forgot password?</button></div>{alert}<button disabled={busy} type="submit" style={{...primaryButton,opacity:busy ? 0.55 : 1}}>{busy?'Verifying…':'Secure sign in'}</button><p style={{fontSize:12,lineHeight:1.5,color:'#64748b',margin:'18px 0 0'}}>Passwords and two-step verification are handled by OpsVista’s secure identity provider. OpsVista administrators cannot see your password.</p></form>);
}
