import { activeLocationGrants, demoUsers, rolePermissions, type LocationAccessGrant, type OpsVistaRole, type OpsVistaUser } from './accessControl';

type Props = {
  currentUser: OpsVistaUser;
  onChangeUser: (user: OpsVistaUser) => void;
};

const roles = Object.keys(rolePermissions) as OpsVistaRole[];
const restaurantLocations = ['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];

export default function AccessControlPanel({ currentUser, onChangeUser }: Props) {
  const permissions = rolePermissions[currentUser.role];
  const grants = currentUser.locationGrants ?? currentUser.locations.map((location,index)=>({ location, type:index===0?'Primary':'Additional' } as LocationAccessGrant));
  const primary = grants.find(grant=>grant.type==='Primary')?.location ?? '';

  const changePrimary = (location:string) => {
    const without = grants.filter(grant=>grant.location!==location).map(grant=>grant.type==='Primary'?{...grant,type:'Additional' as const}:grant);
    onChangeUser({...currentUser,locations:Array.from(new Set([location,...currentUser.locations.filter(x=>x!==location)])),locationGrants:[{location,type:'Primary'},...without]});
  };

  const toggleAdditional = (location:string) => {
    if (location===primary) return;
    const exists = grants.find(grant=>grant.location===location);
    const next = exists ? grants.filter(grant=>grant.location!==location) : [...grants,{location,type:'Additional' as const}];
    onChangeUser({...currentUser,locations:Array.from(new Set(next.map(grant=>grant.location))),locationGrants:next});
  };

  const setExpiry = (location:string,value:string) => {
    const next = grants.map(grant=>grant.location===location?{...grant,expiresAt:value?new Date(`${value}T23:59:59`).toISOString():undefined}:grant);
    onChangeUser({...currentUser,locationGrants:next});
  };

  const active = activeLocationGrants(currentUser);

  return <div style={{display:'grid',gap:16}}>
    <section className="panel">
      <div className="panel-header"><div><h2>Roles & Permissions v1</h2><p>Least-privilege access by module, location and operational responsibility.</p></div><span className="count-pill">{roles.length} roles</span></div>
      <div style={{padding:18,display:'grid',gap:12}}>
        <label style={{fontWeight:800,fontSize:12}}>Preview access profile</label>
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

    {!permissions.allLocations && <section className="panel">
      <div className="panel-header"><div><h2>Location assignments</h2><p>One home location by default. Add extra restaurants permanently or with an expiration date when the employee is covering another location.</p></div></div>
      <div style={{padding:18,display:'grid',gap:16}}>
        <div><label style={{display:'block',fontWeight:800,fontSize:12,marginBottom:6}}>Primary location</label><select value={primary} onChange={e=>changePrimary(e.target.value)} style={{minWidth:260,padding:10,border:'1px solid #ccd9e8',borderRadius:9}}><option value="" disabled>Select location</option>{restaurantLocations.map(location=><option key={location}>{location}</option>)}</select></div>
        <div style={{display:'grid',gap:8}}>{restaurantLocations.filter(location=>location!==primary).map(location=>{
          const grant=grants.find(item=>item.location===location&&item.type==='Additional');
          return <div key={location} style={{display:'grid',gridTemplateColumns:'minmax(180px,1fr) minmax(180px,220px)',gap:12,alignItems:'center',padding:'10px 12px',border:'1px solid #e3eaf2',borderRadius:10}}>
            <label style={{display:'flex',alignItems:'center',gap:9,fontWeight:700}}><input type="checkbox" checked={!!grant} onChange={()=>toggleAdditional(location)} />{location}</label>
            <div>{grant?<><label style={{display:'block',fontSize:10,fontWeight:800,color:'#64748b',marginBottom:4}}>ACCESS EXPIRES (OPTIONAL)</label><input type="date" value={grant.expiresAt?grant.expiresAt.slice(0,10):''} onChange={e=>setExpiry(location,e.target.value)} style={{width:'100%',boxSizing:'border-box',padding:8,border:'1px solid #ccd9e8',borderRadius:8}} /></>:<span style={{fontSize:12,color:'#94a3b8'}}>No access</span>}</div>
          </div>})}</div>
        <div className="detail-block"><label>HOW IT WORKS</label><p>Primary access remains until edited. Additional access can be permanent or expire automatically. Expired locations are excluded from UI data and server authorization checks.</p></div>
      </div>
    </section>}

    <section className="panel">
      <div className="panel-header"><div><h2>Current permissions</h2><p>UI hiding is only one layer; the same access scope is enforced in server-side authorization for protected APIs.</p></div></div>
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
      <div className="panel-header"><div><h2>Role matrix</h2><p>Baseline policy. Individual location exceptions are explicit, time-bound when needed, and ready for audit history in User Management.</p></div></div>
      <div style={{overflow:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:850}}>
        <thead><tr>{['Role','Locations','Modules','Evidence review','Automation','Verification','Payments'].map(h => <th key={h} style={{textAlign:'left',padding:12,background:'#eef4fa',fontSize:10}}>{h}</th>)}</tr></thead>
        <tbody>{roles.map(role => { const p=rolePermissions[role]; return <tr key={role}><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}><strong>{role}</strong></td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.allLocations?'All':'Assigned only'}</td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.modules.length}</td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.canReviewEvidence?'Yes':'No'}</td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.canRunAutomation?'Yes':'No'}</td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.canVerifyActions?'Yes':'No'}</td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.canApprovePayments?'Yes':'No'}</td></tr>})}</tbody>
      </table></div>
    </section>
  </div>;
}
