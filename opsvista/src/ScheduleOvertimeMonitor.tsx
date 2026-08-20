import { useMemo, useState } from 'react';
import './scheduleOvertimeMonitor.css';

export type ScheduleShift={id:number;start:string;end:string;location:string;role:string};
export type ScheduleEmployee={
  userId:number;employeeName:string;primaryLocation:string;locations:string[];role:string;
  workedHours:number;scheduledHours:number;remainingScheduledHours:number;projectedHours:number;
  overtimeHours:number;hourlyWage:number;estimatedOvertimeCost:number;nextShift?:ScheduleShift;
  status:'Overtime'|'Risk'|'Safe';
};
export type ScheduleLocation={location:string;monitoredEmployees:number;riskEmployees:number;projectedOvertimeHours:number;estimatedOvertimeCost:number};
export type ScheduleRisk={
  start:string;end:string;generatedAt:string;thresholdHours:number;scheduledHours:number;riskEmployees:number;
  projectedOvertimeHours:number;estimatedOvertimeCost:number;employees:ScheduleEmployee[];locations:ScheduleLocation[];
};

type Props={
  data:ScheduleRisk|null;
  error?:string;
  loading:boolean;
  onEscalate?:(item:{location:string;title:string;signal:string;cause:string;recommendation:string;impact:string;severity:'High'|'Medium'|'Low'})=>void;
};

