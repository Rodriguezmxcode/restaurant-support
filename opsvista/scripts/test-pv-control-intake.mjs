import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../public/pv-control.html',import.meta.url),'utf8');
const code=(await readFile(new URL('../public/pv-control.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'');
const nodes=new Map();
function node(){return {textContent:'',className:'',hidden:true,disabled:false,value:'',children:[],events:{},addEventListener(name,fn){this.events[name]=fn},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=[...items]},get firstChild(){return this.children[0]}}}
for(const [,id] of html.matchAll(/\bid="([^"]+)"/g))nodes.set(id,node());
const listeners={},requests=[],sent=[];
const channel='a'.repeat(32),opener={postMessage(){}};
const candidate={client_id:'12345678-1234-4234-8234-123456789012',source:'pv-control',location_id:'avon',transaction_date:'2026-09-22',vendor_name:'<img onerror=evil()>',number:'REAL-1',amount:25.5,currency:'USD',lane:'vendor',key_item:'Food',notes:'<script>no execution</script>'};
let rejectPost=true;
const context={console,Intl,Date,URLSearchParams,AbortSignal,structuredClone,
  location:{hash:'#pv_channel='+channel},
  document:{getElementById:id=>nodes.get(id),createElement:node,createDocumentFragment:node},
  Option:function(text,value){return {...node(),textContent:text,value}},
  collectInvoices:async()=>{throw Error('not used')},
  window:{opener,addEventListener(name,fn){listeners[name]=fn}},
  fetch:async(url,options)=>{
    requests.push({url,...options});
    const endpoint=url.split('/').at(-1);
    let body={ok:true,organization_id:'org-puerto-vallarta'},status=200;
    if(endpoint==='locations')body={...body,api_version:'1',data:[{id:'avon',name:'Avon'}]};
    if(endpoint==='submissions'&&options.method==='GET')body={...body,data:[],total:0};
    if(endpoint==='submissions'&&options.method==='POST'){
      if(rejectPost){status=503;body={error:{message:'Retry'}}}
      else body={...body,created:true,client_id:candidate.client_id,invoice:{...candidate,id:'87654321-1234-4234-8234-123456789012',received_at:'2026-09-22T12:00:00Z',receipt_status:'received'}};
    }
    return {ok:status<400,status,json:async()=>body,headers:{get(){return null}}};
  }
};
vm.createContext(context);vm.runInContext(code,context);await new Promise(setImmediate);
assert.equal(requests.filter(r=>r.method==='POST').length,0);
const port={onmessage:null,start(){},postMessage(data){sent.push(data)}};
listeners.message({source:{},origin:'null',data:{type:'pv-control-connect',channel},ports:[port]});assert.equal(port.onmessage,null);
listeners.message({source:opener,origin:'null',data:{type:'pv-control-connect',channel},ports:[port]});assert.equal(typeof port.onmessage,'function');
port.onmessage({data:{type:'pv-control-submit-preview',channel:'wrong',invoice:candidate}});assert.equal(nodes.get('pv-preview').hidden,true);
port.onmessage({data:{type:'pv-control-submit-preview',channel,invoice:candidate}});assert.equal(nodes.get('pv-preview').hidden,false);
assert.equal(requests.filter(r=>r.method==='POST').length,0);
assert.equal(nodes.get('pv-preview-row').children[0].children[2].textContent,candidate.vendor_name);
await nodes.get('pv-submit').events.click();assert.equal(sent.length,0);assert.equal(nodes.get('pv-submit').disabled,false);
rejectPost=false;await nodes.get('pv-submit').events.click();assert.equal(sent.length,1);assert.equal(sent[0].client_id,candidate.client_id);assert.equal(sent[0].type,'pv-control-submitted');
const posts=requests.filter(r=>r.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].body,posts[1].body);
assert.equal(posts[1].credentials,'same-origin');assert.equal(posts[1].headers['X-PV-Source'],'pv-control');
console.log('PASS: bound port, preview without write, explicit confirmation, safe text rendering, no false receipt on failure, and identical retry.');
