import { useEffect, useMemo, useState } from 'react';
import { activeLocationGrants, demoUsers, rolePermissions, seedUsers, type LocationAccessGrant, type OpsVistaRole, type OpsVistaUser } from './accessControl';
import { diffUserChanges, loadManagedUsers, loadManagementAudit, persistManagedUsers, persistManagementAudit, type ManagementAuditEvent } from './managementAudit';

type Props = { currentUser: OpsVistaUser; onChangeUser: (user: OpsVistaUser) => void };
type StoreState = 'loading' | 'central' | 'local-dev' | 'error';

const roles = Object.keys(rolePermissions) as OpsVistaRole[];
const restaurantLocations = ['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];

function cloneUser(user: OpsVistaUser): OpsVistaUser {
  return { ...user, locations:[...user.locations], locationGrants:user.locationGrants?.map(grant=>({...grant})) };
}
function grantsFor(user: OpsVistaUser) {
  return user.locationGrants?.length ? user.locationGrants.map(grant=>({...grant})) : user.locations.map((location,index)=>({location,type:index===0?'Primary':'Additional'} as LocationAccessGrant));
}
function isLocalDev() {
  return typeof window !== 'undefined' && (['localhost','127.0.0.1'].includes(window.location.hostname) || window.location.hostname.endsWith('.local'));
}
function AuditRow({ event }: { event: ManagementAuditEvent }) {
  return <div style={{display:'grid',gridTemplateColumns:'155px minmax(170px,1fr) minmax(220px,1.5fr)',gap:12,padding:'11px 14px',borderTop:'1px solid #e6edf5',alignItems:'start'}}>
    <div><strong style={{fontSize:12}}>{new Date(event.at).toLocaleString()}</strong><div style={{fontSize:11,color:'#64748b',marginTop:3}}>{event.automatic?'AUTOMATIC':'MANUAL'}</div></div>
    <div><strong style={{fontSize:13}}>{event.action}</strong><div style={{fontSize:12,color:'#64748b',marginTop:3}}>{event.targetUserName}{event.location?` · ${event.location}`:''}</div></div>
    <div style={{fontSize:12,lineHeight:1.5}}><div><strong>{event.actorName}</strong> · {event.reason}</div>{(event.before||event.after)&&<div style={{marginTop:4,color:'#526174'}}>{event.before??'—'} → <strong>{event.after??'—'}</strong></div>}</div>
  </div>;
}

export default function AccessControlPanel({ currentUser, onChangeUser }: Props) {
  const permissions = rolePermissions[currentUser.role];
  const grants = grantsFor(currentUser);
  const primary = grants.find(grant=>grant.type==='Primary')?.location ?? '';
  const active = activeLocationGrants(currentUser);

  const [managedUsers,setManagedUsers] = useState<OpsVistaUser[]>([]);
  const [audit,setAudit] = useState<ManagementAuditEvent[]>([]);
  const [storeState,setStoreState] = useState<StoreState>('loading');
  const [storeMessage,setStoreMessage] = useState('Loading central management directory…');
  const [targetId,setTargetId] = useState('');
  const target = managedUsers.find(user=>user.id===targetId) ?? managedUsers[0];
  const [draft,setDraft] = useState<OpsVistaUser>(()=>cloneUser(currentUser));
  const [reason,setReason] = useState('');
  const [saveMessage,setSaveMessage] = useState('');
  const [auditSearch,setAuditSearch] = useState('');
  const [saving,setSaving] = useState(false);

  const loadCentral = async () => {
    setStoreState('loading');
    try {
      const [usersRes,auditRes] = await Promise.all([
        fetch('/api/management/users',{credentials:'include',cache:'no-store'}),
        fetch('/api/management/audit?limit=500',{credentials:'include',cache:'no-store'}),
      ]);
      if (!usersRes.ok || !auditRes.ok) throw new Error(usersRes.status===403?'Corporate user-management permission required.':'Central management store unavailable.');
      const usersBody = await usersRes.json() as { users?: OpsVistaUser[] };
      const auditBody = await auditRes.json() as { events?: ManagementAuditEvent[] };
      const users = usersBody.users?.length ? usersBody.users : seedUsers.map(cloneUser);
      setManagedUsers(users);
      setAudit(auditBody.events ?? []);
      setTargetId(id => id || users[0]?.id || currentUser.id);
      setStoreState('central');
      setStoreMessage('Central SQL store connected. Changes are shared across authorized management sessions.');
    } catch (error) {
      if (isLocalDev()) {
        const users = loadManagedUsers();
        setManagedUsers(users);
        setAudit(loadManagementAudit());
        setTargetId(id => id || users[0]?.id || currentUser.id);
        setStoreState('local-dev');
        setStoreMessage('Local development fallback active. Production fails closed without the central store.');
      } else {
        setManagedUsers([]);
        setAudit([]);
        setStoreState('error');
        setStoreMessage(error instanceof Error ? error.message : 'Central management store unavailable.');
      }
    }
  };

  useEffect(()=>{ void loadCentral(); },[]);
  useEffect(()=>{
    const next = managedUsers.find(user=>user.id===targetId) ?? managedUsers[0];
    if (next) setDraft(cloneUser(next));
    setReason(''); setSaveMessage('');
  },[targetId,managedUsers.length]);

  const changePrimary = (location:string) => {
    const current = grantsFor(draft);
    const without = current.filter(grant=>grant.location!==location).map(grant=>grant.type==='Primary'?{...grant,type:'Additional' as const}:grant);
    const next = [{location,type:'Primary' as const,note:'Home location'},...without];
    setDraft({...draft,locations:Array.from(new Set(next.map(grant=>grant.location))),locationGrants:next});
  };
  const toggleAdditional = (location:string) => {
    const current=grantsFor(draft); const draftPrimary=current.find(grant=>grant.type==='Primary')?.location;
    if (location===draftPrimary) return;
    const exists=current.find(grant=>grant.location===location);
    const next=exists?current.filter(grant=>grant.location!==location):[...current,{location,type:'Additional' as const,note:'Additional management coverage'}];
    setDraft({...draft,locations:Array.from(new Set(next.map(grant=>grant.location))),locationGrants:next});
  };
  const patchGrant=(location:string,patch:Partial<LocationAccessGrant>)=>{
    const next=grantsFor(draft).map(grant=>grant.location===location?{...grant,...patch}:grant);
    setDraft({...draft,locationGrants:next,locations:Array.from(new Set(next.map(grant=>grant.location)))});
  };

  const saveUser = async () => {
    if (!target || !reason.trim()) { setSaveMessage('A management reason is required before saving.'); return; }
    const events=diffUserChanges(target,draft,currentUser,reason.trim());
    if (!events.length) { setSaveMessage('No changes to save.'); return; }
    setSaving(true); setSaveMessage('');
    try {
      if (storeState === 'central') {
        const response=await fetch('/api/management/users',{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:draft,events})});
        const body=await response.json().catch(()=>({})) as { error?:string };
        if (!response.ok) throw new Error(body.error || 'Unable to save central management changes.');
        await loadCentral();
      } else if (storeState === 'local-dev') {
        const nextUsers=managedUsers.map(user=>user.id===draft.id?cloneUser(draft):user);
        const nextAudit=[...events.reverse(),...audit];
        setManagedUsers(nextUsers); setAudit(nextAudit);
        persistManagedUsers(nextUsers); persistManagementAudit(nextAudit);
      } else throw new Error('Central management store is not available.');
      setReason('');
      setSaveMessage(`${events.length} audited change${events.length===1?'':'s'} saved to ${storeState==='central'?'central store':'local development cache'}.`);
    } catch (error) { setSaveMessage(error instanceof Error?error.message:'Unable to save changes.'); }
    finally { setSaving(false); }
  };

  const filteredAudit=useMemo(()=>{
    const q=auditSearch.trim().toLowerCase();
    return !q?audit:audit.filter(event=>[event.action,event.actorName,event.targetUserName,event.location,event.reason,event.before,event.after].filter(Boolean).join(' ').toLowerCase().includes(q));
  },[audit,auditSearch]);

  return <div style={{display:'grid',gap:16}}>
    <section className="panel"><div className="panel-header"><div><h2>Central Management Data Store</h2><p>Authoritative directory and management audit history shared across OpsVista.</p></div><span className="count-pill">{storeState==='central'?'CENTRAL':storeState==='local-dev'?'LOCAL DEV':storeState.toUpperCase()}</span></div><div style={{padding:18}}><div className="detail-block"><label>DATA STORE STATUS</label><p>{storeMessage}</p></div></div></section>

    <section className="panel"><div className="panel-header"><div><h2>Roles & Permissions</h2><p>Least-privilege access by module, department/location and operational responsibility.</p></div><span className="count-pill">{roles.length} roles</span></div><div style={{padding:18,display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}><div className="impact-box"><span>Role</span><strong>{currentUser.role}</strong></div><div className="impact-box"><span>Active location scope</span><strong>{permissions.allLocations?'All locations':active.map(grant=>grant.location).join(', ')||'None'}</strong></div><div className="impact-box"><span>User management</span><strong>{permissions.canManageUsers?'Allowed':'Restricted'}</strong></div><div className="impact-box"><span>Financial impact</span><strong>{permissions.canSeeFinancialImpact?'Visible':'Restricted'}</strong></div></div></section>

    {permissions.canManageUsers && target && <section className="panel">
      <div className="panel-header"><div><h2>User Management</h2><p>Edit role, status, primary location and temporary coverage. Saving requires a reason and writes field-level audit events.</p></div><span className="count-pill">{managedUsers.length} users</span></div>
      <div style={{padding:18,display:'grid',gap:16}}>
        <div style={{display:'grid',gridTemplateColumns:'minmax(220px,1fr) minmax(180px,.7fr)',gap:12}}><div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>USER</label><select value={targetId} onChange={e=>setTargetId(e.target.value)} style={{width:'100%',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}>{managedUsers.map(user=><option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}</select></div><div style={{display:'flex',alignItems:'end'}}><label style={{display:'flex',alignItems:'center',gap:8,fontWeight:800,padding:'10px 0'}}><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/> Active account</label></div></div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12}}><div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>ROLE</label><select value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value as OpsVistaRole})} style={{width:'100%',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}>{roles.map(role=><option key={role}>{role}</option>)}</select></div><div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>TITLE / DEPARTMENT</label><input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div></div>
        {!rolePermissions[draft.role].allLocations && <><div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>PRIMARY LOCATION</label><select value={grantsFor(draft).find(grant=>grant.type==='Primary')?.location??''} onChange={e=>changePrimary(e.target.value)} style={{minWidth:260,padding:10,border:'1px solid #ccd9e8',borderRadius:9}}><option value="" disabled>Select location</option>{restaurantLocations.map(location=><option key={location}>{location}</option>)}</select></div><div style={{display:'grid',gap:8}}>{restaurantLocations.filter(location=>location!==grantsFor(draft).find(grant=>grant.type==='Primary')?.location).map(location=>{const grant=grantsFor(draft).find(item=>item.location===location&&item.type==='Additional');return <div key={location} style={{display:'grid',gridTemplateColumns:'minmax(160px,.8fr) minmax(170px,.7fr) minmax(220px,1.2fr)',gap:10,alignItems:'center',padding:'10px 12px',border:'1px solid #e3eaf2',borderRadius:10}}><label style={{display:'flex',alignItems:'center',gap:9,fontWeight:700}}><input type="checkbox" checked={!!grant} onChange={()=>toggleAdditional(location)}/>{location}</label>{grant?<input type="date" title="Access expires" value={grant.expiresAt?grant.expiresAt.slice(0,10):''} onChange={e=>patchGrant(location,{expiresAt:e.target.value?new Date(`${e.target.value}T23:59:59`).toISOString():undefined})} style={{width:'100%',boxSizing:'border-box',padding:8,border:'1px solid #ccd9e8',borderRadius:8}}/>:<span style={{fontSize:12,color:'#94a3b8'}}>No access</span>}{grant?<input value={grant.note??''} onChange={e=>patchGrant(location,{note:e.target.value})} placeholder="Coverage note" style={{width:'100%',boxSizing:'border-box',padding:8,border:'1px solid #ccd9e8',borderRadius:8}}/>:<span/>}</div>})}</div></>}
        <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:10,alignItems:'end'}}><div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>MANAGEMENT REASON · REQUIRED</label><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Example: Covering Stamford while manager is on PTO" style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div><button className="primary" disabled={saving||storeState==='error'||storeState==='loading'} onClick={saveUser}>{saving?'Saving…':'Save audited changes'}</button></div>
        {saveMessage&&<div className="detail-block"><label>USER MANAGEMENT</label><p>{saveMessage}</p></div>}
      </div>
    </section>}

    <section className="panel"><div className="panel-header"><div><h2>Management Audit Log</h2><p>Append-only record of who changed what, when, why and the before/after value.</p></div><span className="count-pill">{audit.length} events</span></div><div style={{padding:'12px 14px'}}><input value={auditSearch} onChange={e=>setAuditSearch(e.target.value)} placeholder="Search user, manager, location, reason or change…" style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div>{filteredAudit.length?<div>{filteredAudit.map(event=><AuditRow key={event.id} event={event}/>)}</div>:<div style={{padding:22,color:'#64748b'}}>No management changes recorded in this store yet.</div>}</section>

    {!permissions.allLocations && <section className="panel"><div className="panel-header"><div><h2>My location assignments</h2><p>Your home location and any active additional coverage assigned by management.</p></div></div><div style={{padding:18,display:'grid',gap:10}}><div className="impact-box"><span>Primary</span><strong>{primary||'Not assigned'}</strong></div>{active.filter(grant=>grant.type==='Additional').map(grant=><div key={grant.location} className="detail-block"><label>ADDITIONAL ACCESS</label><p><strong>{grant.location}</strong>{grant.expiresAt?` · expires ${new Date(grant.expiresAt).toLocaleString()}`:' · permanent'}{grant.note?` · ${grant.note}`:''}</p></div>)}</div></section>}
  </div>;
}
