import { useI18n } from './i18n';
import { MEETING_KPIS, meetingWeekLabel, type MeetingAgreement } from '../shared/meetingAgreements';
import type { ActionSeverity } from './actionCenterTypes';

type Draft = {title:string;location:string;category:string;severity:ActionSeverity;signal:string;cause:string;recommendation:string;impact:string};
type Person = {id:string;name:string;title:string};
type Props = {form:Draft;onForm:(value:Draft)=>void;meeting:MeetingAgreement;onMeeting:(value:MeetingAgreement)=>void;locations:string[];people:Person[];ownerId:string;onOwner:(id:string)=>void;dueAt:string;onDue:(date:string)=>void};

export default function SimpleAgreementFields({form,onForm,meeting,onMeeting,locations,people,ownerId,onOwner,dueAt,onDue}:Props) {
  const {t,locale}=useI18n();
  return <div className="simple-agreement-fields">
    <p className="agreement-week">{meetingWeekLabel(meeting.weekStart,locale)}</p>
    <div className="agreement-grid">
      <label>{t('Location','Locación')}<select required value={form.location} onChange={e=>{onForm({...form,location:e.target.value});onOwner('');}}>{locations.map(location=><option key={location}>{location}</option>)}</select></label>
      <label>{t('Topic / KPI','Tema / KPI')}<select value={meeting.kpi} onChange={e=>onMeeting({...meeting,kpi:e.target.value})}>{MEETING_KPIS.map(([key,en,es])=><option key={key} value={key}>{t(en,es)}</option>)}</select></label>
    </div>
    <label>{t('Agreement or task','Acuerdo o tarea')}<input autoFocus required maxLength={300} value={form.title} onChange={e=>onForm({...form,title:e.target.value})} placeholder={t('What needs to be done?','¿Qué hay que hacer?')}/></label>
    <label>{t('Responsible person','Responsable')}<select required value={ownerId} onChange={e=>onOwner(e.target.value)}><option value="">{t('Select a person','Selecciona una persona')}</option>{people.map(person=><option key={person.id} value={person.id}>{person.name} · {person.title}</option>)}</select></label>
    <div className="agreement-grid">
      <label>{t('Start date','Fecha de inicio')}<input type="date" required value={meeting.startAt||''} max={dueAt||undefined} onInput={e=>onMeeting({...meeting,startAt:e.currentTarget.value})}/></label>
      <label>{t('Due date','Fecha de entrega')}<input type="date" required value={dueAt} min={meeting.startAt||undefined} onInput={e=>onDue(e.currentTarget.value)}/></label>
    </div>
    <details className="agreement-optional"><summary>{t('Add details (optional)','Agregar detalles (opcional)')}</summary><div>
      <label>{t('Identified cause','Causa identificada')}<textarea value={form.cause} maxLength={5000} onChange={e=>onForm({...form,cause:e.target.value})} placeholder={t('Why did this happen?','¿Qué originó el pendiente?')}/></label>
      <label>{t('Corrective action / instructions','Acción correctiva / instrucciones')}<textarea value={form.recommendation} maxLength={5000} onChange={e=>onForm({...form,recommendation:e.target.value})} placeholder={t('Add any instructions for the owner.','Agrega indicaciones para el responsable.')}/></label>
      <label>{t('Observed result','Resultado observado')}<textarea value={form.signal} maxLength={5000} onChange={e=>onForm({...form,signal:e.target.value})}/></label>
      <div className="agreement-grid"><label>{t('Priority','Prioridad')}<select value={form.severity} onChange={e=>onForm({...form,severity:e.target.value as ActionSeverity})}><option value="Medium">{t('Normal','Normal')}</option><option value="High">{t('High','Alta')}</option><option value="Low">{t('Low','Baja')}</option></select></label><label>{t('Reported data','Dato reportado')}<select value={meeting.dataQuality} onChange={e=>onMeeting({...meeting,dataQuality:e.target.value as MeetingAgreement['dataQuality']})}><option value="not_recorded">{t('No figure recorded','Sin cifra registrada')}</option><option value="confirmed">{t('Confirmed by user','Confirmado por el usuario')}</option><option value="estimated">{t('Estimated','Estimado')}</option></select></label></div>
      <label>{t('Next review','Próxima revisión')}<textarea value={meeting.nextReview} maxLength={5000} onChange={e=>onMeeting({...meeting,nextReview:e.target.value})} placeholder={t('What result will we review?','¿Qué resultado revisaremos?')}/></label>
      <label>{t('Expected outcome','Resultado esperado')}<input value={form.impact} onChange={e=>onForm({...form,impact:e.target.value})}/></label>
    </div></details>
  </div>;
}
