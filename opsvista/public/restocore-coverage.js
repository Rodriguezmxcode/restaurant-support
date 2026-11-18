function rcRenderCoverage(){
 const yearInput=document.getElementById('rc-coverage-year');if(!yearInput)return;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const year=Number(yearInput.value)||Number(today.slice(0,4));yearInput.value=String(year);
 const scope=document.getElementById('rc-location').value;
 const months=RCOv.coverage(RD,year,scope,today);
 const monthSelect=document.getElementById('rc-month-filter'),chosen=monthSelect.value;
 const years=new Set(RD.invoices.map(i=>Number(i.date.slice(0,4))));for(const r of RD.sync?.ranges||[]){years.add(Number(r.start.slice(0,4)));years.add(Number(r.end.slice(0,4)));}
 const loaded=[...years].flatMap(y=>RCOv.coverage(RD,y,'',today)).filter(m=>m.covered||RD.invoices.some(i=>i.date.startsWith(m.month))).sort((a,b)=>a.month.localeCompare(b.month));
 monthSelect.innerHTML='<option value="">Todos los meses cargados</option>'+loaded.map(m=>`<option value="${m.month}">${new Intl.DateTimeFormat('es-MX',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(m.start))}</option>`).join('');monthSelect.value=chosen;if(monthSelect.selectedIndex===-1)monthSelect.value='';
 document.getElementById('rc-months-coverage').innerHTML=months.map(m=>{const label=new Intl.DateTimeFormat('es-MX',{month:'long',timeZone:'UTC'}).format(new Date(m.start));let status={complete:m.count?'Mes completo consultado':'Consultado · sin facturas',partial:`Parcial · ${m.covered} de ${m.days} días`,unknown:'Pendiente de consultar',future:'Mes futuro'}[m.status];let cls=m.status==='complete'?'rc-approved':m.status==='future'?'':'rc-pending';if(RD.kind!=='opsvista'){status=m.count?'Histórico del P&L · cobertura no verificada':'Sin datos en este archivo';cls='';}return `<article class="rc-month-card"><strong>${label} ${year}</strong><span class="rc-chip ${cls}">${status}</span><small>${m.covered||m.count?m.count+' documentos en esta selección':'Cantidad por verificar'}</small></article>`;}).join('');
 document.getElementById('rc-months-note').textContent=RD.kind==='opsvista'?'La cobertura corresponde a la sucursal seleccionada. “Pendiente de consultar” no significa que el mes esté vacío en Restaurant365.':'Esta es la carga histórica del P&L; no confirma cobertura de Restaurant365.';
}
document.getElementById('rc-coverage-year').addEventListener('change',rcRenderCoverage);
rcRenderCoverage();
