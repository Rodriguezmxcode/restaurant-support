import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { corporateCategories, corporateSections, stableCorporateRowKey, suggestCorporateClassification, summarizeCorporateRows, type CorporateExpenseRow, type CorporateImportResponse, type CorporatePnlSection } from '../shared/corporateImports';
import './corporateImport.css';

const usd=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2});
const priorMonth=()=>{const d=new Date();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-1);return d.toISOString().slice(0,7);};
const norm=(value:unknown)=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const asNumber=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)?value:typeof value==='string'&&value.trim()&&Number.isFinite(Number(value.replace(/[$,]/g,'')))?Number(value.replace(/[$,]/g,'')):0;
const asDate=(value:unknown)=>{
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.toISOString().slice(0,10);
  if(typeof value==='number'){
    const parsed=XLSX.SSF.parse_date_code(value);
    if(parsed)return `${parsed.y}-${String(parsed.m).padStart(2,'0')}-${String(parsed.d).padStart(2,'0')}`;
  }
  if(typeof value==='string'&&value.trim()){
    const direct=new Date(value);
    if(!Number.isNaN(direct.getTime()))return direct.toISOString().slice(0,10);
  }
  return '';
};
const rowsOf=(book:XLSX.WorkBook,name:string)=>book.Sheets[name]?XLSX.utils.sheet_to_json(book.Sheets[name],{header:1,raw:true,defval:null}) as unknown[][]:[];
const sheetName=(book:XLSX.WorkBook,wanted:string)=>book.SheetNames.find(name=>norm(name)===norm(wanted));
const makeRow=(input:Omit<CorporateExpenseRow,'key'>):CorporateExpenseRow=>({...input,key:stableCorporateRowKey(input)});

function bankStatementMonths(book:XLSX.WorkBook){
  const name=sheetName(book,'Detalle bancario'); if(!name)return new Set<string>();
  const sheet=rowsOf(book,name),header=sheet.findIndex(row=>norm(row[0])==='fecha'&&norm(row[1])==='tipo'&&norm(row[2]).includes('contraparte'));
  const months=new Set<string>(); if(header<0)return months;
  for(let index=header+1;index<sheet.length;index++){
    const date=asDate(sheet[index]?.[0]),type=norm(sheet[index]?.[1]);
    if(date&&(type==='entrada'||type==='salida'))months.add(date.slice(0,7));
  }
  return months;
}

function payrollRows(book:XLSX.WorkBook,fileName:string,allowedMonths:Set<string>){
  const name=sheetName(book,'Detalle nómina'); if(!name)return {rows:[] as CorporateExpenseRow[],months:new Set<string>()};
  const sheet=rowsOf(book,name), find=(label:string)=>sheet.findIndex(row=>norm(row[0])===norm(label));
  const check=find('Check Date del reporte'),gross=find('Sueldos brutos'),er=find('Impuestos patronales'),service=find('Servicio Toast e impuesto del servicio');
  if(check<0||gross<0||er<0||service<0)return {rows:[] as CorporateExpenseRow[],months:new Set<string>()};
  const result:CorporateExpenseRow[]=[],months=new Set<string>();
  for(let col=1;col<sheet[check].length;col++){
    const date=asDate(sheet[check][col]); if(!date)continue; const month=date.slice(0,7); if(allowedMonths.size&&!allowedMonths.has(month))continue; months.add(month);
    const specs:[number,string,CorporatePnlSection,string][]=[
      [gross,'Sueldos brutos','Labor','Wages & Salaries'],[er,'Impuestos patronales (ER)','Labor','Employer Payroll Taxes'],[service,'Servicio Toast e impuesto','Operating Expenses','Payroll Processing'],
    ];
    for(const [rowIndex,description,section,category] of specs){const amount=asNumber(sheet[rowIndex]?.[col]);if(!amount)continue;result.push(makeRow({date,description,vendor:'Toast Payroll',amount,section,category,includeInPnl:true,sourceFile:fileName,sourceSheet:name,sourceRow:rowIndex+1,notes:'Desglose de Payroll Summary. Retenciones de empleados no se suman nuevamente.',confidence:'auto'}));}
  }
  return {rows:result,months};
}

