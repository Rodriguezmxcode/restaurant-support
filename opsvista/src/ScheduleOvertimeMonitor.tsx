import { useMemo, useState } from 'react';
import './scheduleOvertimeMonitor.css';
import './scheduleSalary.css';
import type { ExternalEscalation } from './actionCenterTypes';

export type ScheduleShift={id:number;start:string;end:string;location:string;role:string};
export type ScheduleEmployee={
  userId:number;employeeName:string;primaryLocation:string;locations:string[];role:string;
  workedHours:number;scheduledHours:number;remainingScheduledHours:number;projectedHours:number;
  overtimeHours:number;actualOvertimeHours:number;hourlyWage:number|null;estimatedOvertimeCost:number|null;wageSource:'shift_or_punch'|'user_hourly'|'manual_override'|'unavailable';toastMatchStatus:'matched_external_id'|'matched_name'|'ambiguous'|'unmatched';employmentType:'hourly'|'salary';nextShift?:ScheduleShift;
  status:'Overtime'|'Risk'|'Safe'|'Salary';
};
export type ScheduleLocation={location:string;monitoredEmployees:number;riskEmployees:number;actualOvertimeHours:number;additionalProjectedOvertimeHours:number;projectedOvertimeHours:number;salaryOver40Hours:number;unclassifiedToastOvertimeHours:number;unclassifiedToastEmployees:number;estimatedOvertimeCost:number;employeesMissingHourlyWage:number};
export type ScheduleRisk={
  start:string;end:string;generatedAt:string;thresholdHours:number;scheduledHours:number;riskEmployees:number;
  actualOvertimeHours:number;additionalProjectedOvertimeHours:number;projectedOvertimeHours:number;salaryOver40Hours:number;unclassifiedToastOvertimeHours:number;unclassifiedToastEmployees:number;estimatedOvertimeCost:number;employeesMissingHourlyWage:number;unmatchedToastEmployees:number;employees:ScheduleEmployee[];locations:ScheduleLocation[];
};

type Props={
  data:ScheduleRisk|null;
  error?:string;
  loading:boolean;
  onEscalate?:(item:ExternalEscalation)=>Promise<unknown>|void;
};

const money=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
const cost=(value:number|null)=>value===null?'Tarifa no disponible':money(value);
const dateTime=(value:string)=>new Intl.DateTimeFormat('es-US',{timeZone:'America/New_York',weekday:'short',hour:'numeric',minute:'2-digit'}).format(new Date(value));
const initials=(name:string)=>name.split(/\s+/).filter(Boolean).map(part=>part[0]).join('').slice(0,2).toUpperCase();

