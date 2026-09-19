import { useEffect, useMemo, useState } from 'react';
import { activeLocationGrants, effectiveLocations, rolePermissions, type LocationAccessGrant, type OpsVistaRole, type OpsVistaUser } from './accessControl';
import { diffUserChanges, loadManagedUsers, loadManagementAudit, persistManagedUsers, persistManagementAudit, type ManagementAuditEvent } from './managementAudit';

type Props = {
  currentUser: OpsVistaUser;
  onPreviewUser?: (user: OpsVistaUser) => void;
};
type StoreState = 'loading' | 'central' | 'local-dev' | 'error';

const roles = Object.keys(rolePermissions) as OpsVistaRole[];
const creatableRoles = roles.filter(role=>role!=='Founder');
const restaurantLocations = ['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];

function cloneUser(user: OpsVistaUser): OpsVistaUser {
  const parts=(user.name||'').trim().split(/\s+/);
  return {
    ...user,
    firstName:user.firstName||parts[0]||'',
    lastName:user.lastName||parts.slice(1).join(' '),
    locations:[...user.locations],
    locationGrants:user.locationGrants?.map(grant=>({...grant})),
  };
}
function blankUser():OpsVistaUser{
  return {id:`usr-${crypto.randomUUID()}`,name:'',firstName:'',lastName:'',email:'',phone:'',recoveryEmail:'',role:'Location Manager',title:'Restaurant Manager',locations:[],locationGrants:[],active:true};
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

export default function AccessControlPanel({ currentUser, onPreviewUser }: Props) {
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
  const [previewTargetId,setPreviewTargetId] = useState('');
  const previewTarget = managedUsers.find(user=>user.id===previewTargetId);
  const [draft,setDraft] = useState<OpsVistaUser>(()=>cloneUser(currentUser));
  const [reason,setReason] = useState('');
  const [saveMessage,setSaveMessage] = useState('');
  const [auditSearch,setAuditSearch] = useState('');
  const [saving,setSaving] = useState(false);
  const [addingUser,setAddingUser] = useState(false);

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
      const users = usersBody.users ?? [];
      setManagedUsers(users);
      setAudit(auditBody.events ?? []);
      setTargetId(id => id || users[0]?.id || currentUser.id);
      setPreviewTargetId(id => id || users.find(user=>user.active&&user.id!==currentUser.id)?.id || '');
      setStoreState('central');
      setStoreMessage('Central SQL store connected. Changes are shared across authorized management sessions.');
    } catch (error) {
      if (isLocalDev()) {
        const cached = loadManagedUsers();
        const users = cached.length ? cached : [cloneUser(currentUser)];
        setManagedUsers(users);
        setAudit(loadManagementAudit());
        setTargetId(id => id || users[0]?.id || currentUser.id);
        setPreviewTargetId(id => id || users.find(user=>user.active&&user.id!==currentUser.id)?.id || '');
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
    if(addingUser)return;
    const next = managedUsers.find(user=>user.id===targetId) ?? managedUsers[0];
    if (next) setDraft(cloneUser(next));
    setReason(''); setSaveMessage('');
  },[targetId,managedUsers.length,addingUser]);

  const startAddUser=()=>{
    setAddingUser(true);
    setDraft(blankUser());
    setReason('New authorized user');
    setSaveMessage('');
  };
  const cancelAddUser=()=>{
    setAddingUser(false);
    const next=managedUsers.find(user=>user.id===targetId)??managedUsers[0];
    if(next)setDraft(cloneUser(next));
    setReason('');
    setSaveMessage('');
  };

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
    const firstName=(draft.firstName||'').trim(), lastName=(draft.lastName||'').trim();
    const email=(draft.email||'').trim().toLowerCase();
    const normalized={...draft,name:`${firstName} ${lastName}`.trim(),email,firstName,lastName,recoveryEmail:(draft.recoveryEmail||'').trim().toLowerCase(),phone:(draft.phone||'').trim(),title:draft.title.trim()};
    if(!firstName||!lastName||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){setSaveMessage('First name, last name and a valid email are required.');return;}
    if(!normalized.title){setSaveMessage('Position / department is required.');return;}
    if(!rolePermissions[normalized.role].allLocations&&!grantsFor(normalized).some(grant=>grant.type==='Primary')){setSaveMessage('Select a primary location for this role.');return;}
    if (!reason.trim()) { setSaveMessage('A management reason is required before saving.'); return; }
    const events:ManagementAuditEvent[]=addingUser?[{
      id:`mgmt-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      at:new Date().toISOString(),actorId:currentUser.id,actorName:currentUser.name,targetUserId:normalized.id,targetUserName:normalized.name,
      action:'User created',before:'No account',after:`${normalized.role} · ${normalized.email}`,reason:reason.trim()
    }]:target?diffUserChanges(target,normalized,currentUser,reason.trim()):[];
    if (!events.length) { setSaveMessage('No changes to save.'); return; }
    setSaving(true); setSaveMessage('');
    try {
      if (storeState === 'central') {
        const response=await fetch('/api/management/users',{method:'PUT',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:normalized,events})});
        const body=await response.json().catch(()=>({})) as { error?:string };
        if (!response.ok) throw new Error(body.error || 'Unable to save central management changes.');
        const createdId=normalized.id;
        await loadCentral();
        setTargetId(createdId);
      } else if (storeState === 'local-dev') {
        const nextUsers=addingUser?[...managedUsers,cloneUser(normalized)]:managedUsers.map(user=>user.id===normalized.id?cloneUser(normalized):user);
        const nextAudit=[...events.reverse(),...audit];
        setManagedUsers(nextUsers); setAudit(nextAudit);
        persistManagedUsers(nextUsers); persistManagementAudit(nextAudit);
        setTargetId(normalized.id);
      } else throw new Error('Central management store is not available.');
      const wasCreated=addingUser;
      setAddingUser(false);
      setReason('');
      setSaveMessage(wasCreated?'User created. It is now ready for an OpsVista invitation.':`${events.length} audited change${events.length===1?'':'s'} saved.`);
      if(wasCreated)window.dispatchEvent(new CustomEvent('opsvista-user-directory-changed'));
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

    {permissions.canPreviewUsers && onPreviewUser && <section className="panel user-preview-panel">
      <div className="panel-header"><div><h2>Vista previa como usuario</h2><p>Revisa exactamente los módulos y las locaciones autorizadas sin usar la contraseña ni modificar la cuenta.</p></div><span className="count-pill">SOLO LECTURA</span></div>
      <div className="user-preview-body">
        <div><label className="user-preview-label">USUARIO</label><select value={previewTargetId} onChange={event=>setPreviewTargetId(event.target.value)} className="user-preview-select"><option value="" disabled>Selecciona un usuario</option>{managedUsers.filter(user=>user.active&&user.id!==currentUser.id).map(user=><option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}</select></div>
        {previewTarget&&<div className="user-preview-summary">
          <div><span>Rol</span><strong>{previewTarget.role}</strong></div>
          <div><span>Locaciones</span><strong>{rolePermissions[previewTarget.role].allLocations?'Todas las locaciones':effectiveLocations(previewTarget).join(', ')||'Sin locación'}</strong></div>
          <div><span>Módulos</span><strong>{rolePermissions[previewTarget.role].modules.length}</strong></div>
        </div>}
        <div className="user-preview-actions"><p>La vista usa datos reales dentro del alcance seleccionado. Aprobar, editar, enviar, invitar y guardar permanecerán bloqueados.</p><button className="primary" disabled={!previewTarget} onClick={()=>previewTarget&&onPreviewUser(cloneUser(previewTarget))}>Abrir vista previa</button></div>
      </div>
    </section>}

    {permissions.canManageUsers && (target||addingUser) && <section className="panel">
      <div className="panel-header"><div><h2>User Management</h2><p>Add users, assign the correct department/role, manage locations and keep every change audited.</p></div><div style={{display:'flex',gap:8,alignItems:'center'}}><span className="count-pill">{managedUsers.length} users</span>{!addingUser?<button className="primary" onClick={startAddUser}>+ Add User</button>:<button onClick={cancelAddUser}>Cancel</button>}</div></div>
      <div style={{padding:18,display:'grid',gap:16}}>
        {!addingUser&&<div style={{display:'grid',gridTemplateColumns:'minmax(220px,1fr) minmax(180px,.7fr)',gap:12}}><div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>USER</label><select value={targetId} onChange={e=>setTargetId(e.target.value)} style={{width:'100%',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}>{managedUsers.map(user=><option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}</select></div><div style={{display:'flex',alignItems:'end'}}><label style={{display:'flex',alignItems:'center',gap:8,fontWeight:800,padding:'10px 0'}}><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/> Active account</label></div></div>}
        {addingUser&&<div className="detail-block"><label>NEW USER</label><p>Create the authorized profile first. After saving, use User Invitations to send the secure activation link.</p></div>}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:12}}>
          <div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>FIRST NAME</label><input value={draft.firstName??''} onChange={e=>setDraft({...draft,firstName:e.target.value})} style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div>
          <div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>LAST NAME</label><input value={draft.lastName??''} onChange={e=>setDraft({...draft,lastName:e.target.value})} style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div>
          <div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>LOGIN EMAIL</label><input type="email" value={draft.email??''} onChange={e=>setDraft({...draft,email:e.target.value})} style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12}}><div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>ROLE / PROFILE</label><select value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value as OpsVistaRole,locations:rolePermissions[e.target.value as OpsVistaRole].allLocations?[]:draft.locations,locationGrants:rolePermissions[e.target.value as OpsVistaRole].allLocations?[]:draft.locationGrants})} style={{width:'100%',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}>{(addingUser?creatableRoles:roles).map(role=><option key={role}>{role}</option>)}</select></div><div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>POSITION / DEPARTMENT</label><input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div></div>
        {!addingUser&&<div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12}}>
          <div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>PHONE</label><input value={draft.phone??''} onChange={e=>setDraft({...draft,phone:e.target.value})} placeholder="+1 203..." style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div>
          <div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>RECOVERY EMAIL</label><input type="email" value={draft.recoveryEmail??''} onChange={e=>setDraft({...draft,recoveryEmail:e.target.value})} placeholder="Backup email" style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div>
        </div>}
        {!rolePermissions[draft.role].allLocations && <><div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>PRIMARY LOCATION</label><select value={grantsFor(draft).find(grant=>grant.type==='Primary')?.location??''} onChange={e=>changePrimary(e.target.value)} style={{minWidth:260,padding:10,border:'1px solid #ccd9e8',borderRadius:9}}><option value="" disabled>Select location</option>{restaurantLocations.map(location=><option key={location}>{location}</option>)}</select></div><div style={{display:'grid',gap:8}}>{restaurantLocations.filter(location=>location!==grantsFor(draft).find(grant=>grant.type==='Primary')?.location).map(location=>{const grant=grantsFor(draft).find(item=>item.location===location&&item.type==='Additional');return <div key={location} style={{display:'grid',gridTemplateColumns:'minmax(160px,.8fr) minmax(170px,.7fr) minmax(220px,1.2fr)',gap:10,alignItems:'center',padding:'10px 12px',border:'1px solid #e3eaf2',borderRadius:10}}><label style={{display:'flex',alignItems:'center',gap:9,fontWeight:700}}><input type="checkbox" checked={!!grant} onChange={()=>toggleAdditional(location)}/>{location}</label>{grant?<input type="date" title="Access expires" value={grant.expiresAt?grant.expiresAt.slice(0,10):''} onChange={e=>patchGrant(location,{expiresAt:e.target.value?new Date(`${e.target.value}T23:59:59`).toISOString():undefined})} style={{width:'100%',boxSizing:'border-box',padding:8,border:'1px solid #ccd9e8',borderRadius:8}}/>:<span style={{fontSize:12,color:'#94a3b8'}}>No access</span>}{grant?<input value={grant.note??''} onChange={e=>patchGrant(location,{note:e.target.value})} placeholder="Coverage note" style={{width:'100%',boxSizing:'border-box',padding:8,border:'1px solid #ccd9e8',borderRadius:8}}/>:<span/>}</div>})}</div></>}
        <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:10,alignItems:'end'}}><div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>MANAGEMENT REASON · REQUIRED</label><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Example: Covering Stamford while manager is on PTO" style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div><button className="primary" disabled={saving||storeState==='error'||storeState==='loading'} onClick={saveUser}>{saving?'Saving…':addingUser?'Create User':'Save audited changes'}</button></div>
        {saveMessage&&<div className="detail-block"><label>USER MANAGEMENT</label><p>{saveMessage}</p></div>}
      </div>
    </section>}

    <section className="panel"><div className="panel-header"><div><h2>Management Audit Log</h2><p>Append-only record of who changed what, when, why and the before/after value.</p></div><span className="count-pill">{audit.length} events</span></div><div style={{padding:'12px 14px'}}><input value={auditSearch} onChange={e=>setAuditSearch(e.target.value)} placeholder="Search user, manager, location, reason or change…" style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div>{filteredAudit.length?<div>{filteredAudit.map(event=><AuditRow key={event.id} event={event}/>)}</div>:<div style={{padding:22,color:'#64748b'}}>No management changes recorded in this store yet.</div>}</section>

    {!permissions.allLocations && <section className="panel"><div className="panel-header"><div><h2>My location assignments</h2><p>Your home location and any active additional coverage assigned by management.</p></div></div><div style={{padding:18,display:'grid',gap:10}}><div className="impact-box"><span>Primary</span><strong>{primary||'Not assigned'}</strong></div>{active.filter(grant=>grant.type==='Additional').map(grant=><div key={grant.location} className="detail-block"><label>ADDITIONAL ACCESS</label><p><strong>{grant.location}</strong>{grant.expiresAt?` · expires ${new Date(grant.expiresAt).toLocaleString()}`:' · permanent'}{grant.note?` · ${grant.note}`:''}</p></div>)}</div></section>}
  </div>;
}
