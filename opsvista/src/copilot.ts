export type CopilotSource = 'Action Center' | 'Ramp' | 'Labor' | 'Evidence' | 'Tasks';

export type CopilotAction = {
  id: number;
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
  priorityScore?: number;
  sources?: string[];
  detectedAt?: string;
};

export type CopilotAnswer = {
  answer: string;
  observations: string[];
  inference?: string;
  recommendation?: string;
  sources: CopilotSource[];
  confidence: 'High' | 'Medium';
};

const open = (a: CopilotAction) => !['Completed','Dismissed'].includes(a.status);
const score = (a: CopilotAction) => a.priorityScore ?? (a.severity === 'High' ? 80 : a.severity === 'Medium' ? 55 : 30);

function sourceFor(action: CopilotAction): CopilotSource[] {
  const values = new Set<CopilotSource>(['Action Center']);
  const hay = `${action.category} ${(action.sources ?? []).join(' ')}`.toLowerCase();
  if (hay.includes('ramp') || hay.includes('expense')) values.add('Ramp');
  if (hay.includes('labor') || hay.includes('overtime')) values.add('Labor');
  if (hay.includes('evidence')) values.add('Evidence');
  if (hay.includes('task')) values.add('Tasks');
  return [...values];
}

export const copilotSuggestedPrompts = [
  '¿Qué necesita más atención hoy?',
  '¿Por qué está pasando esto?',
  '¿Qué debería hacer hoy?',
  '¿Qué ubicación está peor?',
  '¿Cuánto dinero está en riesgo?',
  'Resume lo más importante de hoy',
];

export function answerCopilot(question: string, actions: CopilotAction[], selected?: CopilotAction): CopilotAnswer {
  const q = question.trim().toLowerCase();
  const active = actions.filter(open).sort((a,b)=>score(b)-score(a));
  const top = selected && open(selected) ? selected : active[0];
  const sources = new Set<CopilotSource>();
  active.forEach(a => sourceFor(a).forEach(s => sources.add(s)));

  if (!active.length) {
    return { answer:'No hay acciones operativas abiertas en el contexto actual.', observations:['Action Center no tiene problemas activos.'], recommendation:'Mantén el monitoreo y vuelve a ejecutar las reglas cuando entren datos nuevos.', sources:['Action Center'], confidence:'High' };
  }

  if (q.includes('por qué') || q.includes('porque') || q.includes('why')) {
    if (!top) return { answer:'No tengo una acción seleccionada para explicar.', observations:[], sources:['Action Center'], confidence:'Medium' };
    return {
      answer:`${top.title}: la señal observada es ${top.signal}`,
      observations:[`Ubicación: ${top.location}`,`Prioridad: ${score(top)}/100`, `Estado: ${top.status}`],
      inference:`Causa probable registrada por OpsVista: ${top.cause}. Esto es una inferencia operativa, no una acusación ni una causa confirmada.`,
      recommendation:top.recommendation,
      sources:sourceFor(top), confidence:'Medium'
    };
  }

  if (q.includes('dinero') || q.includes('riesgo') || q.includes('ahorr')) {
    const financiallyRelevant = active.filter(a => /\$|spend|saving|savings|exposure|labor|overtime|gasto/i.test(`${a.impact} ${a.category}`));
    return {
      answer:`Hay ${financiallyRelevant.length} acciones abiertas con impacto financiero explícito o probable.`,
      observations:financiallyRelevant.slice(0,4).map(a=>`${a.location}: ${a.title} — ${a.impact}`),
      inference:'No sumo automáticamente importes expresados con unidades distintas o texto ambiguo; el total consolidado debe venir de los adaptadores financieros live.',
      recommendation:'Atiende primero las acciones financieras con mayor priority score y verifica el ahorro o gasto corregido después.',
      sources:[...sources], confidence:'High'
    };
  }

  if (q.includes('ubicación') || q.includes('location') || q.includes('peor')) {
    const byLocation = new Map<string,{count:number;points:number;high:number}>();
    active.forEach(a=>{ const x=byLocation.get(a.location)??{count:0,points:0,high:0}; x.count++; x.points+=score(a); if(a.severity==='High')x.high++; byLocation.set(a.location,x); });
    const ranked=[...byLocation.entries()].sort((a,b)=>(b[1].points+b[1].high*20)-(a[1].points+a[1].high*20));
    const first=ranked[0];
    return {
      answer:first?`${first[0]} requiere más atención con ${first[1].count} acciones abiertas y ${first[1].high} de alta prioridad.`:'No hay suficiente información para comparar ubicaciones.',
      observations:ranked.slice(0,4).map(([name,v])=>`${name}: ${v.count} acciones · ${v.high} high · ${v.points} priority points`),
      inference:'El ranking combina número de acciones y priority score; no reemplaza una evaluación financiera completa de la ubicación.',
      recommendation:first?`Revisa primero la acción de mayor prioridad en ${first[0]} y asigna owner/deadline.`:undefined,
      sources:[...sources], confidence:'High'
    };
  }

  if (q.includes('qué debería') || q.includes('que deberia') || q.includes('hacer hoy') || q.includes('attention') || q.includes('atención')) {
    const focus=active.slice(0,3);
    return {
      answer:`Hoy concentraría la operación en ${focus.length} acciones, comenzando por ${focus[0].location}: ${focus[0].title}.`,
      observations:focus.map((a,i)=>`${i+1}. ${a.location} · ${a.title} · ${score(a)}/100 · ${a.impact}`),
      recommendation:focus[0].recommendation,
      sources:[...new Set(focus.flatMap(sourceFor))], confidence:'High'
    };
  }

  return {
    answer:`Tienes ${active.length} acciones abiertas. La prioridad principal es ${active[0].location}: ${active[0].title}.`,
    observations:active.slice(0,5).map(a=>`${a.location} · ${a.category} · ${a.severity} · ${score(a)}/100 · ${a.impact}`),
    inference:'La prioridad se basa en las reglas y scores disponibles en el Action Center. Si faltan datos live de una integración, OpsVista debe mostrar esa limitación en lugar de inventar contexto.',
    recommendation:active[0].recommendation,
    sources:[...sources], confidence:'High'
  };
}
