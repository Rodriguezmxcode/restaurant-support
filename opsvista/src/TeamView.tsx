import { useMemo, useState } from 'react';

export type TeamMember = {
  opsvistaEmployeeId: string;
  toastEmployeeGuid: string;
  firstName: string;
  lastName: string;
  position: string;
  phone?: string;
  email?: string;
  hireDate?: string;
  location: string;
  additionalLocations?: string[];
  status: 'Active' | 'Inactive';
};

type Props = { allowedLocations: string[] };

const empty: TeamMember[] = [];

export default function TeamView({ allowedLocations }: Props) {
  const [members,setMembers] = useState<TeamMember[]>(empty);
  const [query,setQuery]=useState('');
  const [location,setLocation]=useState('All');
  const [status,setStatus]=useState('Active');
  const [syncing,setSyncing]=useState(false);
  const [syncMessage,setSyncMessage]=useState('');

  const visible=useMemo(()=>members.filter(member=>{
    const q=query.trim().toLowerCase();
    const matchesQuery=!q||[member.firstName,member.lastName,member.position,member.email,member.phone,member.toastEmployeeGuid].some(value=>value?.toLowerCase().includes(q));
    return matchesQuery&&(location==='All'||member.location===location)&&(status==='All'||member.status===status);
  }),[members,query,location,status]);

  async function reviewToastChanges(){
    setSyncing(true);setSyncMessage('');
    try{
      const response=await fetch('/api/team/toast-sync?mode=preview',{credentials:'include'});
      const body=await response.json().catch(()=>({}));
      if(!response.ok) throw new Error(body.error||'Toast roster sync is not configured yet.');
      if(Array.isArray(body.employees))setMembers(body.employees.map((employee:any)=>({...employee,position:employee.position||employee.positions?.join(' / ')||'',additionalLocations:(employee.locations||[]).slice(1)})));
      setSyncMessage(`Review ready: ${body.newEmployees??0} new · ${body.updated??0} updated · ${body.deactivated??0} inactive · ${body.missingInformation??0} missing info`);
    }catch(error){setSyncMessage(error instanceof Error?error.message:'Toast roster sync is not configured yet.');}
    finally{setSyncing(false);}
  }

  return <div className="team-view">
    <section className="team-summary">
      <div><span>Total Employees</span><strong>{members.length}</strong></div>
      <div><span>Active</span><strong>{members.filter(x=>x.status==='Active').length}</strong></div>
      <div><span>New Hires</span><strong>—</strong></div>
      <div><span>Missing Information</span><strong>{members.filter(x=>!x.email||!x.phone||!x.hireDate||!x.position).length}</strong></div>
      <div><span>Inactive</span><strong>{members.filter(x=>x.status==='Inactive').length}</strong></div>
    </section>

    <section className="panel team-panel">
      <div className="panel-header">
        <div><h2>Employee Directory</h2><p>Toast is the official employee identity source. OpsVista keeps its own permanent internal ID for operational history.</p></div>
        <button className="team-sync" onClick={reviewToastChanges} disabled={syncing}>{syncing?'Checking Toast…':'↻ Review Toast Changes'}</button>
      </div>
      {syncMessage&&<div className="team-sync-message">{syncMessage}</div>}
      <div className="team-filters">
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search employee, position, email or Toast ID…" />
        <select value={location} onChange={e=>setLocation(e.target.value)}><option>All</option>{allowedLocations.map(x=><option key={x}>{x}</option>)}</select>
        <select value={status} onChange={e=>setStatus(e.target.value)}><option>All</option><option>Active</option><option>Inactive</option></select>
      </div>
      <div className="team-table-wrap">
        <table className="team-table"><thead><tr><th>Employee</th><th>Position</th><th>Location</th><th>Phone</th><th>Email</th><th>Hire Date</th><th>Status</th><th>Toast ID</th></tr></thead>
        <tbody>{visible.map(member=><tr key={member.opsvistaEmployeeId}><td><strong>{member.firstName} {member.lastName}</strong><small>{member.opsvistaEmployeeId}</small></td><td>{member.position}</td><td>{member.location}</td><td>{member.phone||'—'}</td><td>{member.email||'—'}</td><td>{member.hireDate||'—'}</td><td><span className={`team-status ${member.status.toLowerCase()}`}>{member.status}</span></td><td><code>{member.toastEmployeeGuid}</code></td></tr>)}
        {!visible.length&&<tr><td colSpan={8} className="team-empty"><strong>No employee records loaded yet.</strong><span>Use “Review Toast Changes” once the Toast roster endpoint is connected. OpsVista will not create sample employees.</span></td></tr>}</tbody></table>
      </div>
    </section>
  </div>;
}