export default function ScheduleOvertimeMonitor({data,error,loading,onEscalate}:Props){
  const [alertAt,setAlertAt]=useState(40);
  const [onlyRisk,setOnlyRisk]=useState(false);
  const [selected,setSelected]=useState<ScheduleEmployee|null>(null);
  const [sent,setSent]=useState<number[]>([]);
  const employees=useMemo(()=>((data?.employees||[])
    .filter(row=>!onlyRisk||(row.employmentType==='hourly'&&row.projectedHours>=alertAt))
    .sort((a,b)=>a.employmentType!==b.employmentType?(a.employmentType==='salary'?1:-1):b.overtimeHours-a.overtimeHours||b.projectedHours-a.projectedHours)),[data,onlyRisk,alertAt]);
  const locationRows=useMemo(()=>(data?.locations||[]),[data]);
  const topRisk=employees.filter(row=>row.overtimeHours>0).slice(0,2);
  const send=async(employee:ScheduleEmployee)=>{
    if(!onEscalate)return;
    try{await onEscalate({location:employee.nextShift?.location||employee.primaryLocation,title:`Revisar overtime proyectado · ${employee.employeeName}`,signal:`${employee.employeeName} está proyectado a ${employee.projectedHours.toFixed(1)} h (${employee.overtimeHours.toFixed(1)} h de overtime) para ${data?.start}–${data?.end}.`,cause:`Acumula ${employee.workedHours.toFixed(1)} h trabajadas y todavía tiene ${employee.remainingScheduledHours.toFixed(1)} h programadas por completar.`,recommendation:employee.nextShift?`El location manager debe hablar con ${employee.employeeName}, revisar o reasignar el turno de ${dateTime(employee.nextShift.start)} en ${employee.nextShift.location} (${employee.nextShift.role}) y proteger la cobertura necesaria.`:`El location manager debe revisar con ${employee.employeeName} los turnos restantes y reasignar horas a una persona calificada que permanezca debajo de 40 horas.`,impact:employee.estimatedOvertimeCost===null?'Costo OT no disponible porque Toast no entregó una tarifa horaria válida.':`${money(employee.estimatedOvertimeCost)} de costo OT estimado a 1.5×`,severity:employee.overtimeHours>=4?'High':'Medium',accountableName:employee.employeeName,accountableRole:`${employee.role} · overtime exposure`,automationKey:`overtime::${employee.nextShift?.location||employee.primaryLocation}::${employee.userId}::${data?.start}::${data?.end}`,sources:['Toast Labor','7shifts Schedule'],sourceIds:[String(employee.userId)]});setSent(current=>current.includes(employee.userId)?current:[...current,employee.userId]);}catch(error){if(error instanceof Error&&error.message==='Action assignment cancelled')return;}
  };

  if(loading)return <section className="schedule-panel schedule-loading"><strong>Cargando horarios de 7shifts y Time Entries de Toast…</strong><span>Calculando overtime por empleado y ubicación.</span></section>;
  if(error)return <section className="schedule-panel schedule-error"><strong>No fue posible calcular el overtime proyectado</strong><span>{error}</span><small>OpsVista no mostrará estimaciones hasta recibir turnos y puestos reales de 7shifts, más horas y tarifas válidas de Toast.</small></section>;
  if(!data)return null;

  return <div className="schedule-section">
    <div className="schedule-section-heading"><div><span>7SHIFTS · LIVE SCHEDULE</span><h2>Monitor de overtime por empleado</h2><p>{data.start} → {data.end} · Semana operativa miércoles–martes · Horas trabajadas + turnos publicados restantes</p></div><div className="schedule-controls"><label>Alerta a <select value={alertAt} onChange={event=>setAlertAt(Number(event.target.value))}><option value={36}>36 h</option><option value={38}>38 h</option><option value={40}>40 h</option></select></label><button className={onlyRisk?'active':''} onClick={()=>setOnlyRisk(value=>!value)}>Solo en riesgo</button></div></div>

    <section className="schedule-kpis">
      <article><span className="schedule-kpi-icon blue">◷</span><div><label>HORAS PROGRAMADAS</label><strong>{data.scheduledHours.toFixed(1)}</strong><p>7shifts · semana completa publicada</p></div></article>
      <article><span className="schedule-kpi-icon red">!</span><div><label>EMPLEADOS EN RIESGO</label><strong>{data.riskEmployees}</strong><p>Proyectados sobre 40 horas</p></div></article>
      <article><span className="schedule-kpi-icon red">✓</span><div><label>OT PAGADERO · HOURLY</label><strong>{data.actualOvertimeHours.toFixed(1)} h</strong><p>Empleados por hora · ya trabajado</p></div></article>
      <article><span className="schedule-kpi-icon amber">↗</span><div><label>OT ADICIONAL PROGRAMADO</label><strong>{data.additionalProjectedOvertimeHours.toFixed(1)} h</strong><p>Exposición restante en 7shifts</p></div></article>
      <article><span className="schedule-kpi-icon amber">Σ</span><div><label>OT TOTAL PROYECTADO</label><strong>{data.projectedOvertimeHours.toFixed(1)} h</strong><p>Trabajado + exposición adicional</p></div></article>
      <article><span className="schedule-kpi-icon blue">i</span><div><label>SALARIADOS SOBRE 40 H</label><strong>{data.salaryOver40Hours.toFixed(1)} h</strong><p>Solo informativo · no es OT pagadero</p></div></article>
      <article><span className="schedule-kpi-icon amber">?</span><div><label>OT TOAST SIN CLASIFICAR</label><strong>{data.unclassifiedToastOvertimeHours.toFixed(1)} h</strong><p>{data.unclassifiedToastEmployees} empleados sin vínculo visible en 7shifts</p></div></article>
      <article><span className="schedule-kpi-icon green">$</span><div><label>COSTO OT ESTIMADO</label><strong>{money(data.estimatedOvertimeCost)}</strong><p>Toast Time Entries a 1.5×{data.employeesMissingHourlyWage?` · ${data.employeesMissingHourlyWage} sin tarifa`:''}</p></div></article>
    </section>

    <div className="schedule-main-grid">
      <section className="schedule-panel schedule-employee-panel">
        <div className="schedule-panel-head"><div><h3>Horas por empleado</h3><p>Trabajadas y tarifa: Toast Time Entry Management · Programadas: 7shifts.{data.unmatchedToastEmployees?` ${data.unmatchedToastEmployees} empleados requieren vinculación entre sistemas.`:''}</p></div><span>{employees.length} empleados</span></div>
        <div className="schedule-table-wrap"><table className="schedule-table"><thead><tr><th>Empleado</th><th>Locación / puesto</th><th>Trabajadas Toast</th><th>Tarifa Toast</th><th>Programadas 7shifts</th><th>Proyección</th><th>OT proyectado</th><th>Próximo turno</th><th>Acción</th></tr></thead><tbody>
          {employees.map(employee=>{const salaried=employee.employmentType==='salary';const progress=Math.min(100,employee.workedHours/40*100);const atRisk=!salaried&&employee.projectedHours>=alertAt;return <tr key={employee.userId} className={employee.overtimeHours>0?'schedule-overtime-row':atRisk?'schedule-risk-row':salaried?'schedule-salary-row':''}>
            <td><div className="schedule-person"><span>{initials(employee.employeeName)}</span><div><strong>{employee.employeeName}</strong>{salaried?<small>Personal asalariado</small>:employee.wageSource==='manual_override'&&!employee.toastMatchStatus.startsWith('matched')?<small>Tarifa configurada · horas Toast sin vincular</small>:!employee.toastMatchStatus.startsWith('matched')&&<small>Sin vínculo confirmado con Toast</small>}</div></div></td>
            <td><strong>{employee.primaryLocation}</strong><small>{employee.role}{employee.locations.length>1?` · ${employee.locations.length} locations`:''}</small></td>
            <td><strong>{employee.workedHours.toFixed(1)} h</strong><small>{salaried?'Horas de cobertura registradas':`${employee.actualOvertimeHours.toFixed(1)} h OT ya trabajadas`}</small><div className="schedule-progress"><i style={{width:`${progress}%`}} className={employee.overtimeHours>0?'danger':atRisk?'warning':''}/></div></td>
            <td><strong>{salaried?'Salario':employee.hourlyWage===null?'—':`${money(employee.hourlyWage)}/h`}</strong><small>{salaried?'No usa tarifa por hora':employee.hourlyWage===null?'Sin tarifa horaria válida':employee.wageSource==='manual_override'?'Tarifa configurada':'Time Entry Management'}</small></td>
            <td><strong>{employee.scheduledHours.toFixed(1)} h</strong><small>{employee.remainingScheduledHours.toFixed(1)} h restantes</small></td>
            <td><strong className={employee.overtimeHours>0?'schedule-danger-text':''}>{employee.projectedHours.toFixed(1)} h</strong>{salaried&&<small>Cobertura asalariada</small>}</td>
            <td>{salaried?<span className="schedule-salary-pill">Salario · OT no aplica</span>:employee.overtimeHours>0?<><span className="schedule-ot-pill">+{employee.overtimeHours.toFixed(1)} h</span><small>{cost(employee.estimatedOvertimeCost)}</small></>:atRisk?<span className="schedule-risk-pill">Cerca del límite</span>:<span className="schedule-safe-pill">Sin OT</span>}</td>
            <td>{employee.nextShift?<><strong>{dateTime(employee.nextShift.start)}</strong><small>{employee.nextShift.location} · {employee.nextShift.role}</small></>:<span>Sin turnos restantes</span>}</td>
            <td><button disabled={salaried} onClick={()=>setSelected(employee)}>{salaried?'Salario':'Revisar'}</button></td>
          </tr>})}
          {!employees.length&&<tr><td colSpan={9}><div className="schedule-empty">No hay empleados que coincidan con estos filtros.</div></td></tr>}
        </tbody></table></div>
      </section>

      <aside className="schedule-panel schedule-location-panel"><div className="schedule-panel-head"><div><h3>Riesgo por locación</h3><p>Separa OT hourly pagadero, horas asalariadas y registros Toast pendientes de clasificar.</p></div></div><div className="schedule-location-list">{locationRows.map(row=><div key={row.location}><div><strong>{row.location}</strong><small>{row.riskEmployees?`${row.riskEmployees} hourly en riesgo · `:''}{row.monitoredEmployees} monitoreados</small></div><div className={row.projectedOvertimeHours>0?'danger':'safe'}><strong>{row.projectedOvertimeHours.toFixed(1)} h OT hourly total</strong><small>{row.actualOvertimeHours.toFixed(1)} pagaderas · {row.additionalProjectedOvertimeHours.toFixed(1)} adicionales · {money(row.estimatedOvertimeCost)}{row.employeesMissingHourlyWage?` · ${row.employeesMissingHourlyWage} sin tarifa`:''}</small><small>{row.salaryOver40Hours.toFixed(1)} h asalariadas sobre 40 · {row.unclassifiedToastOvertimeHours.toFixed(1)} h Toast sin clasificar ({row.unclassifiedToastEmployees})</small></div></div>)}</div>
        <div className="schedule-recommendation"><strong>💡 Acción recomendada</strong>{topRisk.length?<p>Revisa {topRisk.map(row=>row.employeeName).join(' y ')}. Sus próximos turnos concentran {topRisk.reduce((sum,row)=>sum+row.overtimeHours,0).toFixed(1)} h de overtime. Costo conocido: {money(topRisk.reduce((sum,row)=>sum+(row.estimatedOvertimeCost??0),0))}{topRisk.some(row=>row.estimatedOvertimeCost===null)?' más empleados sin tarifa horaria válida.':'.'}</p>:<p>No hay empleados proyectados sobre 40 horas con los filtros actuales.</p>}</div>
      </aside>
    </div>

    {selected&&<div className="schedule-drawer-backdrop" onClick={()=>setSelected(null)}><aside className="schedule-drawer" onClick={event=>event.stopPropagation()}><div className="schedule-drawer-head"><div><span>TOAST + 7SHIFTS OVERTIME REVIEW</span><h2>{selected.employeeName}</h2><p>{selected.primaryLocation} · {selected.role}</p></div><button onClick={()=>setSelected(null)}>×</button></div><div className="schedule-drawer-metrics"><div><label>Trabajadas Toast</label><strong>{selected.workedHours.toFixed(1)} h</strong></div><div><label>OT ya trabajado</label><strong>{selected.actualOvertimeHours.toFixed(1)} h</strong></div><div><label>Tarifa Toast</label><strong>{selected.hourlyWage===null?'No disponible':`${money(selected.hourlyWage)}/h`}</strong></div><div><label>Restantes 7shifts</label><strong>{selected.remainingScheduledHours.toFixed(1)} h</strong></div><div><label>Proyección</label><strong>{selected.projectedHours.toFixed(1)} h</strong></div><div><label>OT / costo</label><strong>{selected.overtimeHours.toFixed(1)} h · {cost(selected.estimatedOvertimeCost)}</strong></div></div>{selected.nextShift?<div className="schedule-next-shift"><label>PRÓXIMO TURNO PARA REVISAR</label><strong>{dateTime(selected.nextShift.start)} – {dateTime(selected.nextShift.end)}</strong><p>{selected.nextShift.location} · {selected.nextShift.role}</p></div>:<div className="schedule-next-shift"><label>PRÓXIMO TURNO</label><p>No quedan turnos publicados en este periodo.</p></div>}<div className="schedule-drawer-recommendation"><label>RECOMENDACIÓN OPSVISTA</label><p>{selected.overtimeHours>0?'Reasigna el próximo turno a una persona calificada que permanezca debajo de 40 horas. Confirma primero que se conserve la cobertura necesaria del puesto y del rush.':'Mantén el monitoreo. La proyección permanece debajo de 40 horas con los turnos publicados actuales.'}</p></div><div className="schedule-drawer-actions"><button className="primary" disabled={!onEscalate||sent.includes(selected.userId)||selected.overtimeHours<=0} onClick={()=>void send(selected)}>{sent.includes(selected.userId)?'Asignado en Action Center':'Asignar al manager'}</button><button onClick={()=>setSelected(null)}>Cerrar</button></div></aside></div>}
  </div>;
}
