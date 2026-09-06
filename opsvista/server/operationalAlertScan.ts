import type { SessionUser } from './authSession.js';
import { createAction, listActions, type ActionCreateInput } from './actionStore.js';
import { dispatchActionPush, dispatchOperationalPush } from './actionNotificationStore.js';
import { notifyActionObservers } from './operationalNotificationRouting.js';
import { listManagedUsers, type ManagedDirectoryUser } from './managementStore.js';
import { allocateSalaryLabor } from './salaryLabor.js';
import { weeklyTaskCompliance } from './sevenShiftsClient.js';
import { getToastPerformance } from './toastPerformance.js';

const corporateIds = ['usr-founder-roberto', 'usr-roberto-ops', 'usr-jacob'];
const round = (value:number) => Math.round((value + Number.EPSILON) * 100) / 100;
const money = (value:number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format(value || 0);
const easternParts = () => {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false}).formatToParts(new Date()).map(part => [part.type,part.value]));
  return { day:`${values.year}-${values.month}-${values.day}`, hour:Number(values.hour) % 24 };
};

function userLocations(user: ManagedDirectoryUser) {
  const now = Date.now();
  const grants = user.locationGrants?.length ? user.locationGrants : user.locations.map((location,index) => ({location,type:index === 0 ? 'Primary' as const : 'Additional' as const}));
  return Array.from(new Set(grants.filter(grant => !grant.expiresAt || new Date(grant.expiresAt).getTime() > now).map(grant => grant.location)));
}

function managerFor(location:string,directory:ManagedDirectoryUser[]) {
  return directory.find(user => user.active && user.role === 'Location Manager' && userLocations(user).includes(location));
}

function targets():Record<string,number> {
  try {
    const parsed = JSON.parse(process.env.OPSVISTA_DAILY_SALES_TARGETS_JSON || '{}') as Record<string,unknown>;
    return Object.fromEntries(Object.entries(parsed).map(([key,value]) => [key,Number(value)]).filter(([,value]) => Number.isFinite(value) && value > 0));
  } catch { return {}; }
}

function draft(base:ActionCreateInput,day:string,kind:string):ActionCreateInput {
  return {...base,automationKey:`${day}:${base.location.toLowerCase()}:${kind}`,automated:true,detectedAt:new Date().toISOString()};
}

