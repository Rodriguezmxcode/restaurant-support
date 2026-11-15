// OpsVista CustomDateRangePicker, adapted to standalone HTML (no external dependencies).
(()=>{
 const el=id=>document.getElementById(id),modal=el('rc-calendar'),trigger=el('rc-period-trigger');
 const from=el('rc-ov-start'),to=el('rc-ov-end');
 const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
 const date=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,12);};
 const valid=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
 const add=(s,n)=>{const d=date(s);d.setDate(d.getDate()+n);return iso(d);};
 const month=(s,n=0)=>{const d=date(s);return new Date(d.getFullYear(),d.getMonth()+n,1,12);};
 const format=s=>valid(s)?new Intl.DateTimeFormat('en-US',{month:'2-digit',day:'2-digit',year:'numeric',timeZone:'UTC'}).format(new Date(s+'T12:00:00Z')):'Seleccionar';
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let start='',end='',visible=month(today()),presets=[],previousOverflow='';
 function syncLabel(){el('rc-period-label').textContent=valid(from.value)&&valid(to.value)?`${format(from.value)} → ${format(to.value)}`:'Seleccionar fechas';}
 function buildPresets(){const t=today(),week=add(t,-((date(t).getDay()-3+7)%7));return [
  ['Hoy',t,t],['Ayer',add(t,-1),add(t,-1)],['Esta semana',week,t],['Semana anterior',add(week,-7),add(week,-1)],
  ['Últimos 7 días',add(t,-6),t],['Últimos 30 días',add(t,-29),t],['Este mes',iso(month(t)),t],['Mes anterior',iso(month(t,-1)),add(iso(month(t)),-1)]
 ];}
 function calendar(m,index){
  const title=new Intl.DateTimeFormat('es-MX',{month:'long',year:'numeric'}).format(m),first=new Date(m),cells=[];first.setDate(1-first.getDay());
  for(let n=0;n<42;n++){
   const d=new Date(first);d.setDate(first.getDate()+n);const value=iso(d),selected=value===start||value===end,between=start&&end&&value>start&&value<end;
   cells.push(`<button type="button" data-calendar-day="${value}" class="${d.getMonth()!==m.getMonth()?'outside ':''}${selected?'selected ':''}${between?'between ':''}${value===today()?'today':''}" aria-pressed="${selected}" aria-label="${format(value)}"${value===today()?' aria-current="date"':''}>${d.getDate()}</button>`);
  }
  return `<section class="range-calendar-month" aria-labelledby="rc-month-${index}"><h3 id="rc-month-${index}">${title}</h3><div class="range-calendar-weekdays" aria-hidden="true">${['Do','Lu','Ma','Mi','Ju','Vi','Sá'].map(d=>`<span>${d}</span>`).join('')}</div><div class="range-calendar-days">${cells.join('')}</div></section>`;
 }
 function render(focusDate){
  el('rc-calendar-months').innerHTML=calendar(visible,0)+calendar(new Date(visible.getFullYear(),visible.getMonth()+1,1,12),1);
  el('rc-calendar-presets').innerHTML='<div><span>RANGOS RÁPIDOS</span><strong>Semana operativa<br>miércoles–martes</strong></div>'+presets.map((p,i)=>`<button type="button" data-calendar-preset="${i}" class="${p[1]===start&&p[2]===end?'active':''}"><strong>${p[0]}</strong><span>${format(p[1])} – ${format(p[2])}</span></button>`).join('');
  el('rc-calendar-from').textContent=format(start);el('rc-calendar-to').textContent=format(end);
  let error='';if(start&&end){try{RCOv.period(start,end);}catch(e){error=e.message;}}
  el('rc-calendar-error').textContent=error;
  el('rc-calendar-apply').disabled=!start||!end||!!error;
  el('rc-calendar-instruction').textContent=start&&!end?'Ahora selecciona la fecha final':start&&end?`${Math.round((Date.parse(end)-Date.parse(start))/86400000)+1} día(s) seleccionados`:'Selecciona la fecha inicial';
  if(focusDate){const candidate=[...modal.querySelectorAll('[data-calendar-day]')].find(b=>b.dataset.calendarDay===focusDate&&b.getClientRects().length);candidate?.focus();}
 }
 function open(){start=valid(from.value)?from.value:'';end=valid(to.value)?to.value:'';visible=month(start||today());presets=buildPresets();render();modal.hidden=false;trigger.setAttribute('aria-expanded','true');previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';el('rc-calendar-close').focus();}
 function close(){modal.hidden=true;trigger.setAttribute('aria-expanded','false');document.body.style.overflow=previousOverflow;trigger.focus();}
 trigger.addEventListener('click',open);
 el('rc-calendar-close').addEventListener('click',close);el('rc-calendar-cancel').addEventListener('click',close);
 modal.addEventListener('click',event=>{if(event.target===modal)close();});
 el('rc-calendar-months').addEventListener('click',event=>{const b=event.target.closest('[data-calendar-day]');if(!b)return;const value=b.dataset.calendarDay;if(!start||end||value<start){start=value;end='';}else end=value;render(value);});
 el('rc-calendar-presets').addEventListener('click',event=>{const b=event.target.closest('[data-calendar-preset]');if(!b)return;const p=presets[Number(b.dataset.calendarPreset)];start=p[1];end=p[2];visible=month(start);render();el('rc-calendar-apply').focus();});
 for(const [id,n] of [['rc-calendar-prev',-1],['rc-calendar-next',1]])el(id).addEventListener('click',()=>{visible=new Date(visible.getFullYear(),visible.getMonth()+n,1,12);render();});
 el('rc-calendar-apply').addEventListener('click',()=>{try{RCOv.period(start,end);}catch(e){el('rc-calendar-error').textContent=e.message;return;}from.value=start;to.value=end;from.dispatchEvent(new Event('change',{bubbles:true}));to.dispatchEvent(new Event('change',{bubbles:true}));syncLabel();close();});
 modal.addEventListener('keydown',event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();return;}
  if(event.key==='Tab'){const buttons=[...modal.querySelectorAll('button:not(:disabled)')].filter(b=>b.getClientRects().length),first=buttons[0],last=buttons.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
  const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key],day=event.target.dataset?.calendarDay;
  if(day&&delta){event.preventDefault();const target=add(day,delta);if(![...modal.querySelectorAll('[data-calendar-day]')].some(b=>b.dataset.calendarDay===target&&b.getClientRects().length))visible=month(target);render(target);}
 });
 from.addEventListener('change',syncLabel);to.addEventListener('change',syncLabel);syncLabel();
})();
