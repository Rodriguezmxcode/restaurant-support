import type { OpsVistaModule } from './accessControl';

export type CopilotAction = {
  id: string | number;
  location: string;
  category: string;
  title: string;
  severity: 'High' | 'Medium' | 'Low';
  status: string;
  signal: string;
  cause: string;
  recommendation: string;
  impact: string;
  owner?: string;
  ownerId?: string;
  dueAt?: string;
  priorityScore?: number;
  sources?: string[];
  detectedAt?: string;
};

export type CopilotAnswer = {
  answer: string;
  observations: string[];
  inference?: string;
  recommendation?: string;
  sources: string[];
  confidence: 'High' | 'Medium';
  module?: OpsVistaModule;
  moduleLabel?: string;
  followUps?: string[];
};

type Guide = {
  module: OpsVistaModule;
  label: string;
  keywords: string[];
  es: { answer:string; recommendation:string; followUps:string[] };
  en: { answer:string; recommendation:string; followUps:string[] };
};

const open = (action:CopilotAction) => !['Completed','Dismissed'].includes(action.status);
const score = (action:CopilotAction) => action.priorityScore ?? (action.severity === 'High' ? 80 : action.severity === 'Medium' ? 55 : 30);
const normalize = (value:string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const isEnglish = (value:string) => /\b(how|what|where|why|which|need|show|open|find|today|review|receipt|schedule|sales|task|payment|project)\b/i.test(value);

const guides:Guide[] = [
  {
    module:'Gastos', label:'Gastos Ramp',
    keywords:['ramp','gasto','expense','recibo','receipt','memo','cardholder','tarjeta','comprobante','invoice pendiente'],
    es:{
      answer:'Los gastos, recibos y memos se administran en Gastos Ramp. Ahí puedes ver quién hizo la compra, a qué restaurante pertenece y qué comprobante falta.',
      recommendation:'Abre el gasto pendiente, entra al registro de Ramp y completa el memo y el recibo. OpsVista conservará el responsable y el vencimiento.',
      followUps:['¿Qué recibos están pendientes?','¿Quién tiene memos vencidos?'],
    },
    en:{
      answer:'Expenses, receipts, and memos are managed in Ramp Expenses. It shows who made the purchase, the assigned restaurant, and what documentation is missing.',
      recommendation:'Open the pending expense, continue to its Ramp record, and complete the memo and receipt.',
      followUps:['Which receipts are missing?','Who has overdue memos?'],
    },
  },
  {
    module:'Horarios', label:'Horarios · Labor Intelligence',
    keywords:['overtime','ot','labor','horario','schedule','turno','shift','40 horas','40 hours','splh','clock in','clock out'],
    es:{
      answer:'Horarios reúne el schedule, las horas trabajadas, labor, SPLH y overtime. Separa el overtime pagado accionable de las horas de empleados asalariados.',
      recommendation:'Revisa primero quién está cerca de 40 horas y compara horas programadas contra trabajadas antes de ajustar turnos.',
      followUps:['¿Quién está cerca de overtime?','¿Cómo se calcula el overtime?'],
    },
    en:{
      answer:'Labor Intelligence combines schedules, worked hours, labor, SPLH, and overtime. It separates actionable paid overtime from salaried-employee hours.',
      recommendation:'First review employees approaching 40 hours, then compare scheduled versus worked hours before changing shifts.',
      followUps:['Who is close to overtime?','How is overtime calculated?'],
    },
  },
  {
    module:'Tasks', label:'Tasks · 7shifts & Logbook',
    keywords:['task','tasks','tarea','tareas','checklist','logbook','bitacora','evidencia','evidence','foto','photo','incumplida','incomplete'],
    es:{
      answer:'Tasks es el lugar para revisar checklists, responsables, Logbook y evidencia por fecha y locación.',
      recommendation:'Abre la tarea incompleta, confirma el responsable y solicita evidencia. Si vuelve a incumplirse, conviértela en seguimiento dentro de Action Center.',
      followUps:['¿Qué tasks faltan hoy?','¿Dónde reviso el Logbook?'],
    },
    en:{
      answer:'Tasks is where you review checklists, owners, Logbook entries, and evidence by date and location.',
      recommendation:'Open the incomplete task, confirm its owner, and request evidence. Repeated failures should become Action Center follow-up.',
      followUps:['Which tasks are missing today?','Where do I review the Logbook?'],
    },
  },
  {
    module:'Google Reviews', label:'Google Reviews',
    keywords:['review','reviews','resena','resenas','google','yelp','uber eats','doordash','rating','estrella','reputacion','comentario cliente'],
    es:{
      answer:'Las reseñas y alertas de reputación se revisan en Google Reviews. Puedes filtrar por restaurante, detectar una reseña crítica y darle seguimiento.',
      recommendation:'Atiende primero las reseñas de 1 a 3 estrellas, confirma la locación y solicita ticket, horario y contacto cuando sea necesario investigar.',
      followUps:['¿Hay reseñas críticas?','¿Cómo respondo una reseña?'],
    },
    en:{
      answer:'Reviews and reputation alerts are handled in Google Reviews. You can filter by restaurant, find critical feedback, and track follow-up.',
      recommendation:'Start with one- to three-star reviews. Confirm the location and request the receipt, visit time, and contact details when investigation is needed.',
      followUps:['Are there critical reviews?','How should I answer a review?'],
    },
  },
  {
    module:'Bono semanal', label:'Bono semanal',
    keywords:['bono','bonus','ranking','scorecard','calificado','qualified','elegibilidad','eligibility','descuento uber','uber discount'],
    es:{
      answer:'Bono semanal muestra la calificación por Tasks, descuentos, voids, overtime, licor y liderazgo. Los descuentos corporativos de Uber Eats se excluyen de la métrica del bono.',
      recommendation:'Abre el scorecard para ver qué regla impide calificar y después entra al módulo de origen para corregirla.',
      followUps:['¿Por qué no calificó mi restaurante?','¿Qué métricas cuentan para el bono?'],
    },
    en:{
      answer:'Weekly Bonus scores Tasks, discounts, voids, overtime, liquor, and leadership. Corporate Uber Eats discounts are excluded from the bonus discount metric.',
      recommendation:'Open the scorecard to identify the failed rule, then use its source module to correct it.',
      followUps:['Why did my restaurant not qualify?','Which metrics count for the bonus?'],
    },
  },
  {
    module:'Action Center', label:'Action Center',
    keywords:['action center','accion','acciones','responsable','owner','seguimiento','follow up','alerta','problema','incident','incidente','prioridad','priority','mantenimiento','maintenance','reparacion','repair'],
    es:{
      answer:'Action Center convierte un problema operativo en seguimiento: señal, causa probable, recomendación, responsable, fecha límite y verificación.',
      recommendation:'Crea o abre la acción, asigna al manager responsable y no la cierres hasta guardar evidencia del resultado.',
      followUps:['¿Qué acciones tengo asignadas?','¿Qué está vencido?'],
    },
    en:{
      answer:'Action Center turns an operating problem into accountable follow-up: signal, likely cause, recommendation, owner, deadline, and verification.',
      recommendation:'Create or open the action, assign the responsible manager, and keep it open until the result is verified with evidence.',
      followUps:['Which actions are assigned to me?','What is overdue?'],
    },
  },
  {
    module:'Pagos', label:'Pagos',
    keywords:['pago','pagos','payment','payments','solicitud de pago','payment request','aprobar','approve','proveedor','vendor'],
    es:{
      answer:'Las solicitudes de pago se crean y consultan en Pagos. Los managers solicitan; Corporate aprueba; Administration emite únicamente solicitudes aprobadas.',
      recommendation:'Adjunta el soporte, selecciona la locación correcta y envía la solicitud para aprobación. El historial queda en la bitácora.',
      followUps:['¿Cómo solicito un pago?','¿Dónde veo el estado del pago?'],
    },
    en:{
      answer:'Payment requests are created and tracked in Payments. Managers request, Corporate approves, and Administration issues only approved requests.',
      recommendation:'Attach supporting evidence, select the correct location, and submit the request for approval.',
      followUps:['How do I request a payment?','Where can I see payment status?'],
    },
  },
  {
    module:'Proyectos', label:'Proyectos',
    keywords:['proyecto','project','gantt','timeline','milestone','presupuesto','budget','renovacion','remodelacion'],
    es:{
      answer:'Proyectos organiza iniciativas de varios pasos con responsables, fechas, milestones, presupuesto y actualizaciones.',
      recommendation:'Usa un proyecto cuando el trabajo requiera varias etapas. Los problemas urgentes de una sola acción pertenecen a Action Center.',
      followUps:['¿Cómo actualizo un proyecto?','¿Dónde veo el timeline?'],
    },
    en:{
      answer:'Projects organizes multi-step initiatives with owners, dates, milestones, budget, and progress updates.',
      recommendation:'Use a project for multi-stage work. A single urgent operating problem belongs in Action Center.',
      followUps:['How do I update a project?','Where is the timeline?'],
    },
  },
  {
    module:'Transferencias', label:'Transferencias',
    keywords:['transferencia','transfer','movimiento','inventory transfer','inventario entre','salio','llego','faltante'],
    es:{
      answer:'Transferencias registra lo que salió de un restaurante, lo que llegó, quién entregó, quién recibió y cualquier diferencia.',
      recommendation:'Registra origen, destino, artículos y recepción para mantener la cadena de custodia.',
      followUps:['¿Cómo registro una transferencia?','¿Dónde reporto un faltante?'],
    },
    en:{
      answer:'Transfers records what left one restaurant, what arrived, who released it, who received it, and any difference.',
      recommendation:'Record origin, destination, items, and receipt to preserve chain of custody.',
      followUps:['How do I record a transfer?','Where do I report a shortage?'],
    },
  },
  {
    module:'Ventas', label:'Ventas',
    keywords:['venta','ventas','sales','net sales','gross sales','descuento','discount','void','cheque promedio','average check','guest','invitado'],
    es:{
      answer:'Ventas concentra ventas netas, tendencias, descuentos, voids, guests y cheque promedio para el periodo seleccionado.',
      recommendation:'Confirma primero el periodo y la locación; después compara contra el mismo periodo anterior para evitar conclusiones engañosas.',
      followUps:['¿Dónde comparo ventas?','¿Cómo reviso voids?'],
    },
    en:{
      answer:'Sales combines net sales, trends, discounts, voids, guests, and average check for the selected period.',
      recommendation:'Confirm the date range and location first, then compare with the equivalent prior period.',
      followUps:['Where do I compare sales?','How do I review voids?'],
    },
  },
  {
    module:'Locaciones', label:'Locaciones',
    keywords:['locacion','locaciones','location','locations','restaurante peor','restaurant performance','comparar restaurantes','compare restaurants'],
    es:{
      answer:'Locaciones compara el desempeño completo de los restaurantes dentro de tu acceso.',
      recommendation:'Selecciona una locación para abrir su detalle y desde ahí continúa a Tasks o Labor si encuentras una desviación.',
      followUps:['¿Qué locación necesita atención?','¿Cómo comparo restaurantes?'],
    },
    en:{
      answer:'Locations compares the complete performance of restaurants within your access scope.',
      recommendation:'Select a location to open its detail, then continue to Tasks or Labor when you find a deviation.',
      followUps:['Which location needs attention?','How do I compare restaurants?'],
    },
  },
  {
    module:'Local Intelligence', label:'Local Intelligence',
    keywords:['clima','weather','trafico','traffic','evento','event','demanda local','local demand'],
    es:{
      answer:'Local Intelligence reúne clima, tráfico, incidentes y eventos cercanos que pueden afectar la demanda de cada restaurante.',
      recommendation:'Revisa la señal y el horizonte antes de ajustar staffing, preparación o promociones.',
      followUps:['¿Hay eventos cercanos?','¿El clima afectará ventas?'],
    },
    en:{
      answer:'Local Intelligence combines weather, traffic, incidents, and nearby events that may affect restaurant demand.',
      recommendation:'Review the signal and time horizon before changing staffing, preparation, or promotions.',
      followUps:['Are there nearby events?','Will weather affect sales?'],
    },
  },
  {
    module:'Configuración', label:'Configuración',
    keywords:['usuario','usuarios','user','users','permiso','permissions','acceso','access','invitacion','invitation','integracion','integration','password','contrasena'],
    es:{
      answer:'Usuarios, permisos, invitaciones, credenciales e integraciones se administran en Configuración según tu nivel de acceso.',
      recommendation:'Abre Configuración y selecciona el panel correspondiente. OpsVista ocultará cualquier control que tu rol no pueda administrar.',
      followUps:['¿Cómo invito a un usuario?','¿Dónde reviso integraciones?'],
    },
    en:{
      answer:'Users, permissions, invitations, credentials, and integrations are managed in Settings according to your access level.',
      recommendation:'Open Settings and use the relevant panel. OpsVista hides controls your role cannot manage.',
      followUps:['How do I invite a user?','Where do I check integrations?'],
    },
  },
];

export const copilotSuggestedPrompts = [
  '¿Qué necesita atención hoy?',
  '¿Dónde subo un recibo?',
  '¿Quién está cerca de overtime?',
  '¿Cómo funciona el bono?',
  '¿Dónde reviso los tasks?',
];

function sourceFor(action:CopilotAction) {
  const values = new Set<string>(['Action Center']);
  const hay = normalize(`${action.category} ${(action.sources ?? []).join(' ')}`);
  if (hay.includes('ramp') || hay.includes('expense')) values.add('Gastos');
  if (hay.includes('labor') || hay.includes('overtime')) values.add('Horarios');
  if (hay.includes('evidence') || hay.includes('task')) values.add('Tasks');
  return [...values];
}

function bestGuide(question:string) {
  const q=normalize(question);
  let best:{guide:Guide;score:number}|undefined;
  for(const guide of guides){
    const points=guide.keywords.reduce((total,keyword)=>{
      const normalized=normalize(keyword);
      return total+(q.includes(normalized)?Math.max(2,normalized.split(' ').length*3):0);
    },0);
    if(points&&(!best||points>best.score))best={guide,score:points};
  }
  return best?.guide;
}

function accessibleRouteAnswer(question:string,guide:Guide,availableModules?:OpsVistaModule[]):CopilotAnswer {
  const english=isEnglish(question);
  const copy=english?guide.en:guide.es;
  const allowed=!availableModules||availableModules.includes(guide.module);
  if(!allowed){
    return {
      answer:english?`This request belongs in ${guide.label}, but your current role does not have access to that module.`:`Esta solicitud corresponde a ${guide.label}, pero tu rol actual no tiene acceso a ese módulo.`,
      observations:[],
      recommendation:english?'Ask Corporate to review it or assign the appropriate follow-up.':'Solicita a Corporate que lo revise o asigne el seguimiento correspondiente.',
      sources:['Role permissions'], confidence:'High', followUps:[],
    };
  }
  return {
    answer:copy.answer, observations:[], recommendation:copy.recommendation,
    sources:[guide.label,'OpsVista workflow'], confidence:'High', module:guide.module, moduleLabel:guide.label, followUps:copy.followUps,
  };
}

export function answerCopilot(question:string,actions:CopilotAction[],selected?:CopilotAction,availableModules?:OpsVistaModule[],currentUserId?:string):CopilotAnswer {
  const q=normalize(question);
  const english=isEnglish(question);
  const active=actions.filter(open).sort((a,b)=>score(b)-score(a));
  const top=selected&&open(selected)?selected:active[0];
  const asksToday=/atencion hoy|hacer hoy|today|prioridad principal|most important|asignad|assigned|vencid|overdue/.test(q);
  const asksWhy=/por que|porque|why/.test(q);
  const asksMoney=/dinero|riesgo|ahorr|money|financial risk|saving/.test(q);
  const asksLocation=/ubicacion.*atencion|locacion.*atencion|location.*attention|restaurante peor|which location/.test(q);

  if(active.length&&asksToday){
    const focus=active.slice(0,3);
    const assigned=/asignad|assigned/.test(q);
    const overdue=/vencid|overdue/.test(q);
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const scoped=assigned?active.filter(action=>currentUserId?action.ownerId===currentUserId:Boolean(action.ownerId||action.owner)):overdue?active.filter(action=>Boolean(action.dueAt&&action.dueAt.slice(0,10)<today)):focus;
    const visible=scoped.slice(0,3);
    if(!visible.length){
      return {
        answer:english?(assigned?'You have no open actions assigned directly to you.':'There are no overdue actions in your authorized locations.'):(assigned?'No tienes acciones abiertas asignadas directamente a ti.':'No hay acciones vencidas en tus locaciones autorizadas.'),
        observations:[], recommendation:english?'Keep monitoring Action Center for new assignments.':'Mantén monitoreado Action Center para nuevas asignaciones.',
        sources:['Action Center'], confidence:'High', module:'Action Center', moduleLabel:'Action Center',
      };
    }
    return {
      answer:english?`Start with ${visible[0].location}: ${visible[0].title}. I found ${scoped.length} matching open actions in your authorized locations.`:`Comienza con ${visible[0].location}: ${visible[0].title}. Encontré ${scoped.length} acciones abiertas que coinciden en tus locaciones autorizadas.`,
      observations:visible.map((action,index)=>`${index+1}. ${action.location} · ${action.title} · ${score(action)}/100 · ${action.impact}`),
      recommendation:visible[0].recommendation,
      sources:[...new Set(visible.flatMap(sourceFor))], confidence:'High', module:'Action Center', moduleLabel:'Action Center',
      followUps:english?['Why is the first action happening?','What is overdue?']:['¿Por qué está pasando la primera acción?','¿Qué está vencido?'],
    };
  }

  if(active.length&&asksWhy&&top){
    return {
      answer:english?`${top.title}: the observed signal is ${top.signal}`:`${top.title}: la señal observada es ${top.signal}`,
      observations:[`${english?'Location':'Ubicación'}: ${top.location}`,`${english?'Priority':'Prioridad'}: ${score(top)}/100`,`${english?'Status':'Estado'}: ${top.status}`],
      inference:english?`OpsVista records this likely cause: ${top.cause}. This is an operating inference, not a confirmed cause or accusation.`:`OpsVista registra esta causa probable: ${top.cause}. Es una inferencia operativa, no una causa confirmada ni una acusación.`,
      recommendation:top.recommendation, sources:sourceFor(top), confidence:'Medium', module:'Action Center', moduleLabel:'Action Center',
    };
  }

  if(active.length&&asksMoney){
    const relevant=active.filter(action=>/\$|spend|saving|savings|exposure|labor|overtime|gasto/i.test(`${action.impact} ${action.category}`));
    return {
      answer:english?`${relevant.length} open actions have an explicit or probable financial impact.`:`Hay ${relevant.length} acciones abiertas con impacto financiero explícito o probable.`,
      observations:relevant.slice(0,4).map(action=>`${action.location}: ${action.title} — ${action.impact}`),
      inference:english?'I do not combine amounts expressed in different units or ambiguous text. A consolidated total must come from verified financial adapters.':'No sumo importes expresados en unidades distintas o texto ambiguo. El total consolidado debe venir de adaptadores financieros verificados.',
      recommendation:english?'Address the highest-priority financial action first and verify the corrected cost or savings afterward.':'Atiende primero la acción financiera con mayor prioridad y verifica después el gasto o ahorro corregido.',
      sources:[...new Set(relevant.flatMap(sourceFor))], confidence:'High', module:'Action Center', moduleLabel:'Action Center',
    };
  }

  if(active.length&&asksLocation){
    const byLocation=new Map<string,{count:number;points:number;high:number}>();
    active.forEach(action=>{const row=byLocation.get(action.location)??{count:0,points:0,high:0};row.count++;row.points+=score(action);if(action.severity==='High')row.high++;byLocation.set(action.location,row);});
    const ranked=[...byLocation.entries()].sort((a,b)=>(b[1].points+b[1].high*20)-(a[1].points+a[1].high*20));
    const first=ranked[0];
    return {
      answer:english?`${first[0]} needs the most attention with ${first[1].count} open actions, including ${first[1].high} high priority.`:`${first[0]} necesita más atención con ${first[1].count} acciones abiertas, incluyendo ${first[1].high} de alta prioridad.`,
      observations:ranked.slice(0,4).map(([name,value])=>`${name}: ${value.count} ${english?'actions':'acciones'} · ${value.high} high · ${value.points} points`),
      inference:english?'This ranking combines action count and priority score; it is not a complete financial evaluation.':'El ranking combina cantidad de acciones y priority score; no es una evaluación financiera completa.',
      recommendation:english?`Review the highest-priority action in ${first[0]} and assign an owner and deadline.`:`Revisa la acción de mayor prioridad en ${first[0]} y asigna responsable y fecha límite.`,
      sources:['Action Center'], confidence:'High', module:'Locaciones', moduleLabel:'Locaciones',
    };
  }

  const guide=bestGuide(question);
  if(guide)return accessibleRouteAnswer(question,guide,availableModules);

  if(active.length){
    return {
      answer:english?`I found ${active.length} open actions. The first priority is ${active[0].location}: ${active[0].title}.`:`Encontré ${active.length} acciones abiertas. La primera prioridad es ${active[0].location}: ${active[0].title}.`,
      observations:active.slice(0,4).map(action=>`${action.location} · ${action.category} · ${action.severity} · ${score(action)}/100`),
      inference:english?'The order uses current Action Center rules and scores. Missing integration data is not inferred.':'El orden usa las reglas y scores actuales de Action Center. OpsVista no infiere datos faltantes de una integración.',
      recommendation:active[0].recommendation, sources:['Action Center'], confidence:'High', module:'Action Center', moduleLabel:'Action Center',
      followUps:english?['What needs attention today?','Where do I upload a receipt?']:['¿Qué necesita atención hoy?','¿Dónde subo un recibo?'],
    };
  }

  return {
    answer:english?'I can guide you to Sales, Labor, Tasks, Reviews, Expenses, Payments, Projects, Transfers, or Action Center. Ask what you need to do in everyday words.':'Puedo dirigirte a Ventas, Horarios, Tasks, Reviews, Gastos, Pagos, Proyectos, Transferencias o Action Center. Dime con tus propias palabras qué necesitas hacer.',
    observations:[],
    recommendation:english?'Try a specific question such as “Where do I upload a receipt?”':'Prueba con una pregunta concreta, por ejemplo: “¿Dónde subo un recibo?”',
    sources:['OpsVista navigation'], confidence:'Medium', followUps:copilotSuggestedPrompts.slice(0,4),
  };
}
