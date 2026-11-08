// Offline component tests. All HTTP is mocked and no business data is changed.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
const root=fileURLToPath(new URL('../',import.meta.url));
const nativeRequire=createRequire(new URL('../package.json',import.meta.url));
const React=nativeRequire('react');
const {renderToStaticMarkup}=nativeRequire('react-dom/server');
let seed={},index=0,effects=[],language='es';
const cache=new Map();
function load(file){
 if(file.endsWith('.css'))return {};
 if(cache.has(file))return cache.get(file).exports;
 const module={exports:{}};cache.set(file,module);
 const require=specifier=>{
  if(specifier==='react')return {...React,useState(initial){const key=index++;if(!Object.hasOwn(seed,key))seed[key]=typeof initial==='function'?initial():initial;return[seed[key],value=>{seed[key]=typeof value==='function'?value(seed[key]):value;}];},useEffect(fn){effects.push(fn);},useMemo:fn=>fn(),useRef:()=>({current:null})};
  if(specifier==='./i18n')return{useI18n:()=>({t:(en,es)=>language==='es'?es:en,locale:language==='es'?'es-MX':'en-US'})};
  if(specifier==='./MeetingAgreementPanel')return{MeetingAuditDetail:()=>null};
  if(!specifier.startsWith('.'))return nativeRequire(specifier);
  let target=resolve(dirname(file),specifier);if(target.endsWith('.js'))target=target.slice(0,-3)+'.ts';else if(!/\.(tsx?|css)$/.test(target))target+=existsSync(target+'.ts')?'.ts':'.tsx';
  return load(target);
 };
 const output=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
 new Function('require','module','exports',output)(require,module,module.exports);return module.exports;
}
const access=load(resolve(root,'src/accessControl.ts'));
const helpers=load(resolve(root,'shared/meetingAgreements.ts'));
const View=load(resolve(root,'src/AgreementsView.tsx')).default;
const user={id:'manager',name:'Manager Fixture',role:'Location Manager',locations:['Avon','Orange'],active:true};
access.bindAuthenticatedUser(user);
const meeting={weekStart:'2026-11-04',kpi:'labor',dataQuality:'estimated',nextReview:'Check next week'};
const fixture=(id,patch={})=>({id,title:id,location:'Avon',category:'Reunión semanal',status:'Assigned',severity:'High',signal:'Observed fixture',cause:'Fixture cause',recommendation:'Fixture correction',impact:'',ownerId:user.id,ownerName:user.name,dueAt:'2026-11-10',meeting,automated:false,priorityScore:0,sources:[],sourceIds:[],verificationStatus:'Pending',createdAt:'2026-11-04T10:00:00.000Z',updatedAt:'2026-11-04T10:00:00.000Z',...patch});
const records=[fixture('current'),fixture('blocked',{meeting:{...meeting,blocked:true},status:'Investigating'}),fixture('progress',{status:'Investigating',ownerId:'other',ownerName:'Other Fixture'}),fixture('closed',{status:'Completed',verificationNote:'Reviewed'}),fixture('previous',{meeting:{...meeting,weekStart:'2026-10-28'}}),fixture('previous-closed',{status:'Completed',meeting:{...meeting,weekStart:'2026-10-28'}}),fixture('future',{meeting:{...meeting,weekStart:'2026-11-11'}}),fixture('orange',{location:'Orange'})];
const people=[user,{id:'other',name:'Other Fixture',role:'Location Manager',locations:['Orange']},{id:'corporate',name:'Corporate Fixture',role:'Corporate',locations:[]}];
let props={currentUser:user,allowedLocations:['Avon','Orange']};
function tree(){index=0;effects=[];return View(props);}
function start(overrides={},nextProps={currentUser:user,allowedLocations:['Avon','Orange']}){props=nextProps;seed={0:structuredClone(records),1:people,2:'2026-11-04',12:false,...overrides};return tree();}
function nodes(node,predicate){if(!node||typeof node!=='object')return[];return[...(predicate(node)?[node]:[]),...[node.props?.children].flat(Infinity).flatMap(child=>nodes(child,predicate))];}
function content(node){if(node==null||typeof node==='boolean')return '';if(typeof node==='string'||typeof node==='number')return String(node);return [node?.props?.children].flat(Infinity).map(content).join('');}
const button=label=>nodes(tree(),n=>n.type==='button'&&content(n)===label)[0];
const control=label=>nodes(tree(),n=>n.props?.['aria-label']===label)[0];
const rows=()=>nodes(tree(),n=>n.props?.className?.startsWith('ag-card ')).map(n=>n.key);
const card=id=>nodes(tree(),n=>n.props?.className?.startsWith('ag-card ')&&n.key===id)[0];
const input=label=>{const node=nodes(tree(),n=>n.type==='label'&&typeof n.props.children?.[0]==='string'&&n.props.children[0]===label)[0];assert.ok(node,label);return nodes(node,n=>['input','select','textarea'].includes(n.type))[0];};
const form=()=>nodes(tree(),n=>n.type==='form')[0];
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const originalFetch=globalThis.fetch;
let requests=[],mode='success',delivery='accepted';
globalThis.fetch=async(url,options={})=>{
 requests.push({url,options,payload:options.body?JSON.parse(options.body):undefined});
 if(mode==='throw')throw new Error('Fixture network failure');
 if(mode==='conflict')return{ok:false,status:409,json:async()=>({error:'Fixture stale edit'})};
 if(!options.method)return{ok:true,json:async()=>String(url).includes('&id=')?{audit:[]}:{actions:[...records,fixture('forbidden',{location:'Forbidden'}),fixture('ordinary',{meeting:undefined})],assignees:people}};
 const payload=JSON.parse(options.body);const action={...fixture(payload.id||'created'),...payload,updatedAt:'2026-11-08T10:00:00.000Z'};
 return{ok:true,json:async()=>({action,notificationDelivery:{status:payload.notifyOwner?delivery:'not_requested'}})};
};
try{
 for(const [role,permission] of Object.entries(access.rolePermissions))assert.equal(permission.modules.includes('Acuerdos'),permission.modules.includes('Action Center'),role);
 assert.throws(()=>helpers.parseMeetingAgreement({...meeting,blocked:'yes'}));
 assert.equal(helpers.parseMeetingAgreement({...meeting,blocked:true}).blocked,true);
 start();assert.deepEqual(rows(),['current','blocked','progress','previous','orange']);
 control('Estado').props.onChange({target:{value:'all'}});assert.ok(rows().includes('closed'));assert.ok(!rows().includes('previous-closed'));assert.ok(!rows().includes('future'));
 control('Locación').props.onChange({target:{value:'Avon'}});assert.ok(!rows().includes('orange'));
 control('Responsable').props.onChange({target:{value:'other'}});assert.deepEqual(rows(),['progress']);
 control('Buscar acuerdos').props.onChange({target:{value:'not a match'}});assert.deepEqual(rows(),[]);
 start();nodes(tree(),n=>n.props?.type==='checkbox')[0].props.onChange({target:{checked:false}});assert.ok(!rows().includes('previous'));
 control('Estado').props.onChange({target:{value:'blocked'}});assert.deepEqual(rows(),['blocked']);
 control('Estado').props.onChange({target:{value:'completed'}});assert.deepEqual(rows(),['closed']);
 start();const listEffect=effects[0];listEffect();await tick();await tick();assert.ok(!seed[0].some(row=>['ordinary','forbidden'].includes(row.id)),'load filters ordinary actions and forbidden locations');
 start();card('current').props.onClick();assert.ok(button('Mensaje al responsable'));
 button('Mensaje al responsable').props.onClick();assert.equal(requests.filter(r=>r.options.method).length,0,'Opening preview never sends');
 assert.match(renderToStaticMarkup(tree()),/Solo a este responsable/);assert.match(renderToStaticMarkup(tree()),/Check next week/);
 button('Cancelar').props.onClick();assert.equal(seed[17],false);
 for(const [value,pattern] of [['accepted',/Esto no confirma que se haya leído/],['pending',/Aviso pendiente/],['unconfirmed',/No se pudo confirmar el envío/]]){
  delivery=value;button('Mensaje al responsable').props.onClick();button('Enviar aviso').props.onClick();await tick();await tick();
  const last=requests.at(-1);assert.equal(last.options.method,'PUT');assert.equal(last.payload.notifyOwner,true);assert.equal(last.payload.id,'current');assert.ok(last.payload.expectedUpdatedAt);assert.equal(last.payload.ownerId,undefined);assert.match(seed[15],pattern);
 }
 start();card('current').props.onClick();button('Mensaje al responsable').props.onClick();mode='throw';button('Enviar aviso').props.onClick();await tick();await tick();assert.equal(seed[15],'','Network failure must not claim success');assert.equal(seed[17],false,'Do not leave an uncertain send open for accidental retries');assert.ok(seed[14]);mode='success';
 start();card('current').props.onClick();button('Mensaje al responsable').props.onClick();mode='conflict';button('Enviar aviso').props.onClick();await tick();await tick();assert.equal(seed[16],true);assert.equal(seed[15],'');mode='success';
 start();button('+ Nuevo acuerdo').props.onClick();assert.ok(form());
 for(const [label,value] of [['Acuerdo','Created fixture'],['Acción correctiva','Fix fixture'],['Responsable','manager'],['Fecha compromiso','2026-11-10'],['Próxima revisión','Review fixture']])input(label).props.onChange({target:{value}});
 const owners=nodes(input('Responsable'),n=>n.type==='option').map(n=>n.props.value);assert.ok(!owners.includes('other'));assert.ok(owners.includes('corporate'));
 await form().props.onSubmit({preventDefault(){}});assert.equal(requests.at(-1).payload.notifyOwner,false);assert.equal(requests.at(-1).options.method,'POST');assert.equal(seed[9],null);assert.match(seed[15],/No se envió ningún mensaje/);
 start();card('current').props.onClick();button('Revisar y actualizar').props.onClick();assert.equal(input('Miércoles de inicio').props.disabled,true,'Original meeting week is immutable');assert.equal(input('Locación').props.disabled,true,'Editing does not silently move locations');input('Estado').props.onChange({target:{value:'blocked'}});await form().props.onSubmit({preventDefault(){}});
 assert.equal(requests.at(-1).payload.meeting.blocked,true);assert.equal(requests.at(-1).payload.status,'Investigating');assert.equal(requests.at(-1).payload.expectedUpdatedAt,records[0].updatedAt);assert.equal(requests.at(-1).payload.notifyOwner,false);
 start();card('current').props.onClick();button('Revisar y actualizar').props.onClick();input('Estado').props.onChange({target:{value:'completed'}});const prior=requests.length;await form().props.onSubmit({preventDefault(){}});assert.equal(requests.length,prior);assert.match(seed[14],/evidencia/);
 input('Resultado / evidencia').props.onChange({target:{value:'Verified fixture'}});await form().props.onSubmit({preventDefault(){}});assert.equal(requests.at(-1).payload.verificationStatus,undefined,'Completing an agreement does not assert the intervention worked');assert.equal(requests.at(-1).payload.verifiedAt,undefined);assert.equal(requests.at(-1).payload.status,'Completed');
 start();card('current').props.onClick();button('Revisar y actualizar').props.onClick();mode='conflict';await form().props.onSubmit({preventDefault(){}});assert.equal(seed[16],true);assert.ok(seed[9]);assert.ok(button('Descartar cambios sin guardar y actualizar'));assert.equal(seed[15],'');mode='success';
 for(const previewProps of [{currentUser:user,allowedLocations:['Avon'],readOnly:true},{currentUser:{...user,id:'preview'},allowedLocations:['Avon']}]){
  start({8:'current'},previewProps);assert.equal(button('+ Nuevo acuerdo'),undefined);assert.equal(button('Revisar y actualizar'),undefined);assert.equal(button('Mensaje al responsable'),undefined);assert.match(renderToStaticMarkup(tree()),/solo lectura/);
 }
 start({8:'current'},{currentUser:{...user,role:'HR'},allowedLocations:['Avon']});button('Revisar y actualizar').props.onClick();assert.equal(nodes(input('Estado'),n=>n.type==='option'&&n.props.value==='completed')[0].props.disabled,true);
 start();language='en';assert.match(renderToStaticMarkup(tree()),/Every agreement, a next step/);language='es';
 assert.equal(records[0].title,'current','Fixtures remain unchanged');
 console.log('Agreements workspace passed: filters, scope, owner eligibility, explicit-send preview, no-send saves, payloads, blocked/completed, evidence, conflicts, read-only previews and bilingual labels. No live writes or messages.');
}finally{globalThis.fetch=originalFetch;}
