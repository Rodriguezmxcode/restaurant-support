import test from 'node:test';
import assert from 'node:assert/strict';
import { applyToastLaborToScheduleRisk, type SevenShiftsEmployeeScheduleRisk, type SevenShiftsScheduleRisk, type ToastEmployeeLaborForSchedule } from './sevenShiftsClient.js';
import { summarizeEmployeeLabor, getLaborForRange } from './toastPerformance.js';
import { parsePayrollReference, selectPayrollReference } from './overtimePayrollReference.js';
import { easternMidnight, overtimePeriod } from '../shared/overtimePeriod.js';
const payrollReference=parsePayrollReference({start:'2026-09-16',end:'2026-09-22',providedAt:'2026-09-26',locations:['Southington','Danbury','Orange','Fairfield','Stamford','Avon'].map((location,i)=>({location,hours:i,cost:i*30}))});
const employee=(patch:Partial<SevenShiftsEmployeeScheduleRisk>={}):SevenShiftsEmployeeScheduleRisk=>({userId:1,employeeName:'Test Employee',externalEmployeeId:'A-1',primaryLocation:'Orange',locations:['Orange'],role:'Cook',workedHours:0,scheduledHours:50,remainingScheduledHours:0,projectedHours:0,overtimeHours:0,actualOvertimeHours:0,hourlyWage:null,estimatedOvertimeCost:null,wageSource:'unavailable',toastMatchStatus:'unmatched',employmentType:'hourly',status:'Safe',...patch});
const labor=(patch:Partial<ToastEmployeeLaborForSchedule>={}):ToastEmployeeLaborForSchedule=>({employeeGuid:'toast-1',externalEmployeeId:'A-1',employeeName:'Test Employee',location:'Orange',regularHours:40,overtimeHours:2,totalHours:42,hourlyWage:20,overtimeLaborCost:60,overtimeCostComplete:true,employmentType:'hourly',wageSource:'time_entry',...patch});
const risk=(employees=[employee()],names=['Orange'],patch:Partial<SevenShiftsScheduleRisk>={}):SevenShiftsScheduleRisk=>({start:'2026-09-16',end:'2026-09-22',workedThrough:'2026-09-22',generatedAt:'2026-09-27T01:00:00Z',periodClosed:true,thresholdHours:40,scheduledHours:50,riskEmployees:0,actualOvertimeHours:0,additionalProjectedOvertimeHours:0,projectedOvertimeHours:0,salaryOver40Hours:0,unclassifiedToastOvertimeHours:0,unclassifiedToastEmployees:0,estimatedOvertimeCost:0,employeesMissingHourlyWage:0,unmatchedToastEmployees:0,employees,locations:names.map(location=>({location,monitoredEmployees:0,riskEmployees:0,actualOvertimeHours:0,additionalProjectedOvertimeHours:0,projectedOvertimeHours:0,salaryOver40Hours:0,unclassifiedToastOvertimeHours:0,unclassifiedToastEmployees:0,estimatedOvertimeCost:0,employeesMissingHourlyWage:0})),...patch});

