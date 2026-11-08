import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { currentAuthenticatedUser, permissionsFor, type OpsVistaUser } from './accessControl';
import type { ActionRecord } from './actionCenterTypes';
import { currentMeetingWeek, matchesMeetingWeek, MEETING_KPIS, meetingWeekLabel, parseMeetingAgreement, shiftMeetingDate, type MeetingAgreement } from '../shared/meetingAgreements';
import { MeetingAuditDetail } from './MeetingAgreementPanel';
import { useI18n } from './i18n';
import './agreements.css';

type Props = { currentUser: OpsVistaUser; allowedLocations: string[]; readOnly?: boolean; initialRecordId?: string };
type Person = { id: string; name: string; role: string; locations: string[] };
type Audit = { id: string; at: string; actor_name: string; event: string; reason: string; after_value?: string };
type AgreementState = 'pending' | 'progress' | 'blocked' | 'completed' | 'dismissed';
type Draft = { id?: string; expectedUpdatedAt?: string; title: string; location: string; cause: string; recommendation: string; ownerId: string; dueAt: string; meeting: MeetingAgreement; state: AgreementState; outcome: string; signal: string; impact: string };
type Delivery = { status: 'not_requested' | 'accepted' | 'pending' | 'unconfirmed'; message?: string };
const api = '/api/workflows?resource=actions';
const globalRoles = ['Founder', 'Corporate', 'HR', 'Administration', 'Maintenance'];
const stateOf = (action: ActionRecord): AgreementState => action.status === 'Completed' ? 'completed' : action.status === 'Dismissed' ? 'dismissed' : action.meeting?.blocked ? 'blocked' : action.status === 'Investigating' ? 'progress' : 'pending';
const active = (action: ActionRecord) => !['Completed', 'Dismissed'].includes(action.status);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const overdue = (action: ActionRecord) => active(action) && Boolean(action.dueAt && action.dueAt < today());
const emptyDraft = (location: string, week: string): Draft => ({ title: '', location, cause: '', recommendation: '', ownerId: '', dueAt: '', meeting: { weekStart: week, kpi: 'other', dataQuality: 'not_recorded', nextReview: '' }, state: 'pending', outcome: '', signal: '', impact: '' });
const toDraft = (action: ActionRecord): Draft => ({ id: action.id, expectedUpdatedAt: action.updatedAt, title: action.title, location: action.location, cause: action.cause, recommendation: action.recommendation, ownerId: action.ownerId || '', dueAt: action.dueAt || '', meeting: { ...action.meeting! }, state: stateOf(action), outcome: action.verificationNote || '', signal: action.signal, impact: action.impact });

