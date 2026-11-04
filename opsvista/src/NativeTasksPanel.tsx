import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { OpsVistaUser } from './accessControl';
import {
  canManageNativeTasks, canWorkNativeTask, nativeTaskOverdue,
  type NativeTask, type NativeTaskAudit, type NativeTaskDefinition, type NativeTaskPerson,
} from '../shared/nativeTasks';

type Props = { currentUser: OpsVistaUser; allowedLocations: string[]; readOnly: boolean; initialLocation?: string };
type Draft = NativeTaskDefinition & { requestId: string; editingId?: string; version?: number };
const api = '/api/workflows?resource=native_tasks';
const statusName = { Open: 'Pendiente', Completed: 'Completada', Archived: 'Archivada' };
const priorityName = { High: 'Alta', Medium: 'Media', Low: 'Baja' };
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const dayLabel = (value: string) => value ? new Date(`${value}T12:00:00Z`).toLocaleDateString('es-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }) : 'Sin fecha';
const timeLabel = (value: string) => new Date(value).toLocaleString('es-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const blank = (location: string): Draft => ({ title: '', description: '', location, category: 'Operación', position: '', ownerId: '', ownerName: '', dueDate: '', priority: 'Medium', steps: [], requestId: crypto.randomUUID() });

export default function NativeTasksPanel({ currentUser, allowedLocations, readOnly, initialLocation }: Props) {
  const [tasks, setTasks] = useState<NativeTask[]>([]);
  const [people, setPeople] = useState<NativeTaskPerson[]>([]);
  const [location, setLocation] = useState(initialLocation && allowedLocations.includes(initialLocation) ? initialLocation : allowedLocations.length === 1 ? allowedLocations[0] : '');
  const [status, setStatus] = useState('Open');
  const [owner, setOwner] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [audit, setAudit] = useState<NativeTaskAudit[]>([]);
  const [auditError, setAuditError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [reload, setReload] = useState(0);
  const editorRef = useRef<HTMLElement>(null);
  const canManage = !readOnly && canManageNativeTasks(currentUser);
  const scopeKey = allowedLocations.join('|');
  const selected = tasks.find(task => task.id === selectedId);
  const canWork = !readOnly && Boolean(selected && canWorkNativeTask({ ...currentUser, organizationId: selected.organizationId }, selected));

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setConflict(false);
    fetch(`${api}${location ? `&location=${encodeURIComponent(location)}` : ''}`, { credentials: 'include', cache: 'no-store' })
      .then(async response => {
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.tasks) || !Array.isArray(body.people)) throw new Error(body.error || 'No se pudieron cargar las tareas.');
        if (!cancelled) {
          const scoped = (body.tasks as NativeTask[]).filter(task => allowedLocations.includes(task.location));
          setTasks(scoped); setPeople(body.people); setHasMore(Boolean(body.hasMore));
          setSelectedId(id => scoped.some(task => task.id === id) ? id : '');
        }
      }).catch(reason => { if (!cancelled) { setTasks([]); setError(reason instanceof Error ? reason.message : 'No se pudieron cargar las tareas.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [location, scopeKey, currentUser.id, reload]);

  useEffect(() => {
    let cancelled = false;
    setAudit([]); setAuditError('');
    if (!selectedId) return;
    fetch(`${api}&id=${encodeURIComponent(selectedId)}`, { credentials: 'include', cache: 'no-store' })
      .then(async response => {
        const body = await response.json();
        if (!response.ok || !Array.isArray(body.audit)) throw new Error(body.error || 'No se pudo consultar el historial.');
        if (!cancelled) setAudit(body.audit);
      }).catch(reason => { if (!cancelled) setAuditError(reason instanceof Error ? reason.message : 'No se pudo consultar el historial.'); });
    return () => { cancelled = true; };
  }, [selectedId, selected?.version]);
  useEffect(() => { if (draft) { editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); editorRef.current?.querySelector('input')?.focus(); } }, [Boolean(draft)]);

  const scoped = tasks.filter(task => (!owner || (owner === '__none' ? !task.ownerId : task.ownerId === owner)));
  const filtered = scoped.filter(task => {
    const matchStatus = status === 'All' || (status === 'Overdue' ? nativeTaskOverdue(task, today()) : task.status === status);
    return matchStatus && [task.title, task.description, task.category, task.position, task.ownerName].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  }).sort((a, b) => Number(nativeTaskOverdue(b, today())) - Number(nativeTaskOverdue(a, today())) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || b.updatedAt.localeCompare(a.updatedAt));
  const edit = (task: NativeTask, duplicate = false) => {
    setError(''); setNotice('');
    setDraft({ ...task, requestId: crypto.randomUUID(), ...(duplicate ? { editingId: undefined, title: `${task.title} (copia)`.slice(0, 160), dueDate: '', steps: task.steps.map(step => ({ id: crypto.randomUUID(), label: step.label, completed: false })) } : { editingId: task.id, version: task.version }) });
  };
  const write = async (payload: Record<string, unknown>, method: 'POST' | 'PUT') => {
    const response = await fetch(api, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.task) { setConflict(response.status === 409); throw new Error(body.error || 'No se guardó el cambio. Intenta de nuevo.'); }
    const task = body.task as NativeTask;
    setTasks(rows => [task, ...rows.filter(row => row.id !== task.id)].filter(row => !location || row.location === location));
    setSelectedId(task.id); return task;
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!draft || !canManage) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const task = await write({ ...draft, id: draft.editingId, action: 'edit' }, draft.editingId ? 'PUT' : 'POST');
      if (location && task.location !== location) setLocation(task.location);
      setStatus('Open'); setOwner(''); setSearch(''); setDraft(null); setNotice(draft.editingId ? 'Cambios guardados.' : 'Tarea creada en OpsVista.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se guardó la tarea.'); }
    finally { setSaving(false); }
  };
  const change = async (action: string, extra: Record<string, unknown> = {}) => {
    if (!selected || !canWork) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const task = await write({ id: selected.id, version: selected.version, action, ...extra }, 'PUT');
      if (action !== 'check') { setStatus(task.status); setNotice('Cambio guardado en el historial.'); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'No se guardó el cambio.'); }
    finally { setSaving(false); }
  };

  return <div className="native-tasks">
    <section className="panel native-task-heading"><div><h2>Tasks de tu operación</h2><p>Crea tareas y listas de pasos adaptadas a cada locación.</p></div>
      {canManage && <button className="nt-primary" disabled={loading || !allowedLocations.length || Boolean(draft)} onClick={() => { setDraft(blank(location || allowedLocations[0])); setError(''); setNotice(''); }}>+ Nueva tarea</button>}
    </section>
    {readOnly && <p className="nt-notice">Vista previa de usuario · solo lectura.</p>}
    {notice && <p className="nt-notice" role="status">{notice}</p>}
    {error && <p className="nt-error" role="alert">{error}</p>}
    {conflict && <div className="nt-notice"><button disabled={saving} onClick={() => { setDraft(null); setReload(value => value + 1); }}>Descartar cambios sin guardar y actualizar</button></div>}
    {draft && <section className="panel nt-editor" ref={editorRef} aria-labelledby="nt-editor-title">
      <div className="nt-editor-head"><h3 id="nt-editor-title">{draft.editingId ? 'Editar tarea' : 'Nueva tarea'}</h3><button type="button" disabled={saving} onClick={() => setDraft(null)}>Cancelar</button></div>
      <form onSubmit={save}>
        <label>Nombre de la tarea<input required maxLength={160} value={draft.title} placeholder="Ej. Revisar el equipo antes de abrir" onChange={e => setDraft({ ...draft, title: e.target.value })}/></label>
        <label>Instrucciones<textarea rows={3} maxLength={3000} value={draft.description} placeholder="Explica qué se necesita y cómo debe quedar." onChange={e => setDraft({ ...draft, description: e.target.value })}/></label>
        <div className="nt-form-grid">
          <label>Locación<select required value={draft.location} onChange={e => setDraft({ ...draft, location: e.target.value, ownerId: '', ownerName: '' })}>{allowedLocations.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Área o categoría<input required list="nt-categories" maxLength={80} value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}/><datalist id="nt-categories">{['Apertura', 'Cierre', 'Limpieza', 'Mantenimiento', 'Servicio', 'Inventario', 'Administración', 'Seguridad'].map(value => <option key={value} value={value}/>)}</datalist></label>
          <label>Puesto o equipo<input maxLength={120} value={draft.position} placeholder="Ej. Cocina, recepción o ventas" onChange={e => setDraft({ ...draft, position: e.target.value })}/></label>
          <label>Responsable<select value={draft.ownerId} onChange={e => setDraft({ ...draft, ownerId: e.target.value })}><option value="">Sin asignar</option>{people.filter(person => person.allLocations || person.locations.includes(draft.location)).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          <label>Fecha límite<input type="date" value={draft.dueDate} onChange={e => setDraft({ ...draft, dueDate: e.target.value })}/></label>
          <label>Prioridad<select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value as Draft['priority'] })}>{Object.entries(priorityName).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label>
        </div>
        <fieldset className="nt-steps-editor"><legend>Pasos de checklist <span>(opcional)</span></legend>
          {draft.steps.map((step, index) => <div key={step.id} className="nt-step-input"><span>{index + 1}</span><input required maxLength={300} aria-label={`Paso ${index + 1}`} value={step.label} placeholder="Describe este paso" onChange={e => setDraft({ ...draft, steps: draft.steps.map(row => row.id === step.id ? { ...row, label: e.target.value } : row) })}/><button type="button" aria-label={`Quitar paso ${index + 1}`} onClick={() => setDraft({ ...draft, steps: draft.steps.filter(row => row.id !== step.id) })}>Quitar</button></div>)}
          <button type="button" disabled={draft.steps.length >= 50} onClick={() => setDraft({ ...draft, steps: [...draft.steps, { id: crypto.randomUUID(), label: '', completed: false }] })}>+ Agregar paso</button>
        </fieldset>
        <div className="nt-form-footer"><span>{draft.editingId ? 'Los pasos cuyo texto cambie deberán completarse de nuevo.' : 'La tarea se guarda en OpsVista.'}</span><button className="nt-primary" disabled={saving || !canManage}>{saving ? 'Guardando…' : draft.editingId ? 'Guardar cambios' : 'Crear tarea'}</button></div>
      </form>
    </section>}
    <section className="nt-metrics" aria-label="Resumen de tareas">
      {[{ key: 'Open', label: 'Pendientes', count: scoped.filter(task => task.status === 'Open').length }, { key: 'Overdue', label: 'Vencidas', count: scoped.filter(task => nativeTaskOverdue(task, today())).length }, { key: 'Completed', label: 'Completadas', count: scoped.filter(task => task.status === 'Completed').length }].map(item => <button key={item.key} aria-pressed={status === item.key} onClick={() => setStatus(item.key)}><span>{item.label}</span><strong>{loading ? '—' : item.count}</strong></button>)}
    </section>
    <section className="nt-filters" aria-label="Filtrar tareas">
      <input aria-label="Buscar tareas" placeholder="Buscar tarea, área o puesto…" value={search} onChange={e => setSearch(e.target.value)}/>
      <select aria-label="Filtrar por locación" value={location} onChange={e => { setLocation(e.target.value); setSelectedId(''); }}><option value="">Todas mis locaciones</option>{allowedLocations.map(value => <option key={value}>{value}</option>)}</select>
      <select aria-label="Filtrar por responsable" value={owner} onChange={e => setOwner(e.target.value)}><option value="">Todos los responsables</option><option value="__none">Sin asignar</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select>
      <select aria-label="Filtrar por estado" value={status} onChange={e => setStatus(e.target.value)}>{[...Object.entries(statusName), ['Overdue', 'Vencidas'], ['All', 'Todos los estados']].map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select>
      <button disabled={loading || saving} onClick={() => setReload(value => value + 1)}>{loading ? 'Cargando…' : 'Actualizar'}</button>
    </section>
    {hasMore && <p className="nt-notice">Se muestran hasta 1,000 tareas. Selecciona una locación para reducir la consulta.</p>}
    <div className="nt-work-grid">
      <section className="panel nt-list" aria-label="Lista de tareas">
        {!loading && !filtered.length && <div className="nt-empty"><h3>{tasks.length ? 'Sin tareas con estos filtros' : 'Tu operación, tus tareas'}</h3><p>{tasks.length ? 'Cambia el estado, responsable o búsqueda.' : canManage ? 'Usa Nueva tarea para agregar lo que necesita tu equipo.' : 'Aquí aparecerán las tareas de tus locaciones.'}</p></div>}
        {loading && <p className="nt-empty" role="status">Cargando tareas…</p>}
        {filtered.map(task => <button key={task.id} className={`nt-task-row ${selectedId === task.id ? 'selected' : ''}`} aria-pressed={selectedId === task.id} onClick={() => setSelectedId(task.id)}>
          <span className="nt-row-meta">{task.location} · {task.category}{task.position && ` · ${task.position}`}</span><strong>{task.title}</strong>
          <span>{task.ownerName || 'Sin responsable'} · {dayLabel(task.dueDate)}</span>
          <span className="nt-row-tags"><span>{statusName[task.status]}</span>{nativeTaskOverdue(task, today()) && <span className="nt-overdue">Vencida</span>}<span>Prioridad {priorityName[task.priority].toLowerCase()}</span>{task.steps.length > 0 && <span>{task.steps.filter(step => step.completed).length}/{task.steps.length} pasos</span>}</span>
        </button>)}
      </section>
      {selected && <section className="panel nt-detail" aria-label="Detalle de tarea">
        <div className="nt-detail-top"><span>{selected.location} · {selected.category}</span><h3>{selected.title}</h3><p>{selected.description || 'Sin instrucciones adicionales.'}</p></div>
        <dl className="nt-detail-meta"><div><dt>Responsable</dt><dd>{selected.ownerName || 'Sin asignar'}</dd></div><div><dt>Puesto o equipo</dt><dd>{selected.position || 'General'}</dd></div><div><dt>Fecha límite</dt><dd>{dayLabel(selected.dueDate)}</dd></div><div><dt>Estado</dt><dd>{statusName[selected.status]}</dd></div></dl>
        {selected.steps.length > 0 && <div className="nt-checklist"><h4>Checklist</h4>{selected.steps.map(step => <label key={step.id}><input type="checkbox" checked={step.completed} disabled={saving || !canWork || selected.status !== 'Open'} onChange={e => void change('check', { stepId: step.id, completed: e.target.checked })}/><span>{step.label}{step.completedBy && <small>{step.completedBy}{step.completedAt && ` · ${timeLabel(step.completedAt)}`}</small>}</span></label>)}</div>}
        {selected.completedAt && <p className="nt-notice">Completada por {selected.completedBy} · {timeLabel(selected.completedAt)}</p>}
        {!readOnly && <div className="nt-detail-actions">
          {canWork && selected.status === 'Open' && <button className="nt-primary" disabled={saving || selected.steps.some(step => !step.completed)} onClick={() => void change('complete')}>Marcar completada</button>}
          {canManage && <>{selected.status === 'Open' && <button disabled={saving} onClick={() => edit(selected)}>Editar</button>}<button disabled={saving} onClick={() => edit(selected, true)}>Duplicar</button>{selected.status !== 'Open' && <button disabled={saving} onClick={() => void change('reopen')}>Reabrir</button>}{selected.status !== 'Archived' && <button disabled={saving} onClick={() => void change('archive')}>Archivar</button>}</>}
        </div>}
        <div className="nt-audit"><h4>Historial</h4>{auditError && <p role="alert">{auditError}</p>}{audit.map(row => <div key={row.id}><strong>{row.event}</strong><span>{row.actorName} · {timeLabel(row.at)}</span>{row.note && <p>{row.note}</p>}</div>)}</div>
      </section>}
    </div>
  </div>;
}