test('six-location acceptance reference retains synthetic payroll hours and cost without projections',()=>{
  const rows=payrollReference.locations.map((r,i)=>labor({employeeGuid:`t${i}`,externalEmployeeId:`id${i}`,employeeName:`Employee ${i}`,location:r.location,overtimeHours:r.hours,totalHours:40+r.hours,overtimeLaborCost:r.cost}));
  const people=rows.map((r,i)=>employee({userId:i,externalEmployeeId:r.externalEmployeeId,employeeName:r.employeeName,primaryLocation:r.location,locations:[r.location],remainingScheduledHours:10}));
  const result=applyToastLaborToScheduleRisk(risk(people,rows.map(r=>r.location)),rows);
  assert.equal(result.actualOvertimeHours,15);assert.equal(result.workedOvertimeCost,450);
  assert.equal(result.additionalProjectedOvertimeHours,0);assert.equal(result.additionalProjectedOvertimeCost,0);assert.equal(result.estimatedOvertimeCost,450);
  assert.equal(result.locations.find(r=>r.location==='Southington')?.estimatedOvertimeCost,0);
});
test('A 7-hour difference is visible and never promoted to reported OT',()=>{
  const result=applyToastLaborToScheduleRisk(risk(),[labor({regularHours:47,overtimeHours:15,totalHours:62,overtimeLaborCost:450})]);
  assert.equal(result.actualOvertimeHours,15);assert.equal(result.calculatedOvertimeDifferenceHours,7);assert.equal(result.projectedOvertimeHours,15);assert.equal(result.estimatedOvertimeCost,450);
});
test('future exposure and cost are incremental, even when Toast differs from the 40-hour rule',()=>{
  const result=applyToastLaborToScheduleRisk(risk([employee({remainingScheduledHours:9})],['Orange'],{periodClosed:false}),[labor({regularHours:47,overtimeHours:15,totalHours:62,overtimeLaborCost:450})]);
  assert.equal(result.additionalProjectedOvertimeHours,9);assert.equal(result.additionalProjectedOvertimeCost,270);assert.equal(result.estimatedOvertimeCost,720);assert.equal(result.projectedOvertimeHours,24);
});
test('reported overtime above the threshold calculation is preserved',()=>{
  const result=applyToastLaborToScheduleRisk(risk([employee({remainingScheduledHours:5})],['Orange'],{periodClosed:false}),[labor({regularHours:25,overtimeHours:5,totalHours:30,overtimeLaborCost:150})]);
  assert.equal(result.actualOvertimeHours,5);assert.equal(result.projectedOvertimeHours,5);assert.equal(result.additionalProjectedOvertimeHours,0);assert.equal(result.calculatedOvertimeDifferenceHours,-5);
});
test('historical costs use each entry rate instead of multiplying a blended employee rate',()=>{
  const rows=summarizeEmployeeLabor([{employeeReference:{guid:'toast-1'},regularHours:40,overtimeHours:0,hourlyWage:10},{employeeReference:{guid:'toast-1'},regularHours:0,overtimeHours:2,hourlyWage:20}],[{guid:'toast-1',externalEmployeeId:'A-1',firstName:'Test',lastName:'Employee'}],'Orange');
  const result=applyToastLaborToScheduleRisk(risk(),rows);
  assert.equal(result.workedOvertimeCost,60);assert.notEqual(result.workedOvertimeCost,Math.round(2*(rows[0].hourlyWage??0)*1.5*100)/100);
});
test('partial historical wage coverage produces an incomplete cost, never a fabricated payment',()=>{
  const rows=summarizeEmployeeLabor([{employeeReference:{guid:'toast-1'},regularHours:40,overtimeHours:1,hourlyWage:20},{employeeReference:{guid:'toast-1'},regularHours:0,overtimeHours:1}],[{guid:'toast-1',externalEmployeeId:'A-1',wageOverrides:[{wage:30}]}],'Orange');
  const result=applyToastLaborToScheduleRisk(risk(),rows);
  assert.equal(result.actualOvertimeHours,2);assert.equal(result.workedOvertimeCost,null);assert.equal(result.estimatedOvertimeCost,null);
});
test('worked OT stays at its source location while future exposure uses the next scheduled site',()=>{
  const result=applyToastLaborToScheduleRisk(risk([employee({primaryLocation:'Danbury',locations:['Orange','Danbury'],remainingScheduledHours:4})],['Orange','Danbury'],{periodClosed:false}),[labor()]);
  const orange=result.locations.find(r=>r.location==='Orange')!,danbury=result.locations.find(r=>r.location==='Danbury')!;
  assert.equal(orange.actualOvertimeHours,2);assert.equal(orange.workedOvertimeCost,60);assert.equal(danbury.actualOvertimeHours,0);assert.equal(danbury.additionalProjectedOvertimeHours,4);assert.equal(danbury.additionalProjectedOvertimeCost,120);
});
test('salary and unclassified Toast hours remain outside hourly reconciliation',()=>{
  const result=applyToastLaborToScheduleRisk(risk(),[labor({employmentType:'salary',hourlyWage:null,totalHours:55,overtimeHours:15}),labor({employeeGuid:'unlinked',externalEmployeeId:'other',employeeName:'Unknown',overtimeHours:8,totalHours:48})]);
  assert.equal(result.actualOvertimeHours,0);assert.equal(result.workedOvertimeCost,0);assert.equal(result.salaryOver40Hours,15);assert.equal(result.unclassifiedToastOvertimeHours,8);
});
test('actual hourly classification is not overridden by an unconfirmed manager title',()=>{
  const result=applyToastLaborToScheduleRisk(risk([employee({role:'Manager',employmentType:'salary'})]),[labor()]);
  assert.equal(result.actualOvertimeHours,2);assert.equal(result.employees[0].employmentType,'hourly');
});
test('duplicate source records and duplicate employee claims cannot double-count Toast',()=>{
  const row=labor();const result=applyToastLaborToScheduleRisk(risk([employee(),employee({userId:2})]),[row,{...row}]);
  assert.equal(result.actualOvertimeHours,2);assert.equal(result.workedOvertimeCost,60);assert.equal(result.employees.find(r=>r.userId===2)?.toastMatchStatus,'ambiguous');
});
test('colliding external IDs with different names require review',()=>{
  const result=applyToastLaborToScheduleRisk(risk(),[labor(),labor({employeeGuid:'toast-2',employeeName:'Different Employee'})]);
  assert.equal(result.actualOvertimeHours,0);assert.equal(result.unclassifiedToastOvertimeHours,4);assert.equal(result.employees[0].toastMatchStatus,'ambiguous');
});
test('IDs retain punctuation and are not falsely merged',()=>{
  const result=applyToastLaborToScheduleRisk(risk(),[labor({externalEmployeeId:'A1',employeeName:'Someone Else'})]);
  assert.equal(result.actualOvertimeHours,0);assert.equal(result.employees[0].toastMatchStatus,'unmatched');
});
test('Toast source hours retain sub-cent precision until final aggregation',()=>{
  const rows=summarizeEmployeeLabor([{employeeReference:{guid:'one'},regularHours:40,overtimeHours:.044,hourlyWage:20},{employeeReference:{guid:'two'},regularHours:40,overtimeHours:.044,hourlyWage:20}],[{guid:'one',externalEmployeeId:'1'},{guid:'two',externalEmployeeId:'2'}],'Orange');
  const result=applyToastLaborToScheduleRisk(risk([employee({externalEmployeeId:'1'}),employee({userId:2,externalEmployeeId:'2'})]),rows);
  assert.equal(result.actualOvertimeHours,.09);
});
test('payroll reference is date-specific, location-filtered, and distinguishes missing from zero',()=>{
  const names=payrollReference.locations.map(r=>r.location);
  assert.equal(selectPayrollReference(payrollReference,'2026-09-16','2026-09-22','2026-09-22',names)?.cost,450);
  assert.equal(selectPayrollReference(payrollReference,'2026-09-16','2026-09-22','2026-09-22',['Southington'])?.cost,0);
  assert.equal(selectPayrollReference(payrollReference,'2026-09-23','2026-09-29','2026-09-29',names),null);
  assert.equal(selectPayrollReference(payrollReference,'2026-09-16','2026-09-22','2026-09-21',names),null);
  assert.equal(selectPayrollReference(payrollReference,'2026-09-16','2026-09-22','2026-09-22',['Other']),null);
});
test('Connecticut date boundaries respect DST and historical cutoffs',()=>{
  assert.equal(easternMidnight('2026-09-16'),'2026-09-16T04:00:00.000Z');
  assert.equal(easternMidnight('2026-01-07'),'2026-01-07T05:00:00.000Z');
  assert.equal(easternMidnight('2026-03-08'),'2026-03-08T05:00:00.000Z');
  assert.equal(easternMidnight('2026-11-01'),'2026-11-01T04:00:00.000Z');
  const closed=overtimePeriod('2026-09-16','2026-09-22','2026-09-22',new Date('2026-09-27T01:00:00Z'));
  assert.equal(closed.periodClosed,true);assert.equal(closed.cutoff,Date.parse('2026-09-23T04:00:00Z'));
  const open=overtimePeriod('2026-09-23','2026-09-29','2026-09-25',new Date('2026-09-27T01:00:00Z'));
  assert.equal(open.cutoff,Date.parse('2026-09-26T04:00:00Z'));
});
test('Toast labor queries business dates, removes deleted records and deduplicates GUIDs',async()=>{
  const oldFetch=globalThis.fetch;const oldEnv={...process.env};const dates:string[]=[];
  process.env.TOAST_API_HOST='https://toast-test.invalid';process.env.TOAST_CLIENT_ID='test';process.env.TOAST_CLIENT_SECRET='test';
  globalThis.fetch=async input=>{const url=new URL(String(input));if(url.pathname.includes('authentication'))return new Response(JSON.stringify({token:{accessToken:'test',expiresIn:300}}));dates.push(url.searchParams.get('businessDate')!);assert.equal(url.searchParams.has('startDate'),false);return new Response(JSON.stringify([{guid:'one',regularHours:5},{guid:'deleted',deleted:true}]));};
  try{const rows=await getLaborForRange('test','2026-09-16','2026-09-17');assert.deepEqual(dates,['20260916','20260917']);assert.equal(rows.length,1);}
  finally{globalThis.fetch=oldFetch;for(const key of ['TOAST_API_HOST','TOAST_CLIENT_ID','TOAST_CLIENT_SECRET']){if(oldEnv[key]===undefined)delete process.env[key];else process.env[key]=oldEnv[key];}}
});