function bankRows(book:XLSX.WorkBook,fileName:string,detailedPayrollMonths:Set<string>){
  const name=sheetName(book,'Detalle bancario'); if(!name)return [] as CorporateExpenseRow[];
  const sheet=rowsOf(book,name),header=sheet.findIndex(row=>norm(row[0])==='fecha'&&norm(row[1])==='tipo'&&norm(row[2]).includes('contraparte'));
  if(header<0)return [];
  const result:CorporateExpenseRow[]=[];
  for(let index=header+1;index<sheet.length;index++){
    const row=sheet[index],date=asDate(row[0]),type=norm(row[1]);
    if(!date||type!=='salida')continue;
    const counterparty=String(row[2]??''),category=String(row[3]??''),amount=asNumber(row[5]); if(!amount)continue;
    const combined=`${counterparty} ${category}`;
    if(detailedPayrollMonths.has(date.slice(0,7))&&/toast payroll/i.test(combined))continue;
    const suggestion=suggestCorporateClassification(combined);
    result.push(makeRow({date,description:category||counterparty,vendor:counterparty,amount,section:suggestion.section,category:suggestion.category,includeInPnl:suggestion.includeInPnl,sourceFile:fileName,sourceSheet:name,sourceRow:index+1,notes:String(row[7]??row[6]??'')||undefined,confidence:suggestion.confidence}));
  }
  return result;
}

function rentRows(book:XLSX.WorkBook,fileName:string,allowedMonths:Set<string>){
  const name=sheetName(book,'Detalle bancario'); if(!name)return [] as CorporateExpenseRow[];
  const sheet=rowsOf(book,name),header=sheet.findIndex(row=>norm(row[0])==='mes asignado'&&norm(row[1]).includes('renta'));
  if(header<0)return [];
  const result:CorporateExpenseRow[]=[];
  for(let index=header+1;index<sheet.length;index++){
    const date=asDate(sheet[index]?.[0]),amount=asNumber(sheet[index]?.[1]); if(!date||!amount)break; if(allowedMonths.size&&!allowedMonths.has(date.slice(0,7)))continue;
    const payer=String(sheet[index]?.[2]??''),beneficiary=String(sheet[index]?.[3]??''),check=String(sheet[index]?.[4]??'');
    result.push(makeRow({date,description:`Renta corporativa completa${payer?` · pagada por ${payer}`:''}${check?` · cheque ${check}`:''}`,vendor:beneficiary||'325 Boston Post Rd LLC',amount,section:'Occupancy',category:'Corporate Office Rent',includeInPnl:true,sourceFile:fileName,sourceSheet:name,sourceRow:index+1,notes:String(sheet[index]?.[7]??'')||undefined,confidence:'auto'}));
  }
  return result;
}

function budgetRows(book:XLSX.WorkBook,fileName:string,allowedMonths:Set<string>){
  const name=sheetName(book,'Gastos corporativos'); if(!name)return [] as CorporateExpenseRow[];
  const sheet=rowsOf(book,name),index=sheet.findIndex(row=>norm(row[0])==='ramp mensual presupuestado'&&[1,2,3,4].every(col=>asNumber(row[col])>0));
  if(index<0)return [];
  let header=-1;for(let cursor=index-1;cursor>=Math.max(0,index-7);cursor--){if([1,2,3,4].every(col=>Boolean(asDate(sheet[cursor]?.[col])))){header=cursor;break;}}
  if(header<0)return [];
  return [1,2,3,4].map(col=>{const date=asDate(sheet[header][col]),amount=asNumber(sheet[index][col]);return makeRow({date,description:'Ramp mensual presupuestado',vendor:'Ramp',amount,section:'Review',category:'Budget / Forecast (excluded)',includeInPnl:false,sourceFile:fileName,sourceSheet:name,sourceRow:index+1,notes:'Presupuesto, no gasto real conciliado. Se excluye del P&L hasta sustituirse por cargos reales.',confidence:'review'});}).filter(row=>row.date&&row.amount&&(!allowedMonths.size||allowedMonths.has(row.date.slice(0,7))));
}

function genericRows(book:XLSX.WorkBook,fileName:string){
  const result:CorporateExpenseRow[]=[];
  for(const name of book.SheetNames){
    const sheet=rowsOf(book,name); let header=-1,dateCol=-1,descCol=-1,amountCol=-1,vendorCol=-1;
    for(let r=0;r<Math.min(sheet.length,25);r++){
      const labels=sheet[r].map(norm);dateCol=labels.findIndex(v=>v==='date'||v==='fecha');descCol=labels.findIndex(v=>/description|descripcion|descripción|concepto/.test(v));amountCol=labels.findIndex(v=>/amount|importe|gasto|expense|salida/.test(v));vendorCol=labels.findIndex(v=>/vendor|proveedor|contraparte/.test(v));if(dateCol>=0&&descCol>=0&&amountCol>=0){header=r;break;}
    }
    if(header<0)continue;
    for(let r=header+1;r<sheet.length;r++){const date=asDate(sheet[r][dateCol]),description=String(sheet[r][descCol]??''),amount=asNumber(sheet[r][amountCol]);if(!date||!description||!amount)continue;const vendor=vendorCol>=0?String(sheet[r][vendorCol]??''):'';const suggestion=suggestCorporateClassification(`${vendor} ${description}`);result.push(makeRow({date,description,vendor:vendor||undefined,amount,section:suggestion.section,category:suggestion.category,includeInPnl:suggestion.includeInPnl,sourceFile:fileName,sourceSheet:name,sourceRow:r+1,confidence:suggestion.confidence}));}
  }
  return result;
}

