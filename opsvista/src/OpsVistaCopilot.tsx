import { useMemo, useState } from 'react';
import { answerCopilot, copilotSuggestedPrompts, type CopilotAction } from './copilot';
import './copilot.css';

type Props = {
  actions: CopilotAction[];
  selected?: CopilotAction;
};

export default function OpsVistaCopilot({ actions, selected }: Props) {
  const [question,setQuestion] = useState('Resume lo más importante de hoy');
  const [submitted,setSubmitted] = useState('Resume lo más importante de hoy');
  const answer = useMemo(()=>answerCopilot(submitted,actions,selected),[submitted,actions,selected]);

  const ask = (value?:string) => {
    const next=(value ?? question).trim();
    if(!next) return;
    setQuestion(next);
    setSubmitted(next);
  };

  return <section className="copilot-panel">
    <div className="copilot-head">
      <div><span>OPSVISTA AI COPILOT · GROUNDED V1</span><h2>Ask OpsVista</h2><p>Explains what is happening using the operational context already in Action Center. Observations, inferences and recommendations stay visibly separated.</p></div>
      <div className="copilot-status"><i></i>Grounded in current actions</div>
    </div>

    <div className="copilot-prompts">{copilotSuggestedPrompts.map(p=><button key={p} onClick={()=>ask(p)}>{p}</button>)}</div>

    <div className="copilot-input"><input value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')ask();}} placeholder="Ask what is happening, why, or what to do next..."/><button onClick={()=>ask()}>Ask OpsVista</button></div>

    <div className="copilot-answer">
      <div className="copilot-answer-top"><div><span>ANSWER</span><strong>{answer.answer}</strong></div><em>{answer.confidence} confidence</em></div>
      {!!answer.observations.length&&<div className="copilot-block observed"><label>OBSERVED</label>{answer.observations.map((o,i)=><p key={i}>{o}</p>)}</div>}
      {answer.inference&&<div className="copilot-block inference"><label>INFERENCE</label><p>{answer.inference}</p></div>}
      {answer.recommendation&&<div className="copilot-block recommendation"><label>RECOMMENDED NEXT MOVE</label><p>{answer.recommendation}</p></div>}
      <div className="copilot-sources"><span>Sources</span>{answer.sources.map(s=><b key={s}>{s}</b>)}</div>
    </div>

    <div className="copilot-guardrail"><strong>Human decision guardrail</strong><span>Copilot can surface patterns and likely causes. It does not determine misconduct, guilt, theft or intent. When evidence is incomplete, the answer must say so.</span></div>
  </section>;
}