test('payroll imports reject malformed dates, duplicate locations, negative amounts and numeric strings',()=>{
  for(const patch of [{start:'2026-09-17'},{end:'2026-02-31'},{locations:[{location:'Orange',hours:-1,cost:5}]},{locations:[{location:'Orange',hours:1,cost:'5'}]},{locations:[{location:'Orange',hours:1,cost:5},{location:'orange',hours:1,cost:5}]}])assert.throws(()=>parsePayrollReference({...payrollReference,...patch}));
});

test('private acceptance file matches imported payroll totals',{skip:!process.env.OPSVISTA_PAYROLL_ACCEPTANCE_FILE},async()=>{
  const {readFile}=await import('node:fs/promises');
  const reference=parsePayrollReference(JSON.parse(await readFile(process.env.OPSVISTA_PAYROLL_ACCEPTANCE_FILE!,'utf8')));
  const people=reference.locations.map((r,i)=>employee({userId:i,employeeName:`Employee ${i}`,externalEmployeeId:`id${i}`,primaryLocation:r.location,locations:[r.location]}));
  const rows=reference.locations.map((r,i)=>labor({employeeGuid:`t${i}`,externalEmployeeId:`id${i}`,employeeName:`Employee ${i}`,location:r.location,overtimeHours:r.hours,totalHours:40+r.hours,overtimeLaborCost:r.cost}));
  const result=applyToastLaborToScheduleRisk(risk(people,rows.map(r=>r.location)),rows);
  const expected=selectPayrollReference(reference,reference.start,reference.end,reference.end,rows.map(r=>r.location))!;
  assert.equal(result.actualOvertimeHours,expected.hours);assert.equal(result.workedOvertimeCost,expected.cost);
});

