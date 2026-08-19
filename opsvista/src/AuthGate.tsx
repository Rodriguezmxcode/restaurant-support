import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { demoUsers, type OpsVistaUser } from './accessControl';

type SessionResponse = { authenticated?: boolean; user?: OpsVistaUser & { email?: string }; error?: string };

function bindAuthenticatedUser(user: OpsVistaUser) {
  demoUsers.splice(0, demoUsers.length, user);
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const inviteToken = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('invite') : null;
  const [state, setState] = useState<'loading' | 'authenticated' | 'signed-out' | 'error'>(inviteToken?'signed-out':'loading');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState('');
  const [inviteComplete,setInviteComplete]=useState(false);

  useEffect(() => {
    if(inviteToken) return;
    fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' })
      .then(async response => ({ response, body: await response.json().catch(() => ({})) as SessionResponse }))
      .then(({ response, body }) => {
        if (response.ok && body.user) {
          bindAuthenticatedUser(body.user);
          setState('authenticated');
        } else if (response.status === 401) {
          setState('signed-out');
        } else {
          setMessage(body.error || 'Authentication service unavailable.');
          setState('error');
        }
      })
      .catch(() => {
        const local = ['localhost', '127.0.0.1'].includes(window.location.hostname) || window.location.hostname.endsWith('.local');
        if (local) { setState('authenticated'); return; }
        setMessage('Could not reach the authentication service.');
        setState('error');
      });
  }, [inviteToken]);

  useEffect(() => {
    if (state !== 'authenticated') return;
    const logout = async (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest('button.danger-outline');
      if (!button || button.textContent?.trim() !== 'Cerrar sesión') return;
      event.preventDefault();
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
      window.location.reload();
    };
    document.addEventListener('click', logout, true);
    return () => document.removeEventListener('click', logout, true);
  }, [state]);

  const login = async (event: FormEvent) => {
    event.preventDefault(); setMessage('');
    const response = await fetch('/api/auth/login', { method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password}) });
    const body = await response.json().catch(() => ({})) as SessionResponse;
    if (!response.ok || !body.user) { setMessage(body.error || 'Unable to sign in.'); return; }
    bindAuthenticatedUser(body.user); setPassword(''); setState('authenticated');
  };

  const setupPassword=async(event:FormEvent)=>{
    event.preventDefault(); setMessage('');
    if(password.length<12){setMessage('Password must be at least 12 characters.');return;}
    if(password!==confirmPassword){setMessage('Passwords do not match.');return;}
    const response=await fetch('/api/auth/setup-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:inviteToken,password})});
    const body=await response.json().catch(()=>({})) as {error?:string};
    if(!response.ok){setMessage(body.error||'Unable to set password.');return;}
    setPassword('');setConfirmPassword('');setInviteComplete(true);
    window.history.replaceState({},document.title,window.location.pathname);
  };

  if (state === 'authenticated') return <>{children}</>;

  const shell=(content:ReactNode)=><div style={{minHeight:'100vh',display:'grid',placeItems:'center',background:'#f4f7fb',padding:24,fontFamily:'Inter, system-ui, sans-serif'}}><div style={{width:'min(430px,100%)',background:'#fff',border:'1px solid #dce3ec',borderRadius:18,padding:32,boxShadow:'0 18px 55px rgba(15,23,42,.08)'}}><div style={{display:'flex',alignItems:'center',gap:12,marginBottom:26}}><div style={{width:42,height:42,borderRadius:12,display:'grid',placeItems:'center',background:'#12395b',color:'#fff',fontWeight:800}}>OV</div><div><strong style={{fontSize:20}}>OpsVista</strong><div style={{fontSize:12,color:'#64748b',letterSpacing:'.08em'}}>OPERATIONS CENTER</div></div></div>{content}</div></div>;

  if(inviteToken && !inviteComplete) return shell(<form onSubmit={setupPassword}><h1 style={{fontSize:26,margin:'0 0 8px'}}>Create your OpsVista password</h1><p style={{color:'#64748b',margin:'0 0 24px'}}>This invitation can be used once. Choose a password with at least 12 characters.</p><label style={{display:'block',fontWeight:700,fontSize:13,marginBottom:6}}>Password</label><input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required style={{width:'100%',boxSizing:'border-box',padding:'12px 13px',border:'1px solid #cbd5e1',borderRadius:10,marginBottom:16,fontSize:15}}/><label style={{display:'block',fontWeight:700,fontSize:13,marginBottom:6}}>Confirm password</label><input type="password" autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} required style={{width:'100%',boxSizing:'border-box',padding:'12px 13px',border:'1px solid #cbd5e1',borderRadius:10,marginBottom:12,fontSize:15}}/>{message&&<div style={{padding:'10px 12px',borderRadius:9,background:'#fff1f2',color:'#9f1239',fontSize:13,marginBottom:12}}>{message}</div>}<button type="submit" style={{width:'100%',padding:'12px 16px',borderRadius:10,border:0,background:'#12395b',color:'#fff',fontWeight:800,fontSize:15}}>Create password</button></form>);

  if(inviteComplete) return shell(<><h1 style={{fontSize:26,margin:'0 0 8px'}}>Password created</h1><p style={{color:'#64748b'}}>Your invitation has been accepted. You can now sign in with your email and new password.</p><button onClick={()=>window.location.reload()} style={{width:'100%',padding:'12px 16px',borderRadius:10,border:0,background:'#12395b',color:'#fff',fontWeight:800}}>Continue to sign in</button></>);

  return shell(state === 'loading' ? <><h1 style={{fontSize:24,margin:'0 0 8px'}}>Checking your session</h1><p style={{color:'#64748b',margin:0}}>Securely validating access…</p></> : state === 'error' ? <><h1 style={{fontSize:24,margin:'0 0 8px'}}>Sign-in service unavailable</h1><p style={{color:'#64748b'}}>{message}</p><button onClick={()=>window.location.reload()} style={{width:'100%',padding:'12px 16px',borderRadius:10,border:0,background:'#12395b',color:'#fff',fontWeight:700}}>Retry</button></> : <form onSubmit={login}><h1 style={{fontSize:26,margin:'0 0 8px'}}>Sign in to OpsVista</h1><p style={{color:'#64748b',margin:'0 0 24px'}}>Use your authorized company account.</p><label style={{display:'block',fontWeight:700,fontSize:13,marginBottom:6}}>Email</label><input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required style={{width:'100%',boxSizing:'border-box',padding:'12px 13px',border:'1px solid #cbd5e1',borderRadius:10,marginBottom:16,fontSize:15}}/><label style={{display:'block',fontWeight:700,fontSize:13,marginBottom:6}}>Password</label><input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required style={{width:'100%',boxSizing:'border-box',padding:'12px 13px',border:'1px solid #cbd5e1',borderRadius:10,marginBottom:12,fontSize:15}}/>{message&&<div style={{padding:'10px 12px',borderRadius:9,background:'#fff1f2',color:'#9f1239',fontSize:13,marginBottom:12}}>{message}</div>}<button type="submit" style={{width:'100%',padding:'12px 16px',borderRadius:10,border:0,background:'#12395b',color:'#fff',fontWeight:800,fontSize:15}}>Sign in</button><p style={{fontSize:12,lineHeight:1.5,color:'#64748b',margin:'18px 0 0'}}>Access is controlled by role and authorized locations. Sessions are stored in a secure HttpOnly cookie.</p></form>);
}
