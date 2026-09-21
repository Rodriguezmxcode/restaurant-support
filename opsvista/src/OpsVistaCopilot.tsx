import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { OpsVistaModule } from './accessControl';
import { answerCopilot, copilotSuggestedPrompts, type CopilotAction, type CopilotAnswer } from './copilot';
import type { CopilotAgentAnswer, CopilotDataset, CopilotIssueCode, CopilotSource } from '../shared/copilotAgent';
import './copilot.css';

type Props = {
  currentUserId:string;
  currentUserName:string;
  role:string;
  allowedLocations:string[];
  modules:OpsVistaModule[];
  currentSection:OpsVistaModule;
  readOnlyPreview?:boolean;
  onNavigate:(module:OpsVistaModule)=>void;
};

type ChatMessage = {
  id:string;
  role:'assistant'|'user';
  text:string;
  answer?:CopilotAnswer;
  sources?:CopilotSource[];
  error?:boolean;
  issueCode?:CopilotIssueCode;
  retryAt?:number;
  createdAt:number;
};

type CopilotSide='left'|'right';

const sourceModules:Record<CopilotDataset,OpsVistaModule>={performance:'Ventas',ramp:'Gastos',tasks:'Tasks',actions:'Action Center',provi:'Restaurant365',reviews:'Google Reviews'};
const openAIHelp:Partial<Record<CopilotIssueCode,{label:string;url:string}>>={
  openai_credit:{label:'Revisar saldo de OpenAI',url:'https://platform.openai.com/settings/organization/billing/overview'},
  openai_quota:{label:'Revisar saldo y cuota de OpenAI',url:'https://platform.openai.com/settings/organization/billing/overview'},
  openai_project_spend:{label:'Revisar proyecto de OpenAI',url:'https://platform.openai.com/settings/organization/projects'},
  openai_organization_spend:{label:'Revisar límites de OpenAI',url:'https://platform.openai.com/settings/organization/limits'},
  openai_usage:{label:'Revisar límites de OpenAI',url:'https://platform.openai.com/settings/organization/limits'},
};
const api='/api/workflows?resource=actions';
const makeId=()=>`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const greeting=(name:string,locations:string[]):ChatMessage=>({
  id:'welcome', role:'assistant', createdAt:Date.now(),
  text:`Hola ${name.split(' ')[0]}. Pregúntame por tus ventas, labor, gastos o pendientes. Consultaré las fuentes disponibles según tus permisos${locations.length?` para ${locations.join(', ')}`:''}.`,
});

function readSide(key:string):CopilotSide {
  try{return window.localStorage.getItem(key)==='left'?'left':'right';}
  catch{return 'right';}
}

export default function OpsVistaCopilot({currentUserId,currentUserName,role,allowedLocations,modules,currentSection,readOnlyPreview=false,onNavigate}:Props) {
  const storageKey=`opsvista-assistant:${currentUserId}`;
  const sideKey=`opsvista-assistant-side:${currentUserId}`;
  const [open,setOpen]=useState(false);
  const [visible,setVisible]=useState(true);
  const [side,setSide]=useState<CopilotSide>(()=>readSide(sideKey));
  const [question,setQuestion]=useState('');
  const [actions,setActions]=useState<CopilotAction[]>([]);
  const [actionsLoading,setActionsLoading]=useState(false);
  const [messages,setMessages]=useState<ChatMessage[]>(()=>[greeting(currentUserName,allowedLocations)]);
  const [mode,setMode]=useState<'checking'|'ai'|'guide'|'error'>('checking');
  const [datasets,setDatasets]=useState<CopilotDataset[]>([]);
  const [statusError,setStatusError]=useState('');
  const [busy,setBusy]=useState(false);
  const requestRef=useRef<AbortController|null>(null);
  const inputRef=useRef<HTMLTextAreaElement>(null);
  const endRef=useRef<HTMLDivElement>(null);
  const locationKey=allowedLocations.join('|');

  // Business answers stay in memory; do not retain them on a shared device.
  useEffect(()=>{try{window.localStorage.removeItem(storageKey);}catch{/* Optional cleanup. */}},[storageKey]);
  useEffect(()=>()=>requestRef.current?.abort(),[]);
  useEffect(()=>{requestRef.current?.abort();requestRef.current=null;setBusy(false);setMessages([greeting(currentUserName,allowedLocations)]);setMode('checking');setDatasets([]);setActions([]);setActionsLoading(false);},[role,locationKey,readOnlyPreview,currentUserId]);
  useEffect(()=>{
    if(!open||readOnlyPreview)return;
    const controller=new AbortController();
    setMode('checking');setStatusError('');
    fetch('/api/workflows?resource=copilot',{credentials:'include',cache:'no-store',signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error(response.status===401?'Tu sesión venció. Vuelve a entrar a OpsVista.':'No se pudo comprobar la conexión del asistente.');return response.json();})
      .then(body=>{if(!controller.signal.aborted){setMode(body.configured?'ai':'guide');setDatasets(body.datasets||[]);}})
      .catch(error=>{if(!controller.signal.aborted){setMode('error');setStatusError(error.message);}});
    return()=>controller.abort();
  },[open,readOnlyPreview,role,locationKey]);
  useEffect(()=>{try{window.localStorage.setItem(sideKey,side);}catch{/* Storage can be unavailable. */}},[side,sideKey]);
  useEffect(()=>{if(open){window.setTimeout(()=>inputRef.current?.focus(),80);endRef.current?.scrollIntoView({behavior:'smooth'});}},[open,messages.length]);
  useEffect(()=>{
    if(!open)return;
    const close=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    document.addEventListener('keydown',close);
    return()=>document.removeEventListener('keydown',close);
  },[open]);
  useEffect(()=>{
    if(!open||mode!=='guide'||readOnlyPreview)return;
    let active=true;
    setActionsLoading(true);
    fetch(api,{credentials:'include',cache:'no-store'})
      .then(response=>response.ok?response.json():Promise.reject(new Error('Action Center unavailable')))
      .then((body:{actions?:CopilotAction[]})=>{if(active){const scope=new Set(allowedLocations);setActions((body.actions||[]).filter(action=>scope.has(action.location)));}})
      .catch(()=>{if(active)setActions([]);})
      .finally(()=>{if(active)setActionsLoading(false);});
    return()=>{active=false;};
  },[open,locationKey,mode,readOnlyPreview]);

  const prompts=useMemo(()=>{
    if(mode==='ai')return ([
      ['performance','¿Cómo va hoy el salario acumulado y el labor total?'],
      ['ramp','¿Cuántos gastos de esta semana no tienen recibo?'],
      ['tasks','¿Cómo va el cumplimiento de tareas hoy?'],
      ['provi','¿Qué reportes Provi tengo de los últimos 28 días?'],
      ['reviews','¿Cómo van las reseñas de esta semana?'],
      ['actions','¿Qué pendientes requieren atención?'],
    ] as [CopilotDataset,string][]).filter(([dataset])=>datasets.includes(dataset)).map(([,prompt])=>prompt).slice(0,5);
    return copilotSuggestedPrompts.slice(0,4);
  },[mode,datasets,currentSection]);

  const ask=async(value?:string)=>{
    const next=(value??question).trim();
    if(!next||next.length>4000||requestRef.current||readOnlyPreview||mode==='checking'||mode==='error')return;
    const userMessage:ChatMessage={id:makeId(),role:'user',text:next,createdAt:Date.now()};
    setMessages(items=>[...items,userMessage].slice(-30));setQuestion('');
    if(mode==='guide'){
      const response=answerCopilot(next,actions,undefined,modules,currentUserId);
      setMessages(items=>[...items,{id:makeId(),role:'assistant',text:response.answer,answer:response,createdAt:Date.now()}].slice(-30) as ChatMessage[]);
      return;
    }
    const controller=new AbortController();requestRef.current=controller;setBusy(true);
    const timer=window.setTimeout(()=>controller.abort('timeout'),105000);
    let issueCode:CopilotIssueCode|undefined,retryAt:number|undefined;
    try{
      const response=await fetch('/api/workflows?resource=copilot',{
        method:'POST',credentials:'include',cache:'no-store',signal:controller.signal,
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({question:next,history:messages.filter(item=>item.id!=='welcome'&&!item.error&&!item.answer).slice(-8).map(item=>({role:item.role,text:item.text.slice(0,4000)}))}),
      });
      const body=await response.json();
      if(!response.ok){issueCode=body.code;retryAt=typeof body.retryAfterSeconds==='number'&&Number.isFinite(body.retryAfterSeconds)&&body.retryAfterSeconds>=0&&body.retryAfterSeconds<=604800?Date.now()+body.retryAfterSeconds*1000:undefined;throw new Error(body.error||'No se pudo consultar el asistente.');}
      const answer=body as CopilotAgentAnswer;
      if(typeof answer.answer!=='string'||!Array.isArray(answer.sources))throw new Error('La respuesta llegó incompleta. Intenta de nuevo.');
      if(!controller.signal.aborted)setMessages(items=>[...items,{id:makeId(),role:'assistant',text:answer.answer,sources:answer.sources,createdAt:Date.now()}].slice(-30) as ChatMessage[]);
    }catch(error){
      if(!controller.signal.aborted||controller.signal.reason==='timeout'){setQuestion(next);setMessages(items=>[...items,{id:makeId(),role:'assistant',error:true,issueCode,retryAt,text:controller.signal.aborted?'La consulta tardó demasiado. Prueba una locación o un período más corto.':error instanceof Error?error.message:'No se pudo consultar el asistente.',createdAt:Date.now()}].slice(-30) as ChatMessage[]);}
    }finally{window.clearTimeout(timer);if(requestRef.current===controller){requestRef.current=null;setBusy(false);}}
  };
  const submit=(event:FormEvent)=>{event.preventDefault();ask();};
  const keyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();ask();}};
  const reset=()=>{requestRef.current?.abort();requestRef.current=null;setBusy(false);setMessages([greeting(currentUserName,allowedLocations)]);setQuestion('');};
  const navigate=(module:OpsVistaModule)=>{onNavigate(module);setOpen(false);};
  const move=()=>setSide(current=>current==='right'?'left':'right');
  const hide=()=>{setOpen(false);setVisible(false);};

  if(!visible)return null;

  return <>
    <div className={`copilot-launcher-shell side-${side}`}>
      <div className="copilot-launcher-controls" aria-label="Controles de Ask OpsVista">
        <button type="button" onClick={move} aria-label={`Mover Ask OpsVista a la ${side==='right'?'izquierda':'derecha'}`} title={`Mover a la ${side==='right'?'izquierda':'derecha'}`}>↔</button>
        <button type="button" onClick={hide} aria-label="Ocultar Ask OpsVista durante esta visita" title="Ocultar por ahora">×</button>
      </div>
      <button type="button" className={`copilot-launcher ${open?'is-open':''}`} aria-label="Abrir OpsVista Assistant" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
        <span className="copilot-launcher-icon">✦</span>
        <span className="copilot-launcher-copy"><strong>Ask OpsVista</strong><small>{mode==='ai'?'IA · Consulta tus datos':'Tu asistente de operaciones'}</small></span>
        <span className="copilot-launcher-state">{open?'×':'›'}</span>
      </button>
    </div>

    {open&&<div className={`copilot-backdrop side-${side}`} onMouseDown={()=>setOpen(false)}>
      <aside className="copilot-drawer" role="dialog" aria-modal="true" aria-label="OpsVista Assistant" onMouseDown={event=>event.stopPropagation()}>
        <header className="copilot-drawer-head">
          <div className="copilot-avatar">OV</div>
          <div><span>OPSVISTA ASSISTANT</span><strong>¿Qué quieres saber?</strong><small>{role} · {allowedLocations.join(', ')||'No location assigned'}</small></div>
          <button type="button" onClick={()=>setOpen(false)} aria-label="Cerrar chat">×</button>
        </header>

        <div className={`copilot-context ${mode!=='ai'?'is-pending':''}`}><i></i><span>{readOnlyPreview?'Vista de usuario: consultas de IA desactivadas':mode==='ai'?'IA habilitada · Respeta tus permisos y locaciones':mode==='checking'?'Comprobando conexión…':mode==='guide'?'Guía de módulos · La IA requiere activar la conexión de OpenAI':statusError}</span>{actionsLoading&&<em>Actualizando…</em>}</div>

        <div className="copilot-messages" aria-live="polite">
          {messages.map(message=><article key={message.id} className={`copilot-message ${message.role} ${message.error?'is-error':''}`}>
            <div className="copilot-message-label">{message.role==='user'?'TÚ':message.answer?'GUÍA OPSVISTA':'OPSVISTA'}</div>
            <div className="copilot-bubble">
              <p>{message.text}</p>
              {message.error&&message.retryAt&&<p className="copilot-retry-note">Puedes reintentar después de {new Date(message.retryAt).toLocaleTimeString('es-US',{timeZone:'America/New_York'})} ET.</p>}
              {message.error&&message.issueCode&&openAIHelp[message.issueCode]&&role==='Founder'&&<a className="copilot-open-module" href={openAIHelp[message.issueCode]!.url} target="_blank" rel="noopener noreferrer">{openAIHelp[message.issueCode]!.label}<b>↗</b></a>}
              {message.sources&&message.sources.length>0&&<details className="copilot-sources"><summary>Fuentes consultadas · {message.sources.length}</summary>{message.sources.map(source=><div key={source.id}>
                <strong>[{source.id}] {source.label}{source.available?'':' · No disponible'}</strong>
                <span>{source.start} → {source.end} · {source.locations.join(', ')}</span>
                <span>Consultado: {new Date(source.retrievedAt).toLocaleString('es-US',{timeZone:'America/New_York'})} ET</span>
                <p>{source.note}</p>
              </div>)}</details>}
              {message.sources?.some(source=>source.available&&modules.includes(sourceModules[source.dataset]))&&<button type="button" className="copilot-open-module" onClick={()=>navigate(sourceModules[message.sources!.find(source=>source.available&&modules.includes(sourceModules[source.dataset]))!.dataset])}>Abrir módulo de la fuente<b>→</b></button>}
              {message.answer?.observations&&message.answer.observations.length>0&&<div className="copilot-observations"><span>WHAT I FOUND</span>{message.answer.observations.map((item,index)=><p key={index}>{item}</p>)}</div>}
              {message.answer?.inference&&<div className="copilot-note inference"><span>INFERENCE</span><p>{message.answer.inference}</p></div>}
              {message.answer?.recommendation&&<div className="copilot-note recommendation"><span>NEXT STEP</span><p>{message.answer.recommendation}</p></div>}
              {message.answer?.module&&modules.includes(message.answer.module)&&<button type="button" className="copilot-open-module" onClick={()=>navigate(message.answer!.module!)}>Open {message.answer.moduleLabel||message.answer.module}<b>→</b></button>}
              {message.answer&&<div className="copilot-answer-meta"><span>{message.answer.confidence} confidence</span>{message.answer.sources.slice(0,3).map(source=><b key={source}>{source}</b>)}</div>}
            </div>
            {message.answer?.followUps&&message.answer.followUps.length>0&&<div className="copilot-followups">{message.answer.followUps.slice(0,2).map(prompt=><button type="button" key={prompt} disabled={busy||readOnlyPreview||mode==='checking'||mode==='error'} onClick={()=>ask(prompt)}>{prompt}</button>)}</div>}
          </article>)}
          {busy&&<div className="copilot-thinking" role="status">Consultando tus datos…</div>}
          <div ref={endRef}/>
        </div>

        <div className="copilot-suggestions">{prompts.map(prompt=><button type="button" key={prompt} disabled={busy||readOnlyPreview||mode==='checking'||mode==='error'} onClick={()=>ask(prompt)}>{prompt}</button>)}</div>

        <form className="copilot-composer" onSubmit={submit}>
          <textarea ref={inputRef} rows={2} maxLength={4000} disabled={readOnlyPreview||mode==='checking'||mode==='error'} value={question} onChange={event=>setQuestion(event.target.value)} onKeyDown={keyDown} placeholder="Escribe tu pregunta… / Ask a question…" aria-label="Pregunta para OpsVista"/>
          <button type="submit" disabled={!question.trim()||busy||readOnlyPreview||mode==='checking'||mode==='error'} aria-label="Enviar pregunta">↑</button>
        </form>
        <footer className="copilot-footer"><span>Solo consulta · Revisa las fuentes antes de decidir. El chat se borra al salir.</span><button type="button" onClick={reset}>Nuevo chat</button></footer>
      </aside>
    </div>}
  </>;
}
