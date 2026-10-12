import { useState } from 'react';
import type { OpsVistaUser } from './accessControl';
import type { ExternalEscalation } from './actionCenterTypes';
import EvidenceAuditView from './EvidenceAuditView';
import NativeTasksPanel from './NativeTasksPanel';
import './nativeTasks.css';

type Props = {
  currentUser: OpsVistaUser; allowedLocations: string[]; readOnly: boolean;
  initialSearch?: string; initialRecordId?: string; initialLocation?: string; initialDate?: string;
  canReview?: boolean; reviewerName?: string; onEscalate?: (item: ExternalEscalation) => Promise<unknown> | void;
};

export default function TasksWorkspace(props: Props) {
  const [source, setSource] = useState<'native' | '7shifts'>(props.initialSearch || props.initialRecordId || props.initialDate ? '7shifts' : 'native');
  return <div className="tasks-workspace">
    <nav className="tasks-source-tabs" aria-label="Fuente de tareas">
      <button type="button" aria-pressed={source === 'native'} onClick={() => setSource('native')}>Tasks de OpsVista</button>
      <button type="button" aria-pressed={source === '7shifts'} onClick={() => setSource('7shifts')}>7shifts · Tasks y evidencia</button>
    </nav>
    {source === 'native'
      ? <NativeTasksPanel currentUser={props.currentUser} allowedLocations={props.allowedLocations} readOnly={props.readOnly} initialLocation={props.initialLocation}/>
      : <EvidenceAuditView {...props}/>}
  </div>;
}
