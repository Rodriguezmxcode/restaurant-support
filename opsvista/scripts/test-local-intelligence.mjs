import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../server/localIntelligence.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
let run=0;
const fresh=()=>import('data:text/javascript;base64,'+Buffer.from(js+`\n// run ${++run}`).toString('base64'));
for(const key of ['TOMTOM_API_KEY','TICKETMASTER_API_KEY','WEATHER_API_KEY','WEATHER_COMPANY_API_KEY','OPSVISTA_LOCAL_INTELLIGENCE_SOURCE_URL']) delete process.env[key];
let mode='valid',calls=[];
globalThis.fetch=async(input)=>{
 const u=new URL(input);calls.push(u);
 if(u.hostname==='api.open-meteo.com')return Response.json({current:{temperature_2m:70,apparent_temperature:70,precipitation:0,wind_speed_10m:0}});
 assert.equal(u.hostname,'pv-operations.rodriguez10.chatgpt.site','do not waste timeout on broken app domain');
 if(mode==='down')return new Response('{}',{status:502});
 return Response.json({horizonDays:Number(u.searchParams.get('horizonDays')),startOffsetDays:0,rangeStart:u.searchParams.get('rangeStart'),rangeEnd:u.searchParams.get('rangeEnd'),radiusMiles:mode==='wrong-radius'?25:Number(u.searchParams.get('radiusMiles')),
 weather:[{name:'Stamford',temperature:70,wind:0}],traffic:[{name:'Stamford',currentSpeed:20,freeFlowSpeed:30,congestion:33,incidentCount:mode==='partial'?null:0,incidentsError:mode==='partial'?'TomTom incidents 403':null}],events:[{name:'Stamford',eventCount:42,events:[]}],errors:{},errorsByLocation:{}});
};
let module=await fresh(),data=await module.getLocalIntelligence(['Stamford'],module.localIntelligenceHorizons.today,5);
assert.equal(data.locations[0].events.eventCount,42);assert.equal(data.sharedSource,true);assert.equal(calls.length,1);
mode='partial';module=await fresh();data=await module.getLocalIntelligence(['Stamford'],module.localIntelligenceHorizons.today,5);
assert.equal(data.providers.find(p=>p.id==='traffic').state,'partial');assert.equal(data.locations[0].traffic.incidentCount,null);assert.match(data.locations[0].assessment.summary,/Incomplete/);
mode='wrong-radius';module=await fresh();data=await module.getLocalIntelligence(['Stamford'],module.localIntelligenceHorizons.today,5);
assert.equal(data.locations[0].events,null);assert.match(data.locations[0].errors.events,/radius/);assert.notEqual(data.locations[0].assessment.level,'normal');
mode='down';module=await fresh();data=await module.getLocalIntelligence(['Stamford'],module.localIntelligenceHorizons.today,5);
assert.equal(data.locations[0].events,null);assert.match(data.locations[0].errors.events,/502/);assert.match(data.locations[0].assessment.summary,/Incomplete/);
console.log('PASS: canonical source, verified radius/date contract, actual event total, partial incidents, and outages cannot appear normal.');
