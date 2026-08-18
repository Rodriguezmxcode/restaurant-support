import { demoUsers, rolePermissions, type OpsVistaRole, type OpsVistaUser } from './accessControl';

type Props = {
  currentUser: OpsVistaUser;
  onChangeUser: (user: OpsVistaUser) => void;
};

const roles = Object.keys(rolePermissions) as OpsVistaRole[];

export default function AccessControlPanel({ currentUser, onChangeUser }: Props) {
  const permissions = rolePermissions[currentUser.role];
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
          <div className="impact-box"><span>Location scope</span><strong>{permissions.allLocations ? 'All locations' : currentUser.locations.join(', ') || 'None'}</strong></div>
          <div className="impact-box"><span>User management</span><strong>{permissions.canManageUsers ? 'Allowed' : 'Restricted'}</strong></div>
          <div className="impact-box"><span>Financial impact</span><strong>{permissions.canSeeFinancialImpact ? 'Visible' : 'Restricted'}</strong></div>
        </div>
      </div>
    </section>

    <section className="panel">
      <div className="panel-header"><div><h2>Current permissions</h2><p>UI hiding is only one layer; the same permissions are designed to be enforced server-side when authentication is connected.</p></div></div>
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
      <div className="panel-header"><div><h2>Role matrix</h2><p>Baseline policy. Individual exceptions should be explicit and auditable rather than hidden in code.</p></div></div>
      <div style={{overflow:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:850}}>
        <thead><tr>{['Role','Locations','Modules','Evidence review','Automation','Verification','Payments'].map(h => <th key={h} style={{textAlign:'left',padding:12,background:'#eef4fa',fontSize:10}}>{h}</th>)}</tr></thead>
        <tbody>{roles.map(role => { const p=rolePermissions[role]; return <tr key={role}><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}><strong>{role}</strong></td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.allLocations?'All':'Assigned only'}</td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.modules.length}</td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.canReviewEvidence?'Yes':'No'}</td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.canRunAutomation?'Yes':'No'}</td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.canVerifyActions?'Yes':'No'}</td><td style={{padding:12,borderTop:'1px solid #e3eaf2'}}>{p.canApprovePayments?'Yes':'No'}</td></tr>})}</tbody>
      </table></div>
    </section>
  </div>;
}