export default function AgreementsView({ currentUser, allowedLocations, readOnly = false, initialRecordId }: Props) {
  const { t, locale } = useI18n();
  const permissions = permissionsFor(currentUser);
  const preview = readOnly || currentAuthenticatedUser().id !== currentUser.id;
  const canEdit = !preview && permissions.canEscalateActions;
  const canVerify = canEdit && permissions.canVerifyActions;
  const [records, setRecords] = useState<ActionRecord[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [week, setWeek] = useState(currentMeetingWeek);
  const [includePrior, setIncludePrior] = useState(true);
  const [location, setLocation] = useState('');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState('active');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(initialRecordId || '');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [auditError, setAuditError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [messageOpen, setMessageOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const editorRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const scopeKey = allowedLocations.join('|');
  const selected = records.find(action => action.id === selectedId);
  const labels: Record<AgreementState, string> = { pending: t('Pending', 'Pendiente'), progress: t('In progress', 'En curso'), blocked: t('Blocked', 'Bloqueado'), completed: t('Completed', 'Completado'), dismissed: t('Archived', 'Archivado') };
  const dateLabel = (value?: string) => value ? new Date(`${value}T12:00:00Z`).toLocaleDateString(locale, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : t('No deadline', 'Sin fecha');
  const eligible = (place: string) => people.filter(person => globalRoles.includes(person.role) || person.locations.includes(place));
  const deliveryNotice = (delivery?: Delivery) => delivery?.status === 'accepted'
    ? t('Notice accepted by a configured channel. This does not confirm that it was read.', 'Aviso aceptado por un canal configurado. Esto no confirma que se haya leído.')
    : delivery?.status === 'pending'
      ? t('Notice pending. Check notification settings before sending again.', 'Aviso pendiente. Revisa la configuración de notificaciones antes de volver a enviarlo.')
      : t('Delivery could not be confirmed. Do not resend until its status has been checked.', 'No se pudo confirmar el envío. No lo repitas hasta revisar su estado.');

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError('');
    fetch(api, { credentials: 'include', cache: 'no-store' }).then(async response => {
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.actions) || !Array.isArray(body.assignees)) throw new Error(body.error || t('Agreements unavailable.', 'No se pudieron cargar los acuerdos.'));
      if (cancelled) return;
      const scoped = (body.actions as ActionRecord[]).filter(action => action.meeting && allowedLocations.includes(action.location));
      setRecords(scoped); setPeople(body.assignees);
      setSelectedId(id => scoped.some(action => action.id === id) ? id : '');
      const target = initialRecordId ? scoped.find(action => action.id === initialRecordId) : undefined;
      if (target?.meeting) { setWeek(target.meeting.weekStart); setStatus('all'); }
    }).catch(reason => { if (!cancelled) { setRecords([]); setPeople([]); setError(reason instanceof Error ? reason.message : 'Agreements unavailable'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scopeKey, currentUser.id, reload, initialRecordId]);
  useEffect(() => {
    let cancelled = false;
    setAudit([]); setAuditError('');
    if (!selectedId) return;
    fetch(`${api}&id=${encodeURIComponent(selectedId)}`, { credentials: 'include', cache: 'no-store' }).then(async response => {
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.audit)) throw new Error(body.error || t('History unavailable.', 'No se pudo cargar el historial.'));
      if (!cancelled) setAudit(body.audit);
    }).catch(reason => { if (!cancelled) setAuditError(reason instanceof Error ? reason.message : 'History unavailable'); });
    return () => { cancelled = true; };
  }, [selectedId, selected?.updatedAt]);
  useEffect(() => {
    if (draft) { editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); editorRef.current?.querySelector('input')?.focus(); }
  }, [Boolean(draft)]);
  useEffect(() => {
    if (selectedId && window.matchMedia('(max-width: 1050px)').matches) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [selectedId]);
  const weeks = useMemo(() => Array.from(new Set([week, currentMeetingWeek(), shiftMeetingDate(currentMeetingWeek(), -7), ...records.map(action => action.meeting!.weekStart)])).sort().reverse(), [records, week]);
  const scoped = records.filter(action => matchesMeetingWeek(action, week, includePrior) && (!location || action.location === location) && (!owner || action.ownerId === owner));
  const filtered = scoped.filter(action => (status === 'all' || (status === 'active' ? active(action) : status === 'overdue' ? overdue(action) : stateOf(action) === status)) && [action.title, action.ownerName, action.cause, action.recommendation].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .sort((a, b) => Number(overdue(b)) - Number(overdue(a)) || (a.dueAt || '9999').localeCompare(b.dueAt || '9999') || b.updatedAt.localeCompare(a.updatedAt));
  const clearFeedback = () => { setError(''); setNotice(''); setConflict(false); };
  const write = async (payload: Record<string, unknown>, method: 'POST' | 'PUT') => {
    let response: Response;
    try { response = await fetch(api, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
    catch { setConflict(true); throw new Error(t('The result could not be confirmed. Refresh the list before trying again.', 'No se pudo confirmar el resultado. Actualiza la lista antes de volver a intentarlo.')); }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.action) { setConflict(response.status === 409 || response.status >= 500 || response.ok); throw new Error(body.error || t('The change could not be confirmed. Refresh before trying again.', 'No se pudo confirmar el cambio. Actualiza antes de volver a intentarlo.')); }
    const action = body.action as ActionRecord;
    setRecords(rows => [action, ...rows.filter(row => row.id !== action.id)]);
    setSelectedId(action.id);
    return { action, delivery: body.notificationDelivery as Delivery | undefined };
  };
  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!draft || !canEdit) return;
    setSaving(true); clearFeedback();
    try {
      if (draft.state === 'completed' && !draft.outcome.trim()) throw new Error(t('Record the result or evidence before completing.', 'Registra el resultado o evidencia antes de completar.'));
      const meeting = parseMeetingAgreement({ ...draft.meeting, blocked: draft.state === 'blocked' });
      const reopening = draft.id && selected?.status === 'Completed' && draft.state !== 'completed';
      const payload = {
        title: draft.title.trim(), location: draft.location, category: 'Reunión semanal', severity: 'Medium',
        signal: draft.signal.trim() || draft.title.trim(), cause: draft.cause.trim() || t('To be identified', 'Por identificar'), recommendation: draft.recommendation.trim(), impact: draft.impact.trim(),
        ownerId: draft.ownerId, dueAt: draft.dueAt, meeting, notifyOwner: false,
        ...(draft.id ? { id: draft.id, expectedUpdatedAt: draft.expectedUpdatedAt, status: draft.state === 'completed' ? 'Completed' : draft.state === 'dismissed' ? 'Dismissed' : ['progress', 'blocked'].includes(draft.state) ? 'Investigating' : 'Assigned', verificationNote: draft.outcome.trim(), ...(reopening ? { verificationStatus: 'Pending', verifiedAt: '' } : {}), reason: 'Agreement and follow-up updated' } : { sources: ['Manual meeting agreement'] }),
      };
      const { action } = await write(payload, draft.id ? 'PUT' : 'POST');
      setDraft(null); setStatus('all'); setOwner(''); setSearch(''); setLocation(action.location); setWeek(meeting.weekStart);
      setNotice(t('Agreement saved. No message was sent.', 'Acuerdo guardado. No se envió ningún mensaje.'));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Save failed'); }
    finally { setSaving(false); }
  };
  const sendNotice = async () => {
    if (!selected || !canEdit) return;
    setSaving(true); clearFeedback();
    try {
      const { delivery } = await write({ id: selected.id, expectedUpdatedAt: selected.updatedAt, notifyOwner: true, reason: 'Owner notice explicitly requested' }, 'PUT');
      setMessageOpen(false); setNotice(deliveryNotice(delivery));
    } catch (reason) { setMessageOpen(false); setError(`${t('Delivery could not be confirmed. Check its status before sending again.', 'No se pudo confirmar el envío. Revisa su estado antes de volver a enviarlo.')} ${reason instanceof Error ? reason.message : ''}`.trim()); }
    finally { setSaving(false); }
  };

  return <div className="agreements-page">
    <section className="ag-heading"><div><span className="ag-eyebrow">{t('WEEKLY MEETING', 'REUNIÓN SEMANAL')}</span><h2>{t('Every agreement, a next step.', 'Cada acuerdo, un siguiente paso.')}</h2><p>{t('A clear action, an owner and a date. Keep progress in one place.', 'Una acción clara, un responsable y una fecha. El avance queda en un solo lugar.')}</p></div>{canEdit && <button className="ag-primary" disabled={loading || saving || !allowedLocations.length || Boolean(draft)} onClick={() => { clearFeedback(); setMessageOpen(false); setDraft(emptyDraft(location || allowedLocations[0], week)); }}>+ {t('New agreement', 'Nuevo acuerdo')}</button>}</section>
    {preview && <p className="ag-notice">{t('User preview · read-only.', 'Vista previa de usuario · solo lectura.')}</p>}
    {error && <p className="ag-error" role="alert">{error}</p>}
    {notice && <p className="ag-notice" role="status">{notice}</p>}
    {conflict && <button disabled={saving} onClick={() => { setDraft(null); setMessageOpen(false); setConflict(false); setReload(value => value + 1); }}>{t('Discard unsaved changes and refresh', 'Descartar cambios sin guardar y actualizar')}</button>}
    {draft && <section className="ag-editor" ref={editorRef} aria-labelledby="ag-editor-title"><header><div><span className="ag-eyebrow">{draft.id ? t('FOLLOW-UP', 'SEGUIMIENTO') : t('NEW AGREEMENT', 'NUEVO ACUERDO')}</span><h3 id="ag-editor-title">{draft.id ? t('Review and update', 'Revisar y actualizar') : t('What are we agreeing to do?', '¿Qué acordamos hacer?')}</h3></div><button type="button" disabled={saving} onClick={() => setDraft(null)}>{t('Cancel', 'Cancelar')}</button></header>
      <form onSubmit={save}>
        <label>{t('Agreement', 'Acuerdo')}<input required maxLength={240} value={draft.title} placeholder={t('What needs to be resolved?', '¿Qué debe resolverse?')} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label>
        <div className="ag-form-grid"><label>{t('Location', 'Locación')}<select disabled={Boolean(draft.id)} required value={draft.location} onChange={e => setDraft({ ...draft, location: e.target.value, ownerId: '' })}>{allowedLocations.map(value => <option key={value}>{value}</option>)}</select></label><label>{t('KPI / topic', 'KPI / tema')}<select value={draft.meeting.kpi} onChange={e => setDraft({ ...draft, meeting: { ...draft.meeting, kpi: e.target.value } })}>{MEETING_KPIS.map(([key, en, es]) => <option key={key} value={key}>{t(en, es)}</option>)}</select></label></div>
        <label>{t('Identified cause (optional)', 'Causa identificada (opcional)')}<textarea rows={2} maxLength={5000} value={draft.cause} onChange={e => setDraft({ ...draft, cause: e.target.value })}/></label>
        <label>{t('Corrective action', 'Acción correctiva')}<textarea required rows={2} maxLength={5000} value={draft.recommendation} placeholder={t('A concrete, measurable action.', 'Una acción concreta y medible.')} onChange={e => setDraft({ ...draft, recommendation: e.target.value })}/></label>
        <div className="ag-form-grid"><label>{t('Owner', 'Responsable')}<select required value={draft.ownerId} onChange={e => setDraft({ ...draft, ownerId: e.target.value })}><option value="">{t('Select a person', 'Selecciona una persona')}</option>{eligible(draft.location).map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label><label>{t('Commitment date', 'Fecha compromiso')}<input required type="date" value={draft.dueAt} onChange={e => setDraft({ ...draft, dueAt: e.target.value })}/></label></div>
        <label>{t('Next review', 'Próxima revisión')}<textarea required rows={2} maxLength={5000} value={draft.meeting.nextReview} placeholder={t('What will we check and what evidence do we need?', '¿Qué revisaremos y con qué evidencia?')} onChange={e => setDraft({ ...draft, meeting: { ...draft.meeting, nextReview: e.target.value } })}/></label>
        {draft.id && <div className="ag-form-grid"><label>{t('Status', 'Estado')}<select value={draft.state} onChange={e => setDraft({ ...draft, state: e.target.value as AgreementState })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value} disabled={value === 'completed' && !canVerify}>{label}</option>)}</select></label><label>{t('Outcome / evidence', 'Resultado / evidencia')}<textarea required={draft.state === 'completed'} rows={2} maxLength={5000} value={draft.outcome} onChange={e => setDraft({ ...draft, outcome: e.target.value })}/></label></div>}
        <details className="ag-extra"><summary>{t('Week and additional context', 'Semana y contexto adicional')}</summary><div className="ag-form-grid"><label>{t('Week starts on Wednesday', 'Miércoles de inicio')}<input type="date" required disabled={Boolean(draft.id)} value={draft.meeting.weekStart} onChange={e => setDraft({ ...draft, meeting: { ...draft.meeting, weekStart: e.target.value } })}/></label><label>{t('Data quality', 'Validación del dato')}<select value={draft.meeting.dataQuality} onChange={e => setDraft({ ...draft, meeting: { ...draft.meeting, dataQuality: e.target.value as MeetingAgreement['dataQuality'] } })}><option value="not_recorded">{t('No figure recorded', 'Sin cifra registrada')}</option><option value="confirmed">{t('Confirmed by user', 'Confirmado por el usuario')}</option><option value="estimated">{t('Estimated', 'Estimado')}</option></select></label></div><label>{t('Observed result (optional)', 'Resultado observado (opcional)')}<textarea maxLength={5000} value={draft.signal} onChange={e => setDraft({ ...draft, signal: e.target.value })}/></label><label>{t('Expected impact (optional)', 'Resultado esperado (opcional)')}<input maxLength={5000} value={draft.impact} onChange={e => setDraft({ ...draft, impact: e.target.value })}/></label></details>
        <footer><span>{t('Save first. You decide whether to notify the owner.', 'Primero guarda. Tú decides si avisas al responsable.')}</span><button className="ag-primary" disabled={saving}>{saving ? t('Saving…', 'Guardando…') : t('Save agreement', 'Guardar acuerdo')}</button></footer>
      </form>
    </section>}
    <section className="ag-week-controls"><label>{t('Operating week', 'Semana operativa')}<select disabled={Boolean(draft) || saving} value={week} onChange={e => { setWeek(e.target.value); setSelectedId(''); setMessageOpen(false); }}>{weeks.map(value => <option key={value} value={value}>{meetingWeekLabel(value, locale)}</option>)}</select></label><label className="ag-checkbox"><input type="checkbox" disabled={Boolean(draft) || saving} checked={includePrior} onChange={e => setIncludePrior(e.target.checked)}/>{t('Include earlier open agreements', 'Incluir pendientes de semanas anteriores')}</label><button disabled={loading || saving || Boolean(draft)} onClick={() => setReload(value => value + 1)}>{t('Refresh', 'Actualizar')}</button></section>
    <section className="ag-metrics" aria-label={t('Agreement summary', 'Resumen de acuerdos')}>{[{ key: 'active', label: t('Open', 'Abiertos'), count: scoped.filter(active).length }, { key: 'overdue', label: t('Overdue', 'Vencidos'), count: scoped.filter(overdue).length }, { key: 'blocked', label: labels.blocked, count: scoped.filter(action => stateOf(action) === 'blocked').length }, { key: 'completed', label: labels.completed, count: scoped.filter(action => stateOf(action) === 'completed').length }].map(item => <button key={item.key} aria-pressed={status === item.key} onClick={() => setStatus(item.key)}><span>{item.label}</span><strong>{loading ? '—' : item.count}</strong></button>)}</section>
    <section className="ag-filters" aria-label={t('Filter agreements', 'Filtrar acuerdos')}><input aria-label={t('Search agreements', 'Buscar acuerdos')} placeholder={t('Search agreement or owner…', 'Buscar acuerdo o responsable…')} value={search} onChange={e => setSearch(e.target.value)}/><select disabled={Boolean(draft) || saving} aria-label={t('Location', 'Locación')} value={location} onChange={e => { setLocation(e.target.value); setSelectedId(''); setMessageOpen(false); }}><option value="">{t('All my locations', 'Todas mis locaciones')}</option>{allowedLocations.map(value => <option key={value}>{value}</option>)}</select><select aria-label={t('Owner', 'Responsable')} value={owner} onChange={e => setOwner(e.target.value)}><option value="">{t('All owners', 'Todos los responsables')}</option>{people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select><select aria-label={t('Status', 'Estado')} value={status} onChange={e => setStatus(e.target.value)}><option value="active">{t('Open agreements', 'Acuerdos abiertos')}</option><option value="all">{t('All statuses', 'Todos los estados')}</option><option value="overdue">{t('Overdue', 'Vencidos')}</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></section>
    <div className={`ag-workspace ${selected ? 'has-selection' : ''}`}>
      <section className="ag-list" aria-label={t('Agreements', 'Acuerdos')}>
        {loading && <p className="ag-empty" role="status">{t('Loading agreements…', 'Cargando acuerdos…')}</p>}
        {!loading && !filtered.length && <div className="ag-empty"><strong>{records.length ? t('No matches for these filters.', 'Sin acuerdos con estos filtros.') : t('Start with one clear agreement.', 'Empieza con un acuerdo claro.')}</strong><p>{records.length ? t('Try another week, owner or status.', 'Prueba otra semana, responsable o estado.') : t('Add the action, owner and commitment date. No sample records are created.', 'Agrega la acción, responsable y fecha compromiso. No se crean registros de ejemplo.')}</p></div>}
        {filtered.map(action => <button key={action.id} className={`ag-card ${selectedId === action.id ? 'selected' : ''}`} aria-pressed={selectedId === action.id} disabled={Boolean(draft) || saving} onClick={() => { setSelectedId(action.id); setMessageOpen(false); clearFeedback(); }}><div className="ag-card-top"><span>{action.location}</span><span className={`ag-status ${stateOf(action)}`}>{labels[stateOf(action)]}</span></div><h3>{action.title}</h3><p>{action.recommendation}</p><footer><strong>{action.ownerName}</strong><span className={overdue(action) ? 'ag-late' : ''}>{dateLabel(action.dueAt)}{overdue(action) && ` · ${t('Overdue', 'Vencido')}`}</span></footer>{action.meeting!.weekStart !== week && <small>{t('From', 'Desde')} {meetingWeekLabel(action.meeting!.weekStart, locale)}</small>}</button>)}
      </section>
      {selected && <section className="ag-detail" ref={detailRef} aria-label={t('Agreement detail', 'Detalle de acuerdo')}><header><div><span className="ag-eyebrow">{selected.location} · {meetingWeekLabel(selected.meeting!.weekStart, locale)}</span><h3>{selected.title}</h3></div><button aria-label={t('Close detail', 'Cerrar detalle')} disabled={saving || Boolean(draft)} onClick={() => { setSelectedId(''); setMessageOpen(false); }}>×</button></header><span className={`ag-status ${stateOf(selected)}`}>{labels[stateOf(selected)]}</span><dl><dt>{t('Owner', 'Responsable')}</dt><dd>{selected.ownerName}</dd><dt>{t('Commitment date', 'Fecha compromiso')}</dt><dd className={overdue(selected) ? 'ag-late' : ''}>{dateLabel(selected.dueAt)}</dd><dt>{t('Identified cause', 'Causa identificada')}</dt><dd>{selected.cause}</dd><dt>{t('Corrective action', 'Acción correctiva')}</dt><dd>{selected.recommendation}</dd><dt>{t('Next review', 'Próxima revisión')}</dt><dd>{selected.meeting!.nextReview}</dd>{selected.verificationNote && <><dt>{t('Outcome / evidence', 'Resultado / evidencia')}</dt><dd>{selected.verificationNote}</dd></>}</dl>
        {canEdit && <div className="ag-detail-actions"><button className="ag-primary" disabled={saving || Boolean(draft)} onClick={() => { clearFeedback(); setMessageOpen(false); setDraft(toDraft(selected)); }}>{t('Review and update', 'Revisar y actualizar')}</button><button disabled={saving || Boolean(draft) || !active(selected)} onClick={() => { clearFeedback(); setMessageOpen(true); }}>{t('Message owner', 'Mensaje al responsable')}</button></div>}
        {messageOpen && <section className="ag-message" aria-labelledby="ag-message-title"><h4 id="ag-message-title">{t('Send a notice to', 'Enviar aviso a')} {selected.ownerName}</h4><p>{t('Only this owner, through their configured OpsVista email and push channels. No automatic reminders or extra recipients.', 'Solo a este responsable, por sus canales de correo y push configurados en OpsVista. Sin recordatorios automáticos ni destinatarios adicionales.')}</p><div className="ag-message-preview"><strong>{selected.location} · {selected.title}</strong><p>{selected.recommendation}</p><span>{t('Due', 'Fecha compromiso')}: {dateLabel(selected.dueAt)}</span><p>{selected.meeting!.nextReview}</p></div><div><button disabled={saving} onClick={() => setMessageOpen(false)}>{t('Cancel', 'Cancelar')}</button><button className="ag-primary" disabled={saving} onClick={() => void sendNotice()}>{saving ? t('Sending…', 'Enviando…') : t('Send notice', 'Enviar aviso')}</button></div></section>}
        <details className="ag-history"><summary>{t('Change history', 'Historial de cambios')}</summary>{auditError && <p role="alert">{auditError}</p>}{audit.map(row => <article key={row.id}><strong>{row.actor_name}</strong><time>{new Date(row.at).toLocaleString(locale, { timeZone: 'America/New_York' })}</time><p>{row.event}</p><MeetingAuditDetail value={row.after_value}/></article>)}</details>
      </section>}
    </div>
  </div>;
}