test('payroll upload enforces authentication, tenant and role before validation or storage',async()=>{
  const {default:handler}=await import('../api/operations/performance.js');
  const {issueSession}=await import('./authSession.js');
  const prior=process.env.OPSVISTA_SESSION_SECRET;process.env.OPSVISTA_SESSION_SECRET='test-only-overtime-secret-at-least-32-chars';
  const run=async(role?:'Corporate'|'Location Manager',organizationId='org-puerto-vallarta',query={payroll_reference:'true'})=>{
    let status=0;const headers:Record<string,string>={};
    const cookie=role?`opsvista_session=${issueSession({id:'unit-test',name:'Test User',email:'test@example.invalid',role,title:'Test',locations:['Orange'],organizationId})}`:undefined;
    const response={status(code:number){status=code;return response;},json(_body:unknown){},setHeader(name:string,value:string){headers[name]=value;}};
    await handler({method:'POST',query,headers:{cookie},body:{}},response);assert.equal(headers['Cache-Control'],'private, no-store');return status;
  };
  try{assert.equal(await run(),401);assert.equal(await run('Corporate','another-org'),403);assert.equal(await run('Location Manager'),403);assert.equal(await run('Corporate'),400);assert.equal(await run('Corporate','org-puerto-vallarta',{payroll_reference:'false'}),405);}
  finally{if(prior===undefined)delete process.env.OPSVISTA_SESSION_SECRET;else process.env.OPSVISTA_SESSION_SECRET=prior;}
});
