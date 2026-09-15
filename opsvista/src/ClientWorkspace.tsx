import { useState } from 'react';
import type { OpsVistaUser } from './accessControl';
import NativeTasksPanel from './NativeTasksPanel';
import ClientOnboardingPanel from './ClientOnboardingPanel';
import GoogleBusinessIntegrationPanel from './GoogleBusinessIntegrationPanel';
import { supabase } from './supabaseClient';
import './nativeTasks.css';
import './clientWorkspace.css';

export default function ClientWorkspace({ user }: { user: OpsVistaUser }) {
  const [tab, setTab] = useState<'tasks' | 'team' | 'integrations'>('tasks');
  const locations = user.role === 'Corporate' || user.role === 'Maintenance' ? user.organizationLocations || [] : user.locations;
  async function logout() {
    await fetch('/api/workflows?resource=auth_logout', { method: 'POST', credentials: 'include' });
    await supabase.auth.signOut(); window.location.reload();
  }
  return <main className="client-workspace">
    <header className="client-header"><div><span className="client-brand">OpsVista</span><h1>{user.organizationName}</h1><p>{user.name} · {locations.length} locaciones</p></div><button onClick={logout}>Sign out / Salir</button></header>
    <nav aria-label="Workspace">
      <button aria-pressed={tab === 'tasks'} onClick={() => setTab('tasks')}>Tasks & follow-up / Tareas</button>
      {user.role === 'Corporate' && <button aria-pressed={tab === 'team'} onClick={() => setTab('team')}>Team / Equipo</button>}
      {user.role === 'Corporate' && <button aria-pressed={tab === 'integrations'} onClick={() => setTab('integrations')}>Integrations / Integraciones</button>}
      <a href="tel:+12032850281">Support / Soporte</a>
    </nav>
    {tab === 'team' ? <ClientOnboardingPanel currentUser={user}/> : tab === 'integrations' ? <GoogleBusinessIntegrationPanel locations={locations} customerMode/> : <NativeTasksPanel currentUser={user} allowedLocations={locations} readOnly={false}/>}
  </main>;
}