const money=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const dateTime=(value:string)=>new Intl.DateTimeFormat('es-US',{timeZone:'America/New_York',weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date(value));
const initials=(name:string)=>name.split(/\s+/).filter(Boolean).map(part=>part[0]).join('').slice(0,2).toUpperCase();

export default function ScheduleOvertimeMonitor({data,error,loading,onEscalate}:Props){
  const [location,setLocation]=useState('All locations');
  const [alertAt,setAlertAt]=useState(40);
  const [onlyRisk,setOnlyRisk]=useState(false);
  const [selected,setSelected]=useState<ScheduleEmployee|null>(null);
  const [sent,setSent]=useState<number[]>([]);
  const locations=useMemo(()=>data?.locations.map(row=>row.location)||[],[data]);
  const employees=useMemo(()=>((data?.employees||[])
    .filter(row=>location==='All locations'||row.primaryLocation===location||row.locations.includes(location))
    .filter(row=>!onlyRisk||row.projectedHours>=alertAt)
    .sort((a,b)=>b.overtimeHours-a.overtimeHours||b.projectedHours-a.projectedHours)),[data,location,onlyRisk,alertAt]);
  const locationRows=useMemo(()=>location==='All locations'?(data?.locations||[]):(data?.locations||[]).filter(row=>row.location===location),[data,location]);
  const topRisk=employees.filter(row=>row.overtimeHours>0).slice(0,2);
  const send=(employee:ScheduleEmployee)=>{
    onEscalate?.({location:employee.nextShift?.location||employee.primaryLocation,title:`Revisar overtime proyectado · ${employee.employeeName}`,signal:`${employee.employeeName} está proyectado a ${employee.projectedHours.toFixed(1)} h (${employee.overtimeHours.toFixed(1)} h de overtime) para ${data?.start}–${data?.end}.`,cause:`Acumula ${employee.workedHours.toFixed(1)} h trabajadas y todavía tiene ${employee.remainingScheduledHours.toFixed(1)} h programadas por completar.`,recommendation:employee.nextShift?`Revisar o reasignar el turno de ${dateTime(employee.nextShift.start)} en ${employee.nextShift.location} (${employee.nextShift.role}) a una persona calificada que permanezca debajo de 40 horas.`:'Revisar los turnos restantes y reasignar horas a una persona calificada que permanezca debajo de 40 horas.',impact:`${money(employee.estimatedOvertimeCost)} de costo OT estimado a 1.5×`,severity:employee.overtimeHours>=4?'High':'Medium'});
    setSent(current=>current.includes(employee.userId)?current:[...current,employee.userId]);
  };

  if(loading)return <section className="schedule-panel schedule-loading"><strong>Cargando horarios y time punches de 7shifts…</strong><span>Calculando overtime por empleado y ubicación.</span></section>;
  if(error)return <section className="schedule-panel schedule-error"><strong>No fue posible calcular el overtime proyectado</strong><span>{error}</span><small>OpsVista no mostrará estimaciones hasta recibir turnos, empleados, puestos y time punches reales de 7shifts.</small></section>;
  if(!data)return null;

  return <div className="schedule-section">
    <div className="schedule-section-heading"><div><span>7SHIFTS · LIVE SCHEDULE</span><h2>Monitor de overtime por empleado</h2><p>{data.start} → {data.end} · Horas trabajadas + turnos publicados restantes</p></div><div className="schedule-controls"><select value={location} onChange={event=>setLocation(event.target.value)}><option>All locations</option>{locations.map(name=><option key={name}>{name}</option>)}</select><label>Alerta a <select value={alertAt} onChange={event=>setAlertAt(Number(event.target.value))}><option value={36}>36 h</option><option value={38}>38 h</option><option value={40}>40 h</option></select></label><button className={onlyRisk?'active':''} onClick={()=>setOnlyRisk(value=>!value)}>Solo en riesgo</button></div></div>

    <section className="schedule-kpis">
      <article><span className="schedule-kpi-icon blue">◷</span><div><label>HORAS PROGRAMADAS</label><strong>{data.scheduledHours.toFixed(1)}</strong><p>Semana completa · turnos publicados</p></div></article>
      <article><span className="schedule-kpi-icon red">!</span><div><label>EMPLEADOS EN RIESGO</label><strong>{data.riskEmployees}</strong><p>Proyectados sobre 40 horas</p></div></article>
      <article><span className="schedule-kpi-icon amber">↗</span><div><label>OVERTIME PROYECTADO</label><strong>{data.projectedOvertimeHours.toFixed(1)} h</strong><p>Si no se ajustan los turnos</p></div></article>
      <article><span className="schedule-kpi-icon green">$</span><div><label>COSTO OT ESTIMADO</label><strong>{money(data.estimatedOvertimeCost)}</strong><p>Calculado a 1.5×</p></div></article>
    </section>

    <div className="schedule-main-grid">
      <section className="schedule-panel schedule-employee-panel">
        <div className="schedule-panel-head"><div><h3>Horas por empleado</h3><p>Ordenado por overtime proyectado; el cálculo agrega turnos entre ubicaciones.</p></div><span>{employees.length} empleados</span></div>
        <div className="schedule-table-wrap"><table className="schedule-table"><thead><tr><th>Empleado</th><th>Locación / puesto</th><th>Trabajadas</th><th>Programadas</th><th>Proyección</th><th>OT proyectado</th><th>Próximo turno</th><th>Acción</th></tr></thead><tbody>
          {employees.map(employee=>{const progress=Math.min(100,employee.workedHours/40*100);const atRisk=employee.projectedHours>=alertAt;return <tr key={employee.userId} className={employee.overtimeHours>0?'schedule-overtime-row':atRisk?'schedule-risk-row':''}>
            <td><div className="schedule-person"><span>{initials(employee.employeeName)}</span><strong>{employee.employeeName}</strong></div></td>
            <td><strong>{employee.primaryLocation}</strong><small>{employee.role}{employee.locations.length>1?` · ${employee.locations.length} locations`:''}</small></td>
            <td><strong>{employee.workedHours.toFixed(1)} h</strong><div className="schedule-progress"><i style={{width:`${progress}%`}} className={employee.overtimeHours>0?'danger':atRisk?'warning':''}/></div></td>
            <td><strong>{employee.scheduledHours.toFixed(1)} h</strong><small>{employee.remainingScheduledHours.toFixed(1)} h restantes</small></td>
            <td><strong className={employee.overtimeHours>0?'schedule-danger-text':''}>{employee.projectedHours.toFixed(1)} h</strong></td>
            <td>{employee.overtimeHours>0?<><span className="schedule-ot-pill">+{employee.overtimeHours.toFixed(1)} h</span><small>{money(employee.estimatedOvertimeCost)}</small></>:atRisk?<span className="schedule-risk-pill">Cerca del límite</span>:<span className="schedule-safe-pill">Sin OT</span>}</td>
            <td>{employee.nextShift?<><strong>{dateTime(employee.nextShift.start)}</strong><small>{employee.nextShift.location} · {employee.nextShift.role}</small></>:<span>Sin turnos restantes</span>}</td>
            <td><button onClick={()=>setSelected(employee)}>Revisar</button></td>
          </tr>})}
          {!employees.length&&<tr><td colSpan={8}><div className="schedule-empty">No hay empleados que coincidan con estos filtros.</div></td></tr>}
        </tbody></table></div>
      </section>

      <aside className="schedule-panel schedule-location-panel"><div className="schedule-panel-head"><div><h3>Riesgo por locación</h3><p>El overtime se asigna al próximo turno del empleado.</p></div></div><div className="schedule-location-list">{locationRows.map(row=><div key={row.location}><div><strong>{row.location}</strong><small>{row.riskEmployees?`${row.riskEmployees} en riesgo · `:''}{row.monitoredEmployees} monitoreados</small></div><div className={row.projectedOvertimeHours>0?'danger':'safe'}><strong>{row.projectedOvertimeHours.toFixed(1)} h</strong><small>{row.projectedOvertimeHours>0?money(row.estimatedOvertimeCost):'Sin costo OT'}</small></div></div>)}</div>
        <div className="schedule-recommendation"><strong>💡 Acción recomendada</strong>{topRisk.length?<p>Revisa {topRisk.map(row=>row.employeeName).join(' y ')}. Sus próximos turnos concentran {topRisk.reduce((sum,row)=>sum+row.overtimeHours,0).toFixed(1)} h y {money(topRisk.reduce((sum,row)=>sum+row.estimatedOvertimeCost,0))} de overtime proyectado.</p>:<p>No hay empleados proyectados sobre 40 horas con los filtros actuales.</p>}</div>
      </aside>
    </div>

    {selected&&<div className="schedule-drawer-backdrop" onClick={()=>setSelected(null)}><aside className="schedule-drawer" onClick={event=>event.stopPropagation()}><div className="schedule-drawer-head"><div><span>7SHIFTS OVERTIME REVIEW</span><h2>{selected.employeeName}</h2><p>{selected.primaryLocation} · {selected.role}</p></div><button onClick={()=>setSelected(null)}>×</button></div><div className="schedule-drawer-metrics"><div><label>Trabajadas</label><strong>{selected.workedHours.toFixed(1)} h</strong></div><div><label>Restantes</label><strong>{selected.remainingScheduledHours.toFixed(1)} h</strong></div><div><label>Proyección</label><strong>{selected.projectedHours.toFixed(1)} h</strong></div><div><label>OT / costo</label><strong>{selected.overtimeHours.toFixed(1)} h · {money(selected.estimatedOvertimeCost)}</strong></div></div>{selected.nextShift?<div className="schedule-next-shift"><label>PRÓXIMO TURNO PARA REVISAR</label><strong>{dateTime(selected.nextShift.start)} – {dateTime(selected.nextShift.end)}</strong><p>{selected.nextShift.location} · {selected.nextShift.role}</p></div>:<div className="schedule-next-shift"><label>PRÓXIMO TURNO</label><p>No quedan turnos publicados en este periodo.</p></div>}<div className="schedule-drawer-recommendation"><label>RECOMENDACIÓN OPSVISTA</label><p>{selected.overtimeHours>0?'Reasigna el próximo turno a una persona calificada que permanezca debajo de 40 horas. Confirma primero que se conserve la cobertura necesaria del puesto y del rush.':'Mantén el monitoreo. La proyección permanece debajo de 40 horas con los turnos publicados actuales.'}</p></div><div className="schedule-drawer-actions"><button className="primary" disabled={!onEscalate||sent.includes(selected.userId)||selected.overtimeHours<=0} onClick={()=>send(selected)}>{sent.includes(selected.userId)?'Enviado a Action Center':'Enviar a Action Center'}</button><button onClick={()=>setSelected(null)}>Cerrar</button></div></aside></div>}
  </div>;
}
