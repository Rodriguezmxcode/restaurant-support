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

  const load=async()=>{
    const [usersRes,invRes]=await Promise.all([
      fetch('/api/management/users',{credentials:'include',cache:'no-store'}),
      fetch('/api/management/invitations',{credentials:'include',cache:'no-store'}),
    ]);
    if(!usersRes.ok||!invRes.ok) return;
    const usersBody=await usersRes.json() as {users?:OpsVistaUser[]};
    const invBody=await invRes.json() as {invitations?:Invitation[]};
    const nextUsers=(usersBody.users??[]).filter(user=>user.active&&!!user.email);
    setUsers(nextUsers); setInvitations(invBody.invitations??[]); setUserId(id=>id||nextUsers[0]?.id||'');
  };
  useEffect(()=>{void load();},[]);

  const latestByUser=useMemo(()=>{
    const map=new Map<string,Invitation>();
    for(const item of invitations) if(!map.has(item.userId)) map.set(item.userId,item);
    return map;
  },[invitations]);

  const create=async()=>{
    if(!userId)return;
    setLoading(true);setMessage('');setInviteUrl('');
    const response=await fetch('/api/management/invitations',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId})});
    const body=await response.json().catch(()=>({})) as {error?:string;invitation?:{inviteUrl?:string;expiresAt?:string}};
    if(!response.ok){setMessage(body.error||'Unable to create invitation.');setLoading(false);return;}
    setInviteUrl(body.invitation?.inviteUrl??'');
    setMessage(`Invitation created. Expires ${body.invitation?.expiresAt?new Date(body.invitation.expiresAt).toLocaleString():'in 48 hours'}.`);
    await load();setLoading(false);
  };

  if(!['Founder','Corporate'].includes(currentUser.role)) return null;
  return <section className="panel" style={{marginBottom:16}}>
    <div className="panel-header"><div><h2>Invitations & Password Setup</h2><p>Create a one-time invitation so each user can set their own password. Links expire after 48 hours.</p></div><span className="count-pill">SECURE INVITES</span></div>
    <div style={{padding:18,display:'grid',gap:14}}>
      <div style={{display:'grid',gridTemplateColumns:'minmax(240px,1fr) auto',gap:10,alignItems:'end'}}>
        <div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>USER</label><select value={userId} onChange={e=>{setUserId(e.target.value);setInviteUrl('');setMessage('');}} style={{width:'100%',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}>{users.map(user=><option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}</select></div>
        <button className="primary" disabled={!userId||loading} onClick={create}>{loading?'Creating…':'Create invitation'}</button>
      </div>
      {message&&<div className="detail-block"><label>INVITATION</label><p>{message}</p>{inviteUrl&&<div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:8,marginTop:8}}><input readOnly value={inviteUrl} style={{width:'100%',boxSizing:'border-box',padding:9,border:'1px solid #ccd9e8',borderRadius:8}}/><button onClick={()=>navigator.clipboard?.writeText(inviteUrl)}>Copy link</button></div>}</div>}
      <div style={{display:'grid',gap:8}}>{users.slice(0,20).map(user=>{const inv=latestByUser.get(user.id);return <div key={user.id} style={{display:'grid',gridTemplateColumns:'minmax(180px,1fr) minmax(220px,1.2fr) 110px 170px',gap:10,padding:'9px 10px',border:'1px solid #e3eaf2',borderRadius:9,fontSize:12}}><strong>{user.name}</strong><span>{user.email}</span><span>{inv?.status??'not invited'}</span><span>{inv?new Date(inv.expiresAt).toLocaleString():'—'}</span></div>})}</div>
      <p style={{margin:0,fontSize:12,color:'#64748b'}}>Automatic email delivery is not enabled yet. During testing, use Copy link. No password or raw invitation token is stored in GitHub.</p>
    </div>
  </section>;
}
