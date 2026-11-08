import { useState } from 'react';
import { useI18n } from './i18n';
import { currentMeetingWeek, MEETING_KPIS, meetingWeekLabel, parseMeetingAgreement, type MeetingAgreement } from '../shared/meetingAgreements';
import './meetingAgreements.css';
export function emptyMeeting(weekStart=currentMeetingWeek()):MeetingAgreement{return{weekStart,kpi:'other',dataQuality:'not_recorded',nextReview:''};}
export function MeetingAgreementFields({value,onChange,lockWeek=false}:{value:MeetingAgreement;onChange:(v:MeetingAgreement)=>void;lockWeek?:boolean}){
 const {t,locale}=useI18n();
 return <div className="meeting-fields"><div className="meeting-fields-grid"><label>{t('Operating week · Wednesday start','Semana operativa · miércoles de inicio')}<input type="date" required disabled={lockWeek} value={value.weekStart} onChange={e=>onChange({...value,weekStart:e.target.value})}/><small>{meetingWeekLabel(value.weekStart,locale)} · {t('Wednesday–Tuesday','Miércoles–martes')}</small></label><label>{t('KPI / topic','KPI / tema')}<select value={value.kpi} onChange={e=>onChange({...value,kpi:e.target.value})}>{MEETING_KPIS.map(([key,en,es])=><option key={key} value={key}>{t(en,es)}</option>)}</select></label><label>{t('Reported data','Dato reportado')}<select value={value.dataQuality} onChange={e=>onChange({...value,dataQuality:e.target.value as MeetingAgreement['dataQuality']})}><option value="not_recorded">{t('No figure recorded','Sin cifra registrada')}</option><option value="confirmed">{t('Confirmed by user','Confirmado por el usuario')}</option><option value="estimated">{t('Estimated','Estimado')}</option></select></label></div><label>{t('What will we review next week?','¿Qué revisaremos la semana siguiente?')}<textarea required maxLength={5000} value={value.nextReview} onChange={e=>onChange({...value,nextReview:e.target.value})} placeholder={t('Define the result, evidence and next check.','Define el resultado esperado, la evidencia y la siguiente revisión.')}/></label></div>
}
export default function MeetingAgreementPanel({meeting,canEdit,busy,onSave}:{meeting?:MeetingAgreement;canEdit:boolean;busy:boolean;onSave:(value:MeetingAgreement)=>Promise<boolean>}){
 const{t,locale}=useI18n();const[draft,setDraft]=useState(()=>meeting||emptyMeeting());const[editing,setEditing]=useState(false);const[error,setError]=useState('');
 const kpi=MEETING_KPIS.find(item=>item[0]===meeting?.kpi);
 return <section className="meeting-context"><div className="meeting-context-heading"><div><span>{t('MEETING AGREEMENT','ACUERDO DE REUNIÓN')}</span><strong>{meeting?meetingWeekLabel(meeting.weekStart,locale):t('Link this action to a weekly meeting','Vincular esta acción a una reunión semanal')}</strong></div>{canEdit&&<button type="button" onClick={()=>{setDraft(meeting||emptyMeeting());setError('');setEditing(!editing)}}>{editing?t('Cancel','Cancelar'):meeting?t('Edit follow-up','Editar seguimiento'):t('Link','Vincular')}</button>}</div>{meeting&&!editing&&<><div className="meeting-context-tags"><b>{kpi?t(kpi[1],kpi[2]):meeting.kpi}</b><span>{meeting.dataQuality==='confirmed'?t('Confirmed by user','Confirmado por el usuario'):meeting.dataQuality==='estimated'?t('Estimated','Estimado'):t('No figure recorded','Sin cifra registrada')}</span></div><label>{t('NEXT WEEK’S REVIEW','REVISIÓN DE LA SIGUIENTE SEMANA')}</label><p>{meeting.nextReview}</p><small>{t('Record the outcome in Verification below. Previous weeks keep the same action and its history.','Registra el resultado en Verificación, más abajo. Las semanas anteriores conservan la misma acción y su historial.')}</small></>}{editing&&<form onSubmit={async e=>{e.preventDefault();setError('');try{const parsed=parseMeetingAgreement(draft);if(await onSave(parsed))setEditing(false);}catch(e){setError(e instanceof Error?e.message:'Invalid meeting')}}}><MeetingAgreementFields value={draft} onChange={setDraft} lockWeek={!!meeting}/>{error&&<p role="alert" className="meeting-error">{error}</p>}<button className="meeting-primary" disabled={busy}>{busy?t('Saving…','Guardando…'):t('Save meeting context','Guardar datos de la reunión')}</button></form>}</section>
}


export function MeetingAuditDetail({value}:{value?:string}) {
 const {t,locale}=useI18n();
 if(!value)return null;
 let entry:{meeting?:MeetingAgreement;ownerName?:string;dueAt?:string;verificationNote?:string;status?:string};
 try{entry=JSON.parse(value);}catch{return null;}
 if(!entry.meeting)return null;
 const kpi=MEETING_KPIS.find(item=>item[0]===entry.meeting?.kpi);
 return <details className="meeting-audit-detail"><summary>{t('Recorded follow-up','Seguimiento registrado')}</summary><dl>
  <dt>{t('Original week','Semana original')}</dt><dd>{meetingWeekLabel(entry.meeting.weekStart,locale)}</dd>
  <dt>{t('KPI','KPI')}</dt><dd>{kpi?t(kpi[1],kpi[2]):entry.meeting.kpi}</dd>
  <dt>{t('Reported data','Dato reportado')}</dt><dd>{entry.meeting.dataQuality==='confirmed'?t('Confirmed by user','Confirmado por el usuario'):entry.meeting.dataQuality==='estimated'?t('Estimated','Estimado'):t('No figure recorded','Sin cifra registrada')}</dd>
  {entry.ownerName&&<><dt>{t('Owner','Responsable')}</dt><dd>{entry.ownerName}</dd></>}
  {entry.dueAt&&<><dt>{t('Deadline','Fecha compromiso')}</dt><dd>{entry.dueAt}</dd></>}
  <dt>{t('Next review','Próxima revisión')}</dt><dd>{entry.meeting.nextReview}</dd>
  {entry.verificationNote&&<><dt>{t('Outcome / evidence','Resultado / evidencia')}</dt><dd>{entry.verificationNote}</dd></>}
 </dl></details>;
}
