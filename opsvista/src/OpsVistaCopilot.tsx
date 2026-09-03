import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import type { OpsVistaModule } from './accessControl';
import { answerCopilot, copilotSuggestedPrompts, type CopilotAction, type CopilotAnswer } from './copilot';
import './copilot.css';

type Props = {
  currentUserId:string;
  currentUserName:string;
  role:string;
  allowedLocations:string[];
  modules:OpsVistaModule[];
  currentSection:OpsVistaModule;
  onNavigate:(module:OpsVistaModule)=>void;
};

type ChatMessage = {
  id:string;
  role:'assistant'|'user';
  text:string;
  answer?:CopilotAnswer;
  createdAt:number;
};

const api='/api/workflows?resource=actions';
const makeId=()=>`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
const greeting=(name:string,locations:string[]):ChatMessage=>({
  id:'welcome', role:'assistant', createdAt:Date.now(),
  text:`Hola ${name.split(' ')[0]}. Pregúntame qué necesitas hacer. Puedo contestar dudas y llevarte al módulo correcto${locations.length?` para ${locations.join(', ')}`:''}.`,
});

function readHistory(key:string,name:string,locations:string[]) {
  try{
    const value=window.localStorage.getItem(key);
    if(value){
      const parsed=JSON.parse(value) as ChatMessage[];
      if(Array.isArray(parsed)&&parsed.length)return parsed.slice(-30);
    }
  }catch{/* Storage can be unavailable in restrictive browser sessions. */}
  return [greeting(name,locations)];
}

export default function OpsVistaCopilot({currentUserId,currentUserName,role,allowedLocations,modules,currentSection,onNavigate}:Props) {
  const storageKey=`opsvista-assistant:${currentUserId}`;
  const [open,setOpen]=useState(false);
  const [question,setQuestion]=useState('');
  const [actions,setActions]=useState<CopilotAction[]>([]);
  const [actionsLoading,setActionsLoading]=useState(false);
  const [messages,setMessages]=useState<ChatMessage[]>(()=>readHistory(storageKey,currentUserName,allowedLocations));
  const inputRef=useRef<HTMLTextAreaElement>(null);
  const endRef=useRef<HTMLDivElement>(null);
  const locationKey=allowedLocations.join('|');

  useEffect(()=>{try{window.localStorage.setItem(storageKey,JSON.stringify(messages.slice(-30)));}catch{/* Storage can be unavailable. */}},[messages,storageKey]);
  useEffect(()=>{if(open){window.setTimeout(()=>inputRef.current?.focus(),80);endRef.current?.scrollIntoView({behavior:'smooth'});}},[open,messages.length]);
  useEffect(()=>{
    if(!open)return;
    const close=(event:globalThis.KeyboardEvent)=>{if(event.key==='Escape')setOpen(false);};
    document.addEventListener('keydown',close);
    return()=>document.removeEventListener('keydown',close);
  },[open]);
  useEffect(()=>{
    if(!open)return;
    let active=true;
    setActionsLoading(true);
    fetch(api,{credentials:'include',cache:'no-store'})
      .then(response=>response.ok?response.json():Promise.reject(new Error('Action Center unavailable')))
      .then((body:{actions?:CopilotAction[]})=>{if(active){const scope=new Set(allowedLocations);setActions((body.actions||[]).filter(action=>scope.has(action.location)));}})
      .catch(()=>{if(active)setActions([]);})
      .finally(()=>{if(active)setActionsLoading(false);});
    return()=>{active=false;};
  },[open,locationKey]);

  const prompts=useMemo(()=>{
    const contextual=currentSection==='Gastos'?'¿Qué recibos están pendientes?':currentSection==='Horarios'?'¿Quién está cerca de overtime?':currentSection==='Tasks'?'¿Qué tasks faltan hoy?':currentSection==='Google Reviews'?'¿Hay reseñas críticas?':currentSection==='Bono semanal'?'¿Por qué no calificó mi restaurante?':undefined;
    return [...new Set([...(contextual?[contextual]:[]),...copilotSuggestedPrompts])].slice(0,5);
  },[currentSection]);

  const ask=(value?:string)=>{
    const next=(value??question).trim();
    if(!next)return;
    const response=answerCopilot(next,actions,undefined,modules,currentUserId);
    const userMessage:ChatMessage={id:makeId(),role:'user',text:next,createdAt:Date.now()};
    const assistantMessage:ChatMessage={id:makeId(),role:'assistant',text:response.answer,answer:response,createdAt:Date.now()+1};
    setMessages(items=>[...items,userMessage,assistantMessage].slice(-30));
    setQuestion('');
  };
  const submit=(event:FormEvent)=>{event.preventDefault();ask();};
  const keyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();ask();}};
  const reset=()=>{setMessages([greeting(currentUserName,allowedLocations)]);setQuestion('');};
  const navigate=(module:OpsVistaModule)=>{onNavigate(module);setOpen(false);};

  return <>
    <button type="button" className={`copilot-launcher ${open?'is-open':''}`} aria-label="Abrir OpsVista Assistant" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>
      <span className="copilot-launcher-icon">✦</span>
      <span className="copilot-launcher-copy"><strong>Ask OpsVista</strong><small>Q&amp;A · Go to the right module</small></span>
      <span className="copilot-launcher-state">{open?'×':'›'}</span>
    </button>

    {open&&<div className="copilot-backdrop" onMouseDown={()=>setOpen(false)}>
      <aside className="copilot-drawer" role="dialog" aria-modal="true" aria-label="OpsVista Assistant" onMouseDown={event=>event.stopPropagation()}>
        <header className="copilot-drawer-head">
          <div className="copilot-avatar">OV</div>
          <div><span>OPSVISTA ASSISTANT</span><strong>How can I help?</strong><small>{role} · {allowedLocations.join(', ')||'No location assigned'}</small></div>
          <button type="button" onClick={()=>setOpen(false)} aria-label="Cerrar chat">×</button>
        </header>

        <div className="copilot-context"><i></i><span>Answers respect your modules and locations</span>{actionsLoading&&<em>Updating context…</em>}</div>

        <div className="copilot-messages" aria-live="polite">
          {messages.map(message=><article key={message.id} className={`copilot-message ${message.role}`}>
            <div className="copilot-message-label">{message.role==='user'?'YOU':'OPSVISTA'}</div>
            <div className="copilot-bubble">
              <p>{message.text}</p>
              {message.answer?.observations&&message.answer.observations.length>0&&<div className="copilot-observations"><span>WHAT I FOUND</span>{message.answer.observations.map((item,index)=><p key={index}>{item}</p>)}</div>}
              {message.answer?.inference&&<div className="copilot-note inference"><span>INFERENCE</span><p>{message.answer.inference}</p></div>}
              {message.answer?.recommendation&&<div className="copilot-note recommendation"><span>NEXT STEP</span><p>{message.answer.recommendation}</p></div>}
              {message.answer?.module&&modules.includes(message.answer.module)&&<button type="button" className="copilot-open-module" onClick={()=>navigate(message.answer!.module!)}>Open {message.answer.moduleLabel||message.answer.module}<b>→</b></button>}
              {message.answer&&<div className="copilot-answer-meta"><span>{message.answer.confidence} confidence</span>{message.answer.sources.slice(0,3).map(source=><b key={source}>{source}</b>)}</div>}
            </div>
            {message.answer?.followUps&&message.answer.followUps.length>0&&<div className="copilot-followups">{message.answer.followUps.slice(0,2).map(prompt=><button type="button" key={prompt} onClick={()=>ask(prompt)}>{prompt}</button>)}</div>}
          </article>)}
          <div ref={endRef}/>
        </div>

        <div className="copilot-suggestions">{prompts.map(prompt=><button type="button" key={prompt} onClick={()=>ask(prompt)}>{prompt}</button>)}</div>

        <form className="copilot-composer" onSubmit={submit}>
          <textarea ref={inputRef} rows={2} value={question} onChange={event=>setQuestion(event.target.value)} onKeyDown={keyDown} placeholder="Escribe tu pregunta… / Ask a question…" aria-label="Pregunta para OpsVista"/>
          <button type="submit" disabled={!question.trim()} aria-label="Enviar pregunta">↑</button>
        </form>
        <footer className="copilot-footer"><span>OpsVista may show operational guidance; verify critical decisions.</span><button type="button" onClick={reset}>New chat</button></footer>
      </aside>
    </div>}
  </>;
}
