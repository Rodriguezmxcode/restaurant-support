let purchaseSnapshot, purchaseLoading=false;
const purchaseElement=id=>document.getElementById(id);
const safeTable=(head,rows)=>'<table><thead><tr>'+head.map(v=>'<th>'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(cells=>'<tr>'+cells.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
function renderPurchases(rows){
  if(rcView==='inbox'){
    const tasks=[];
    for(const invoice of rows){
      if(invoice.type!=='Invoice')continue;
      const status=RC.state(RD,RS,invoice.id);
      const add=(task,role)=>tasks.push([esc(invoice.location),esc(invoice.vendor),esc(task),esc(role),'<button class="btn" data-open-invoice="'+esc(invoice.id)+'">'+esc(invoice.number||'Ver factura')+' · Ver evidencia</button>']);
      if(status.issued>status.cleared)add('Confirmar débito bancario','Administración');
      if(invoice.amount===null||!invoice.includedInPNL||invoice.missingItemsReported==='Yes'||!['Completa','No aplica'].includes(status.receipt))add('Revisar factura y recepción','Manager de '+invoice.location);
    }
    purchaseElement('inbox-list').innerHTML=tasks.length?safeTable(['Sucursal','Proveedor','Siguiente paso','Responsable por función','Factura'],tasks.sort((a,b)=>a[0].localeCompare(b[0]))):RD.sync?'Sin pendientes con estos filtros.':'Esperando la consulta de facturas.';
  }
  if(!['matrix','prices'].includes(rcView))return;
  if(purchaseSnapshot){drawPurchases();return;}
  if(purchaseLoading)return;
  purchaseLoading=true;
  const panels=['price-list','purchase-grid'].map(purchaseElement);
  panels.forEach(el=>el.textContent='Consultando facturas…');
  fetch('/api/restaurant365?view=purchase-modules',{cache:'no-store'}).then(async r=>{
    if(!r.ok)throw Error();
    purchaseSnapshot=await r.json();drawPurchases();
  }).catch(()=>panels.forEach(el=>el.textContent='No se pudo consultar la información. Vuelve a abrir el módulo para reintentar.')).finally(()=>purchaseLoading=false);
}
function drawPurchases(){
  if(!purchaseSnapshot)return;
  const {prices,coverage,state,locations}=purchaseSnapshot;
  if(rcView==='matrix'){
    const year=purchaseElement('purchase-year').value;
    const months=Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'));
    const branches=[...new Set([...locations,...Object.keys(coverage)])].filter(Boolean).sort();
    const rows=branches.map(branch=>[esc(branch),...months.map(month=>{
      const count=coverage[branch]?.[year+'-'+month]||0;
      const partial=state!=='complete';
      const label=count?(count+' facturas'+(partial?' · parcial':'')):(partial?'Carga incompleta':'Por verificar');
      return '<span class="rc-chip '+(count&&!partial?'rc-confirmed':'rc-pending')+'">'+esc(label)+'</span>';
    })]);
    purchaseElement('purchase-grid').innerHTML=safeTable(['Sucursal','Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'],rows);
    return;
  }
  const term=purchaseElement('price-find').value.trim().toLowerCase();
  const groups=new Map();
  for(const line of prices){
    if(!(line.item+' '+line.id).toLowerCase().includes(term))continue;
    const key=JSON.stringify([line.id,line.unit.trim().toLowerCase()]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(line);
  }
  const select=purchaseElement('price-item'),before=select.value;
  select.replaceChildren(...Array.from(groups,([key,lines])=>new Option(lines[0].item+' · '+(lines[0].unit||'Unidad pendiente'),key)));
  if(groups.has(before))select.value=before;
  const lines=groups.get(select.value)||[];
  const sorted=[...lines].sort((a,b)=>b.date.localeCompare(a.date)||String(b.number).localeCompare(String(a.number)));
  const history=sorted.filter(x=>/southington/i.test(x.location));
  const price=x=>x?.cost>0&&x.unit?'$'+x.cost.toFixed(2)+' / '+esc(x.unit):'Pendiente de verificar';
  const other=sorted.filter(x=>!/southington/i.test(x.location));
  const previous=history.find(x=>x.number!==history[0]?.number||x.date!==history[0]?.date);
  const list=[['Última de Southington',history[0]],['Anterior de Southington',previous],...Array.from(new Set(other.map(x=>x.location)),loc=>['Última de '+loc,other.find(x=>x.location===loc)])];
  purchaseElement('price-list').innerHTML=lines.length?safeTable(['Comparación','Fecha','Factura','Precio por unidad'],list.map(([label,x])=>[esc(label),esc(x?.date||'—'),esc(x?.number||'—'),x?price(x):'Sin factura disponible'])):'Sin productos PFG con partidas importadas que coincidan.';
}
purchaseElement('price-find').oninput=drawPurchases;
purchaseElement('price-item').onchange=drawPurchases;
purchaseElement('purchase-year').value=new Date().getFullYear();
purchaseElement('purchase-year').oninput=drawPurchases;