export async function scanOperationalAlerts(actor:SessionUser) {
  const {day,hour} = easternParts();
  const requested = ['Founder','Corporate','HR','Administration','Maintenance'].includes(actor.role) ? undefined : actor.locations;
  const [performance,taskResult,directory,existing] = await Promise.all([
    getToastPerformance(day,day,requested),
    weeklyTaskCompliance(day,day,requested).then(value => ({value,error:''})).catch(error => ({value:null,error:error instanceof Error ? error.message : '7shifts unavailable'})),
    listManagedUsers(),
    listActions(actor),
  ]);
  const salary = allocateSalaryLabor(day,day,performance.map(row => row.location));
  const salaryByLocation = new Map(salary.rows.map(row => [row.location,row.salaryLaborCost]));
  const dailyTargets = targets();
  const drafts:ActionCreateInput[] = [];

  for (const row of performance) {
    const totalLaborCost = row.hourlyLaborCost + (salaryByLocation.get(row.location) || 0);
    const totalLaborPct = row.netSales ? round(totalLaborCost / row.netSales * 100) : 0;
    const manager = managerFor(row.location,directory);
    if (row.netSales >= 1000 && totalLaborPct > 32) drafts.push(draft({
      location:row.location,category:'Labor Intelligence',title:`Labor alto: ${totalLaborPct.toFixed(1)}%`,severity:totalLaborPct >= 36 ? 'High' : 'Medium',
      signal:`Labor total de ${money(totalLaborCost)} sobre ventas netas de ${money(row.netSales)}.`,
      cause:'La cobertura actual está creciendo por encima del ritmo de ventas del día.',
      recommendation:'Revisar el rush, proteger posiciones esenciales y ajustar solamente horas excedentes que puedan retirarse sin afectar servicio.',
      impact:`${(totalLaborPct - 30).toFixed(1)} puntos por encima de la meta de 30%.`,ownerId:manager?.id,ownerName:manager?.name,priorityScore:totalLaborPct >= 36 ? 85 : 65,sources:['Toast'],sourceIds:[`${day}:${row.location}:labor`],
    },day,'labor-high'));

    const target = dailyTargets[row.location];
    const requiredPace = hour >= 21 ? .9 : hour >= 18 ? .65 : 0;
    if (target && requiredPace && row.netSales < target * requiredPace) {
      const jacob = directory.find(user => user.id === 'usr-jacob' && user.active);
      drafts.push(draft({
        location:row.location,category:'Sales',title:'Ventas por debajo del ritmo esperado',severity:hour >= 21 ? 'High' : 'Medium',
        signal:`Ventas actuales ${money(row.netSales)}; ritmo esperado a esta hora ${money(target * requiredPace)}.`,
        cause:'El ritmo del día está por debajo de la meta configurada para la locación.',
        recommendation:'Activar coaching inmediato de upselling en bebidas, guacamole, postres y complementos; revisar conversión y ticket promedio al cierre.',
        impact:`Brecha actual de ${money(target * requiredPace - row.netSales)}.`,ownerId:jacob?.id,ownerName:jacob?.name,priorityScore:hour >= 21 ? 80 : 60,sources:['Toast'],sourceIds:[`${day}:${row.location}:sales`],
      },day,'sales-low'));
    }
  }

  if (hour >= 21 && taskResult.value) for (const row of taskResult.value.locations) {
    if (!row.incomplete) continue;
    const manager = managerFor(row.locationName,directory);
    drafts.push(draft({
      location:row.locationName,category:'Tasks',title:`${row.incomplete} task${row.incomplete === 1 ? '' : 's'} sin completar`,severity:row.incomplete >= 3 ? 'High' : 'Medium',
      signal:`7shifts reporta ${row.completed} de ${row.total} tasks completadas hoy.`,
      cause:'El cierre operativo mantiene tareas o checklists pendientes.',
      recommendation:'Confirmar responsables, terminar las tareas críticas y subir evidencia antes de cerrar el turno.',
      impact:`Cumplimiento actual ${row.completionPct === null ? 'sin datos' : `${row.completionPct.toFixed(1)}%`}.`,ownerId:manager?.id,ownerName:manager?.name,priorityScore:row.incomplete >= 3 ? 90 : 70,sources:['7shifts'],sourceIds:[`${day}:${row.locationName}:tasks`],
    },day,'tasks-incomplete'));
  }

  const activeKeys = new Set(existing.filter(action => !['Completed','Dismissed'].includes(action.status)).map(action => action.automationKey).filter(Boolean));
  const created = [];
  for (const candidate of drafts.filter(item => !activeKeys.has(item.automationKey))) {
    const action = await createAction(candidate,actor);
    if (!action) continue;
    created.push(action);
    if (action.ownerId) await dispatchActionPush(action,actor,action.category === 'Tasks' ? 20 : 30);
    await notifyActionObservers(action,actor,'assigned');
  }

  const totals = performance.reduce((sum,row) => ({sales:sum.sales + row.netSales,labor:sum.labor + row.hourlyLaborCost + (salaryByLocation.get(row.location) || 0)}),{sales:0,labor:0});
  const totalLaborPct = totals.sales ? round(totals.labor / totals.sales * 100) : 0;
  const pulse = await dispatchOperationalPush({
    eventKey:`${day}:sales-pulse:${Math.floor(hour / 3)}`,
    category:'sales',title:`OpsVista · Ventas ${money(totals.sales)}`,
    body:`Labor ${totalLaborPct.toFixed(1)}% · ${created.length} alerta${created.length === 1 ? '' : 's'} nueva${created.length === 1 ? '' : 's'} · datos en vivo.`,
    recipientIds:corporateIds,
  },actor);
  return {day,hour,scannedLocations:performance.length,createdActions:created,pulse,taskSourceAvailable:Boolean(taskResult.value),taskSourceError:taskResult.error};
}
