import { summarizeAssignments } from './actionAssignments';
import type { ActionRecord } from './actionCenterTypes';
import './actionAssignments.css';

type Props = {
  actions: ActionRecord[]; people: { id: string; name: string; title: string }[]; today: string;
  selectedOwner: string; loading: boolean; onSelect: (owner: string, status: string) => void;
};

export default function ActionAssignmentOverview({ actions, people, today, selectedOwner, loading, onSelect }: Props) {
  const rows = summarizeAssignments(actions, people, today);
  return <section className="panel assignment-overview" aria-labelledby="assignment-overview-title">
    <div className="assignment-overview-head"><div><h2 id="assignment-overview-title">Seguimiento por responsable</h2><p>Selecciona a una persona para revisar sus pendientes y abrir el detalle.</p></div>{selectedOwner && <button onClick={() => onSelect('', 'Active')}>Ver todos</button>}</div>
    {loading ? <p className="assignment-overview-empty" role="status">Cargando asignaciones…</p> : !rows.length ? <p className="assignment-overview-empty">No hay asignaciones en esta locación o búsqueda.</p> : <div className="assignment-table-scroll"><table><caption className="assignment-sr-only">Acciones agrupadas por responsable de seguimiento</caption><thead><tr><th scope="col">Responsable / puesto</th><th scope="col">Pendientes</th><th scope="col">Vencidas</th><th scope="col">En proceso</th><th scope="col">Sin fecha</th><th scope="col">Cerradas</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.key} className={selectedOwner === row.key ? 'selected' : ''}><th scope="row"><button className="assignment-person" aria-pressed={selectedOwner === row.key} onClick={() => onSelect(row.key, 'All')}><strong>{row.name}</strong><span>{row.title}</span><small>{row.locations.join(' · ')}</small></button></th>
        <td><button aria-label={`${row.pending} pendientes de ${row.name}`} onClick={() => onSelect(row.key, 'Active')}>{row.pending}</button></td>
        <td><button className={row.overdue ? 'assignment-late' : ''} aria-label={`${row.overdue} vencidas de ${row.name}`} onClick={() => onSelect(row.key, 'Overdue')}>{row.overdue}</button></td>
        <td><button aria-label={`${row.investigating} en proceso de ${row.name}`} onClick={() => onSelect(row.key, 'Investigating')}>{row.investigating}</button></td>
        <td><button aria-label={`${row.noDate} sin fecha de ${row.name}`} onClick={() => onSelect(row.key, 'No date')}>{row.noDate}</button></td>
        <td><button aria-label={`${row.completed} cerradas de ${row.name}`} onClick={() => onSelect(row.key, 'Completed')}>{row.completed}</button><small>{row.verified} verificadas</small></td>
      </tr>)}</tbody></table></div>}
    <p className="assignment-overview-note">Vencidas: pendientes con fecha anterior a hoy. Verificadas: cerradas con resultado confirmado. Las acciones descartadas quedan fuera de este resumen.</p>
  </section>;
}
