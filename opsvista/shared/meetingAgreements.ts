/** Meeting context supplements an existing action; it never copies source-system records. */
export type MeetingAgreement = {
  weekStart: string;
  kpi: string;
  dataQuality: 'confirmed' | 'estimated' | 'not_recorded';
  nextReview: string;
};
export const MEETING_KPIS = [
  ['sales','Sales','Ventas'],['sales_change','Sales change','Variación de ventas'],['guests','Guests','Guests'],['average_ticket','Average ticket','Ticket promedio'],
  ['discounts','Discounts','Descuentos'],['voids','Voids','Voids'],['labor','Labor','Labor'],['overtime','Overtime','Overtime'],['bonus','Bonus','Bono'],
  ['service','Service times','Tiempos de servicio'],['staffing','Staffing','Staffing'],['maintenance','Maintenance','Mantenimiento'],
  ['food','Food purchases','Compras de comida'],['liquor','Liquor purchases','Compras de licor'],['marketing','Marketing','Marketing'],['schedule','Schedules','Horarios'],['tasks','Tasks','Tareas'],['other','Other','Otro'],
] as const;
export function validMeetingDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value;
}
export function shiftMeetingDate(value:string,days:number) {
  if(!validMeetingDate(value))throw new Error('Invalid meeting date');
  const d=new Date(`${value}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);
}
export function meetingWeekFor(value:string) {
  if(!validMeetingDate(value))throw new Error('Invalid meeting date');
  const day=new Date(`${value}T12:00:00Z`).getUTCDay();return shiftMeetingDate(value,-((day+4)%7));
}
export function currentMeetingWeek(now=new Date()) {
  return meetingWeekFor(new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(now));
}
export function meetingWeekLabel(start:string,locale='es-MX') {
  if(!validMeetingDate(start))return start;
  const format=(v:string)=>new Intl.DateTimeFormat(locale,{day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${v}T12:00:00Z`));
  const end=shiftMeetingDate(start,6);
  return start.slice(0,4)===end.slice(0,4)?`${format(start)} – ${format(end)}, ${start.slice(0,4)}`:`${format(start)}, ${start.slice(0,4)} – ${format(end)}, ${end.slice(0,4)}`;
}
export function parseMeetingAgreement(input:unknown):MeetingAgreement {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Meeting agreement details are required');
  const raw=input as Record<string,unknown>;
  const weekStart=typeof raw.weekStart==='string'?raw.weekStart:'';
  if(!validMeetingDate(weekStart)||meetingWeekFor(weekStart)!==weekStart)throw new Error('The operating week must start on Wednesday / La semana debe comenzar en miércoles');
  const kpi=typeof raw.kpi==='string'?raw.kpi:'';
  if(!MEETING_KPIS.some(item=>item[0]===kpi))throw new Error('Unknown meeting KPI / KPI de reunión inválido');
  const dataQuality=raw.dataQuality;
  if(typeof dataQuality!=='string'||!['confirmed','estimated','not_recorded'].includes(dataQuality))throw new Error('Choose the data validation / Selecciona la validación del dato');
  const nextReview=typeof raw.nextReview==='string'?raw.nextReview.trim():'';
  if(!nextReview||nextReview.length>5000)throw new Error('Enter the next review plan (1–5000 characters) / Registra el seguimiento de la próxima semana');
  return {weekStart,kpi,dataQuality:dataQuality as MeetingAgreement['dataQuality'],nextReview};
}
export function matchesMeetingWeek(action:{meeting?:MeetingAgreement;status:string},week:string,includePrior:boolean){
  const start=action.meeting?.weekStart;
  return Boolean(start&&(start===week||(includePrior&&start<week&&!['Completed','Dismissed'].includes(action.status))));
}
