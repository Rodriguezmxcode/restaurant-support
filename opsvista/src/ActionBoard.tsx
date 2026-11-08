import { useI18n } from './i18n';
import { actionIsOverdue } from './actionAssignments';
import type { ActionRecord } from './actionCenterTypes';
import { MEETING_KPIS } from '../shared/meetingAgreements';

export default function ActionBoard({actions,selectedId,today,onSelect}:{actions:ActionRecord[];selectedId?:string;today:string;onSelect:(id:string)=>void}) {
  const {t,locale}=useI18n();
  const date=(value?:string)=>value?new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${value.slice(0,10)}T12:00:00Z`)):'—';
  const card=(action:ActionRecord)=>{
    const topic=MEETING_KPIS.find(kpi=>kpi[0]===action.meeting?.kpi);
    return <button type="button" key={action.id} className={`action-board-card ${selectedId===action.id?'selected':''}`} aria-label={`${action.title} · ${t('Open follow-up','Abrir seguimiento')}`} onClick={()=>onSelect(action.id)}>
      <span className="board-card-context">{action.location} · {topic?t(topic[1],topic[2]):action.category}</span>
      <strong>{action.title}</strong><span className="board-card-owner">{action.ownerName||t('Unassigned','Sin asignar')}</span>
      <span className="board-card-dates">{action.meeting?.startAt&&<span>{t('Start','Inicio')} {date(action.meeting.startAt)}</span>}<span>{t('Due','Entrega')} {date(action.dueAt)}</span></span>
      {actionIsOverdue(action,today)&&<span className="agreement-overdue">{t('Overdue','Vencido')}</span>}
      <span className="board-card-open">{t('Open follow-up','Abrir seguimiento')} →</span>
    </button>;
  };
  const columns=[
    {id:'pending',label:t('Pending','Pendiente'),items:actions.filter(action=>['Open','Assigned'].includes(action.status))},
    {id:'progress',label:t('In progress','En progreso'),items:actions.filter(action=>action.status==='Investigating')},
    {id:'completed',label:t('Completed','Completado'),items:actions.filter(action=>action.status==='Completed')},
  ];
  const dismissed=actions.filter(action=>action.status==='Dismissed');
  return <section className="action-board" aria-label={t('Action board','Tablero de acciones')}><div className="action-board-columns">{columns.map(column=><section className={`action-board-column ${column.id}`} key={column.id} aria-label={column.label}><h3>{column.label}<span>{column.items.length}</span></h3><div>{column.items.map(card)}{!column.items.length&&<p className="board-empty">{t('No actions in this stage','Sin acciones en esta etapa')}</p>}</div></section>)}</div>{dismissed.length>0&&<details className="board-dismissed"><summary>{t('Dismissed','Descartados')} · {dismissed.length}</summary><div>{dismissed.map(card)}</div></details>}</section>;
}
