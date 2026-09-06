import { useEffect, useMemo, useState } from 'react';
import type { OpsVistaUser } from './accessControl';

type Invitation={id:string;userId:string;email:string;status:string;expiresAt:string;createdAt:string;acceptedAt?:string};
type Props={currentUser:OpsVistaUser};

export default function InvitationManager({currentUser}:Props){
  const [users,setUsers]=useState<OpsVistaUser[]>([]);
  const [invitations,setInvitations]=useState<Invitation[]>([]);
  const [userId,setUserId]=useState('');
  const [message,setMessage]=useState('');
  const [inviteUrl,setInviteUrl]=useState('');
  const [loading,setLoading]=useState(false);
  const [directoryLoading,setDirectoryLoading]=useState(true);

  const load=async()=>{
    setDirectoryLoading(true);
    try {
      const [usersRes,invRes]=await Promise.all([
        fetch('/api/management/users',{credentials:'include',cache:'no-store'}),
        fetch('/api/management/invitations',{credentials:'include',cache:'no-store'}),
      ]);
      const usersBody=await usersRes.json().catch(()=>({})) as {users?:OpsVistaUser[];error?:string};
      if(!usersRes.ok) throw new Error(usersBody.error||'Unable to load the authorized user directory.');
      const nextUsers=(usersBody.users??[]).filter(user=>user.active&&!!user.email&&user.role!=='Founder');
      setUsers(nextUsers);
      setUserId(id=>nextUsers.some(user=>user.id===id)
        ? id
        : nextUsers.find(user=>user.email?.toLowerCase()==='jacob@puertovallartausa.com')?.id||nextUsers[0]?.id||'');

      const invBody=await invRes.json().catch(()=>({})) as {invitations?:Invitation[];error?:string};
      if(invRes.ok) setInvitations(invBody.invitations??[]);
      else setMessage(invBody.error||'Users loaded, but invitation status is temporarily unavailable.');
    } catch(error) {
      setMessage(error instanceof Error?error.message:'Unable to load the invitation directory.');
    } finally {
      setDirectoryLoading(false);
    }
  };
  useEffect(()=>{void load();},[]);

  const latestByUser=useMemo(()=>{
    const map=new Map<string,Invitation>();
    for(const item of invitations) if(!map.has(item.userId)) map.set(item.userId,item);
    return map;
  },[invitations]);

  const create=async()=>{
    if(!userId){setMessage('Select an active user before creating an invitation.');return;}
    setLoading(true);setMessage('');setInviteUrl('');
    try {
      const response=await fetch('/api/management/invitations',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId})});
      const body=await response.json().catch(()=>({})) as {error?:string;invitation?:{inviteUrl?:string;expiresAt?:string}};
      if(!response.ok) throw new Error(body.error||`Unable to create invitation (${response.status}).`);
      setInviteUrl(body.invitation?.inviteUrl??'');
      setMessage(`Invitation created. Expires ${body.invitation?.expiresAt?new Date(body.invitation.expiresAt).toLocaleString():'in 48 hours'}.`);
      await load();
    } catch(error) {
      setMessage(error instanceof Error?error.message:'Unable to create invitation.');
    } finally {
      setLoading(false);
    }
  };

  if(!['Founder','Corporate'].includes(currentUser.role)) return null;
  return <section className="panel" style={{marginBottom:16}}>
    <div className="panel-header"><div><h2>Puerto Vallarta Restaurants · User Invitations</h2><p>Client OPS-0001 · Create a one-time invitation so each client user can establish their own OpsVista password.</p></div><span className="count-pill">CLIENT #1</span></div>
    <div style={{padding:18,display:'grid',gap:14}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}>
        <div className="impact-box"><span>Organization</span><strong>Puerto Vallarta Restaurants</strong></div>
        <div className="impact-box"><span>OpsVista account</span><strong>OPS-0001</strong></div>
        <div className="impact-box"><span>Platform owner</span><strong>Founder separate</strong></div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'minmax(240px,1fr) auto',gap:10,alignItems:'end'}}>
        <div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>CLIENT USER</label><select value={userId} disabled={directoryLoading||!users.length} onChange={e=>{setUserId(e.target.value);setInviteUrl('');setMessage('');}} style={{width:'100%',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}>{directoryLoading?<option value="">Loading users…</option>:!users.length?<option value="">No eligible users available</option>:users.map(user=><option key={user.id} value={user.id}>{user.name} · {user.role} · {user.email}</option>)}</select></div>
        <button className="primary" disabled={!userId||loading||directoryLoading} onClick={create}>{loading?'Creating…':directoryLoading?'Loading…':'Create invitation'}</button>
      </div>
      {message&&<div className="detail-block"><label>INVITATION</label><p>{message}</p>{inviteUrl&&<div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:8,marginTop:8}}><input readOnly value={inviteUrl} style={{width:'100%',boxSizing:'border-box',padding:9,border:'1px solid #ccd9e8',borderRadius:8}}/><button onClick={()=>navigator.clipboard?.writeText(inviteUrl)}>Copy link</button></div>}</div>}
      <div style={{display:'grid',gap:8}}>{users.slice(0,30).map(user=>{const inv=latestByUser.get(user.id);return <div key={user.id} style={{display:'grid',gridTemplateColumns:'minmax(170px,1fr) 120px minmax(220px,1.2fr) 110px 170px',gap:10,padding:'9px 10px',border:'1px solid #e3eaf2',borderRadius:9,fontSize:12}}><strong>{user.name}</strong><span>{user.role}</span><span>{user.email}</span><span>{inv?.status??'not invited'}</span><span>{inv?new Date(inv.expiresAt).toLocaleString():'—'}</span></div>})}</div>
      <p style={{margin:0,fontSize:12,color:'#64748b'}}>Founder credentials are platform-level and intentionally excluded from client invitations. Automatic email delivery is not enabled yet; during testing, use Copy link.</p>
    </div>
  </section>;
}