function parseWorkbook(book:XLSX.WorkBook,fileName:string){
  const coveredMonths=bankStatementMonths(book); const payroll=payrollRows(book,fileName,coveredMonths); const known=[...bankRows(book,fileName,payroll.months),...payroll.rows,...rentRows(book,fileName,coveredMonths),...budgetRows(book,fileName,coveredMonths)];
  const rows=known.length?known:genericRows(book,fileName);
  const unique=new Map<string,CorporateExpenseRow>();for(const row of rows)unique.set(row.key,row);
  if(!unique.size)throw new Error('No encontré una tabla de gastos reconocible. Usa columnas de fecha, concepto/description e importe/amount, o el formato corporativo actual.');
  return [...unique.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.sourceRow-b.sourceRow);
}

async function readSaved(signal?:AbortSignal):Promise<CorporateImportResponse>{const response=await fetch('/api/corporate-import',{credentials:'include',cache:'no-store',signal});const body=await response.json();if(!response.ok)throw new Error(body.error||'No se pudo abrir el P&L corporativo importado.');return body;}

export default function CorporateImportPanel(){
  const [data,setData]=useState<CorporateImportResponse>({rows:[],summary:summarizeCorporateRows([]),canImport:false});
  const [preview,setPreview]=useState<CorporateExpenseRow[]>([]),[sourceFile,setSourceFile]=useState(''),[month,setMonth]=useState(priorMonth());
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{const controller=new AbortController();void readSaved(controller.signal).then(body=>{setData(body);setError('');}).catch(reason=>setError(reason instanceof Error?reason.message:'No se pudo abrir Corporate Office.')).finally(()=>setLoading(false));return()=>controller.abort();},[]);
  const activeRows=preview.length?preview:data.rows;
  const months=useMemo(()=>[...new Set(activeRows.map(row=>row.date.slice(0,7)))].sort().reverse(),[activeRows]);
  const activeMonth=months.includes(month)?month:(months.includes(priorMonth())?priorMonth():months[0]||month);
  const visible=useMemo(()=>activeRows.filter(row=>row.date.startsWith(activeMonth)),[activeRows,activeMonth]);
  const summary=useMemo(()=>summarizeCorporateRows(visible),[visible]);
  const choose=async(event:ChangeEvent<HTMLInputElement>)=>{
    const file=event.target.files?.[0];event.target.value='';setError('');setNotice('');if(!file)return;
    if(file.size>10_000_000){setError('El archivo puede tener hasta 10 MB.');return;}
    try{const book=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:true});const rows=parseWorkbook(book,file.name);setPreview(rows);setSourceFile(file.name);const ms=[...new Set(rows.map(row=>row.date.slice(0,7)))];if(ms.includes(priorMonth()))setMonth(priorMonth());else if(ms.length)setMonth(ms.sort().reverse()[0]);setNotice(`${rows.length} movimientos preparados. Revisa las filas amarillas antes de guardar.`);}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo leer el archivo.');}
  };
  const update=(key:string,patch:Partial<CorporateExpenseRow>)=>setPreview(current=>current.map(row=>row.key===key?{...row,...patch,confidence:'manual'}:row));
  const changeSection=(row:CorporateExpenseRow,section:CorporatePnlSection)=>{const category=corporateCategories[section][0];update(row.key,{section,category,includeInPnl:section!=='Balance Sheet'&&section!=='Review'});};
  const save=async()=>{if(!preview.length)return;setSaving(true);setError('');setNotice('');try{const response=await fetch('/api/corporate-import',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:{schemaVersion:1,sourceFile,rows:preview}})});const body=await response.json();if(!response.ok)throw new Error(body.error||'No se pudo guardar.');const saved=await readSaved();setData(saved);setPreview([]);setNotice(`${body.saved} movimientos guardados en OpsVista. Volver a cargar el mismo archivo reemplaza esa versión sin duplicarla.`);}catch(reason){setError(reason instanceof Error?reason.message:'No se pudo guardar.');}finally{setSaving(false);}};
  return <section className="panel corp-import-panel" aria-label="Importación del P&L corporativo">
    <header><div><h2>P&L de Corporate Office</h2><p>Importa Excel, revisa la clasificación y guarda solo los costos que pertenecen al P&L. Transferencias, retenciones y presupuestos quedan fuera por defecto.</p></div><div className="corp-import-actions">{data.canImport&&<label className="corp-import-file">Subir Excel corporativo<input type="file" accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" onChange={event=>void choose(event)} disabled={saving}/></label>}{preview.length>0&&<button type="button" className="primary" onClick={()=>void save()} disabled={saving}>{saving?'Guardando…':'Guardar P&L en OpsVista'}</button>}</div></header>
    {loading&&<p role="status">Abriendo P&L corporativo guardado…</p>}{notice&&<p className="corp-import-notice" role="status">{notice}</p>}{error&&<p className="corp-import-error" role="alert">{error}</p>}
    <div className="corp-import-controls"><label>MES CONTABLE<select value={activeMonth} onChange={event=>setMonth(event.target.value)}>{months.length?months.map(value=><option key={value}>{value}</option>):<option>{activeMonth}</option>}</select></label>{preview.length>0&&<span className="corp-import-badge">PREVIEW · {sourceFile}</span>}{!preview.length&&data.updatedAt&&<span className="corp-import-badge">GUARDADO · {new Date(data.updatedAt).toLocaleString('es-MX',{timeZone:'America/New_York'})}</span>}</div>
    <div className="corp-import-summary"><Kpi label="P&L corporativo" value={usd.format(summary.total)}/><Kpi label="Labor" value={usd.format(summary.labor)}/><Kpi label="Gastos operativos" value={usd.format(summary.operatingExpenses)}/><Kpi label="Renta / ocupación" value={usd.format(summary.occupancy)}/><Kpi label="COGS" value={usd.format(summary.cogs)}/><Kpi label="Por revisar" value={String(summary.reviewCount)}/></div>
    {visible.length?<><div className="corp-import-preview-head"><div><h3>{preview.length?'Revisión antes de guardar':'Detalle guardado'}</h3><p>{visible.length} movimientos del mes · excluidos del P&L: {usd.format(summary.excluded)}</p></div></div><div className="corp-import-table-wrap"><table className="corp-import-table"><thead><tr><th>Fecha</th><th>Concepto / vendor</th><th>Importe</th><th>Sección P&L</th><th>Categoría</th><th>Incluir</th><th>Fuente</th></tr></thead><tbody>{visible.map(row=><tr key={row.key} className={`${row.section==='Review'?'review ':''}${!row.includeInPnl?'excluded':''}`}><td>{row.date}</td><td><strong>{row.description}</strong><small>{row.vendor||'Sin vendor'}</small>{row.notes&&<small>{row.notes}</small>}</td><td className="amount">{usd.format(row.amount)}</td><td>{preview.length?<select value={row.section} onChange={event=>changeSection(row,event.target.value as CorporatePnlSection)}>{corporateSections.map(value=><option key={value}>{value}</option>)}</select>:row.section}</td><td>{preview.length?<select value={row.category} onChange={event=>update(row.key,{category:event.target.value})}>{corporateCategories[row.section].map(value=><option key={value}>{value}</option>)}</select>:row.category}</td><td>{preview.length?<input type="checkbox" checked={row.includeInPnl} disabled={row.section==='Balance Sheet'||row.section==='Review'} onChange={event=>update(row.key,{includeInPnl:event.target.checked})}/>:row.includeInPnl?'Sí':'No'}</td><td className="corp-import-source">{row.sourceSheet} · fila {row.sourceRow}<small>{row.confidence==='review'?'Requiere revisión':row.confidence==='manual'?'Editado manualmente':'Clasificación automática'}</small></td></tr>)}</tbody></table></div><div className="corp-import-total"><span>Total P&L del mes:</span><strong>{usd.format(summary.total)}</strong></div></>:!loading&&<div className="corp-import-empty">No hay gastos corporativos importados para este periodo. {data.canImport?'Usa “Subir Excel corporativo” para preparar el P&L.':''}</div>}
    <p className="corp-import-help"><strong>Regla anti-duplicados:</strong> si el Excel contiene el detalle de nómina de un mes, OpsVista usa sueldos brutos + impuestos patronales + servicio Toast y omite los débitos bancarios Toast de ese mismo mes. Las retenciones del empleado no se suman otra vez.</p>
  </section>;
}
function Kpi({label,value}:{label:string;value:string}){return <div className="corp-import-kpi"><span>{label}</span><strong>{value}</strong></div>}
