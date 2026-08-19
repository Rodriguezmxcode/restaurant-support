import { useEffect, useMemo, useState } from 'react';
import { activeLocationGrants, demoUsers, rolePermissions, type LocationAccessGrant, type OpsVistaRole, type OpsVistaUser } from './accessControl';
import {
  diffUserChanges,
  expireAccessGrants,
  loadManagedUsers,
  loadManagementAudit,
  persistManagedUsers,
  persistManagementAudit,
  type ManagementAuditEvent,
} from './managementAudit';

type Props = {
  currentUser: OpsVistaUser;
  onChangeUser: (user: OpsVistaUser) => void;
};

const roles = Object.keys(rolePermissions) as OpsVistaRole[];
const restaurantLocations = ['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];

function cloneUser(user: OpsVistaUser): OpsVistaUser {
  return { ...user, locations:[...user.locations], locationGrants:user.locationGrants?.map(grant=>({...grant})) };
}

function grantsFor(user: OpsVistaUser) {
  return user.locationGrants?.length
    ? user.locationGrants.map(grant=>({...grant}))
    : user.locations.map((location,index)=>({location,type:index===0?'Primary':'Additional'} as LocationAccessGrant));
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

  const [managedUsers,setManagedUsers] = useState<OpsVistaUser[]>(()=>loadManagedUsers());
  const [audit,setAudit] = useState<ManagementAuditEvent[]>(()=>loadManagementAudit());
  const [targetId,setTargetId] = useState(()=>loadManagedUsers()[0]?.id ?? currentUser.id);
  const target = managedUsers.find(user=>user.id===targetId) ?? managedUsers[0];
  const [draft,setDraft] = useState<OpsVistaUser>(()=>cloneUser(target ?? currentUser));
  const [reason,setReason] = useState('');
  const [saveMessage,setSaveMessage] = useState('');
  const [auditSearch,setAuditSearch] = useState('');

  useEffect(()=>{
    const expired = expireAccessGrants(managedUsers);
    if (!expired.events.length) return;
    const nextAudit = [...expired.events,...audit];
    setManagedUsers(expired.users);
    setAudit(nextAudit);
    persistManagedUsers(expired.users);
    persistManagementAudit(nextAudit);
  },[]);

  useEffect(()=>{
    const next = managedUsers.find(user=>user.id===targetId) ?? managedUsers[0];
    if (next) setDraft(cloneUser(next));
    setReason('');
    setSaveMessage('');
  },[targetId]);

  const changePrimary = (location:string) => {
    const current = grantsFor(draft);
    const without = current.filter(grant=>grant.location!==location).map(grant=>grant.type==='Primary'?{...grant,type:'Additional' as const}:grant);
    const next = [{location,type:'Primary' as const,note:'Home location'},...without];
    setDraft({...draft,locations:Array.from(new Set(next.map(grant=>grant.location))),locationGrants:next});
  };

  const toggleAdditional = (location:string) => {
    const current = grantsFor(draft);
    const draftPrimary=current.find(grant=>grant.type==='Primary')?.location;
    if (location===draftPrimary) return;
    const exists=current.find(grant=>grant.location===location);
    const next=exists?current.filter(grant=>grant.location!==location):[...current,{location,type:'Additional' as const,note:'Additional management coverage'}];
    setDraft({...draft,locations:Array.from(new Set(next.map(grant=>grant.location))),locationGrants:next});
  };

  const patchGrant = (location:string,patch:Partial<LocationAccessGrant>) => {
    const next=grantsFor(draft).map(grant=>grant.location===location?{...grant,...patch}:grant);
    setDraft({...draft,locationGrants:next,locations:Array.from(new Set(next.map(grant=>grant.location)))});
  };

  const saveUser = () => {
    if (!target || !reason.trim()) { setSaveMessage('A management reason is required before saving.'); return; }
    const events=diffUserChanges(target,draft,currentUser,reason.trim());
    if (!events.length) { setSaveMessage('No changes to save.'); return; }
    const nextUsers=managedUsers.map(user=>user.id===draft.id?cloneUser(draft):user);
    const nextAudit=[...events.reverse(),...audit];
    setManagedUsers(nextUsers);
    setAudit(nextAudit);
    persistManagedUsers(nextUsers);
    persistManagementAudit(nextAudit);
    setReason('');
    setSaveMessage(`${events.length} audited change${events.length===1?'':'s'} saved.`);
  };

  const filteredAudit = useMemo(()=>{
    const q=auditSearch.trim().toLowerCase();
    if (!q) return audit;
    return audit.filter(event=>[event.action,event.actorName,event.targetUserName,event.location,event.reason,event.before,event.after].filter(Boolean).join(' ').toLowerCase().includes(q));
  },[audit,auditSearch]);

  return <div style={{display:'grid',gap:16}}>
    <section className="panel">
      <div className="panel-header"><div><h2>Roles & Permissions</h2><p>Least-privilege access by module, department/location and operational responsibility.</p></div><span className="count-pill">{roles.length} roles</span></div>
      <div style={{padding:18,display:'grid',gap:12}}>
        <label style={{fontWeight:800,fontSize:12}}>Current session / preview profile</label>
        <select value={currentUser.id} onChange={e => onChangeUser(demoUsers.find(user => user.id === e.target.value) ?? currentUser)} style={{maxWidth:420,padding:10,border:'1px solid #ccd9e8',borderRadius:9}}>
          {demoUsers.map(user => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}
        </select>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:10}}>
          <div className="impact-box"><span>Role</span><strong>{currentUser.role}</strong></div>
          <div className="impact-box"><span>Active location scope</span><strong>{permissions.allLocations ? 'All locations' : active.map(grant=>grant.location).join(', ') || 'None'}</strong></div>
          <div className="impact-box"><span>User management</span><strong>{permissions.canManageUsers ? 'Allowed' : 'Restricted'}</strong></div>
          <div className="impact-box"><span>Financial impact</span><strong>{permissions.canSeeFinancialImpact ? 'Visible' : 'Restricted'}</strong></div>
        </div>
      </div>
    </section>

    {permissions.canManageUsers && target && <section className="panel">
      <div className="panel-header"><div><h2>User Management v1</h2><p>Edit role, status, home location and temporary coverage. Every saved change creates an immutable management audit event.</p></div><span className="count-pill">{managedUsers.length} users</span></div>
      <div style={{padding:18,display:'grid',gap:16}}>
        <div style={{display:'grid',gridTemplateColumns:'minmax(220px,1fr) minmax(180px,.7fr)',gap:12}}>
          <div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>USER</label><select value={targetId} onChange={e=>setTargetId(e.target.value)} style={{width:'100%',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}>{managedUsers.map(user=><option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}</select></div>
          <div style={{display:'flex',alignItems:'end'}}><label style={{display:'flex',alignItems:'center',gap:8,fontWeight:800,padding:'10px 0'}}><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/> Active account</label></div>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:12}}>
          <div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>ROLE</label><select value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value as OpsVistaRole})} style={{width:'100%',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}>{roles.map(role=><option key={role}>{role}</option>)}</select></div>
          <div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>TITLE / DEPARTMENT</label><input value={draft.title} onChange={e=>setDraft({...draft,title:e.target.value})} style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div>
        </div>

        {!rolePermissions[draft.role].allLocations && <>
          <div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>PRIMARY LOCATION</label><select value={grantsFor(draft).find(grant=>grant.type==='Primary')?.location??''} onChange={e=>changePrimary(e.target.value)} style={{minWidth:260,padding:10,border:'1px solid #ccd9e8',borderRadius:9}}><option value="" disabled>Select location</option>{restaurantLocations.map(location=><option key={location}>{location}</option>)}</select></div>
          <div style={{display:'grid',gap:8}}>{restaurantLocations.filter(location=>location!==grantsFor(draft).find(grant=>grant.type==='Primary')?.location).map(location=>{
            const grant=grantsFor(draft).find(item=>item.location===location&&item.type==='Additional');
            return <div key={location} style={{display:'grid',gridTemplateColumns:'minmax(160px,.8fr) minmax(170px,.7fr) minmax(220px,1.2fr)',gap:10,alignItems:'center',padding:'10px 12px',border:'1px solid #e3eaf2',borderRadius:10}}>
              <label style={{display:'flex',alignItems:'center',gap:9,fontWeight:700}}><input type="checkbox" checked={!!grant} onChange={()=>toggleAdditional(location)}/>{location}</label>
              {grant?<input type="date" title="Access expires" value={grant.expiresAt?grant.expiresAt.slice(0,10):''} onChange={e=>patchGrant(location,{expiresAt:e.target.value?new Date(`${e.target.value}T23:59:59`).toISOString():undefined})} style={{width:'100%',boxSizing:'border-box',padding:8,border:'1px solid #ccd9e8',borderRadius:8}}/>:<span style={{fontSize:12,color:'#94a3b8'}}>No access</span>}
              {grant?<input value={grant.note??''} onChange={e=>patchGrant(location,{note:e.target.value})} placeholder="Reason / coverage note" style={{width:'100%',boxSizing:'border-box',padding:8,border:'1px solid #ccd9e8',borderRadius:8}}/>:<span/>}
            </div>})}</div>
        </>}

        <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:10,alignItems:'end'}}>
          <div><label style={{display:'block',fontWeight:800,fontSize:11,marginBottom:5}}>MANAGEMENT REASON · REQUIRED</label><input value={reason} onChange={e=>setReason(e.target.value)} placeholder="Example: Covering Stamford while manager is on PTO" style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div>
          <button className="primary" onClick={saveUser}>Save audited changes</button>
        </div>
        {saveMessage&&<div className="detail-block"><label>USER MANAGEMENT</label><p>{saveMessage}</p></div>}
        <div className="detail-block"><label>SECURITY NOTE</label><p>This preview stores directory edits and audit events in the browser so the workflow survives refreshes. Production must persist the same records in the centralized server data store before these edits become authoritative for authentication.</p></div>
      </div>
    </section>}

    <section className="panel">
      <div className="panel-header"><div><h2>Management Audit Log</h2><p>Who changed what, when, why, and the before/after value. Temporary-access expiration is recorded automatically.</p></div><span className="count-pill">{audit.length} events</span></div>
      <div style={{padding:'12px 14px'}}><input value={auditSearch} onChange={e=>setAuditSearch(e.target.value)} placeholder="Search user, manager, location, reason or change…" style={{width:'100%',boxSizing:'border-box',padding:10,border:'1px solid #ccd9e8',borderRadius:9}}/></div>
      {filteredAudit.length?<div>{filteredAudit.map(event=><AuditRow key={event.id} event={event}/>)}</div>:<div style={{padding:22,color:'#64748b'}}>No management changes have been recorded yet.</div>}
    </section>

    {!permissions.allLocations && <section className="panel">
      <div className="panel-header"><div><h2>My location assignments</h2><p>Your home location and any active additional coverage assigned by management.</p></div></div>
      <div style={{padding:18,display:'grid',gap:10}}>
        <div className="impact-box"><span>Primary</span><strong>{primary||'Not assigned'}</strong></div>
        {active.filter(grant=>grant.type==='Additional').map(grant=><div key={grant.location} className="detail-block"><label>ADDITIONAL ACCESS</label><p><strong>{grant.location}</strong>{grant.expiresAt?` · expires ${new Date(grant.expiresAt).toLocaleString()}`:' · permanent'}{grant.note?` · ${grant.note}`:''}</p></div>)}
      </div>
    </section>}

    <section className="panel">
      <div className="panel-header"><div><h2>Current permissions</h2><p>The same role and location scope is designed to be enforced in server-side authorization for protected APIs.</p></div></div>
      <div style={{padding:18,display:'grid',gap:12}}>
        <div><strong>Visible modules</strong><div style={{display:'flex',flexWrap:'wrap',gap:7,marginTop:8}}>{permissions.modules.map(module => <span key={module} className="count-pill">{module}</span>)}</div></div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(190px,1fr))',gap:10}}>
          <div className="detail-block"><label>EVIDENCE REVIEW</label><p>{permissions.canReviewEvidence ? 'Approve / reject authorized' : 'No review decisions'}</p></div>
          <div className="detail-block"><label>ACTION AUTOMATION</label><p>{permissions.canRunAutomation ? 'Can run rules' : 'Read generated actions only'}</p></div>
          <div className="detail-block"><label>ACTION VERIFICATION</label><p>{permissions.canVerifyActions ? 'Can verify outcomes' : 'Cannot close verification loop'}</p></div>
          <div className="detail-block"><label>PAYMENTS</label><p>{permissions.canApprovePayments ? 'Approval permitted' : 'Approval restricted'}</p></div>
          <div className="detail-block"><label>COPILOT</label><p>{permissions.canUseCopilot ? 'Available inside authorized scope' : 'Unavailable'}</p></div>
          <div className="detail-block"><label>ESCALATIONS</label><p>{permissions.canEscalateActions ? 'Can create/escalate actions' : 'Read only'}</p></div>
        </div>
      </div>
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Role matrix</h2><p>Baseline policy. Individual exceptions remain explicit, time-bound when needed and auditable.</p></div></div>
      <div style={{overflow:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:850}}>
        <thead><tr>{['Role','Locations','Modules','Evidence review','Automation','Verification','Payments'].map(h => <th key={h} style={{textAlign:'left',padding:12,background:'#eef4fa',fontSize:10}}>{h}</th>)}</tr></thead>
        <tbody>{roles.map(role => { const p=rolePermissions[role]; return <tr key={role}><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}><strong>{role}</strong></td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.allLocations?'All':'Assigned only'}</td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.modules.length}</td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.canReviewEvidence?'Yes':'No'}</td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.canRunAutomation?'Yes':'No'}</td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.canVerifyActions?'Yes':'No'}</td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.canApprovePayments?'Yes':'No'}</td></tr>})}</tbody>
      </table></div>
    </section>
  </div>;
}
