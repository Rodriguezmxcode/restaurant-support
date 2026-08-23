import { standardToastConfigured,standardToastRequest,toastLocations } from './toastClient.js';

type ToastDiscount={discountAmount?:number;processingState?:string;name?:string;externalId?:string;appliedPromoCode?:string;discountPlu?:string;discount?:ExternalReference;appliedDiscountReason?:{name?:string;description?:string;comment?:string}};
type ToastSelection={price?:number;quantity?:number;voided?:boolean;deleted?:boolean;deferred?:boolean;selectionType?:string;appliedDiscounts?:ToastDiscount[]};
type ToastPayment={refund?:{refundAmount?:number}};
type ToastCheck={amount?:number;voided?:boolean;deleted?:boolean;selections?:ToastSelection[];payments?:ToastPayment[];appliedDiscounts?:ToastDiscount[]};
type ToastOrder={businessDate?:number;voided?:boolean;deleted?:boolean;excessFood?:boolean;checks?:ToastCheck[]};
type ExternalReference={guid?:string;externalId?:string};
type WageOverride={wage?:number;jobReference?:ExternalReference};
type TimeEntry={deleted?:boolean;regularHours?:number;overtimeHours?:number;hourlyWage?:number|null;employeeReference?:ExternalReference;jobReference?:ExternalReference};
type ToastEmployee={guid?:string;externalEmployeeId?:string;firstName?:string;chosenName?:string;lastName?:string;email?:string;deleted?:boolean;wageOverrides?:WageOverride[]};
type AccessibleRestaurant={restaurantGuid?:string;restaurantName?:string;locationName?:string};

export type PerformanceLocation={
  location:string;
  netSales:number;
  discountAmount:number;
  discountPct:number;
  bonusDiscountAmount:number;
  bonusDiscountPct:number;
  uberEatsDiscountAmount:number;
  voidAmount:number;
  voidPct:number;
  hourlyHours:number;
  overtimeHours:number;
  regularLaborCost:number;
  overtimeLaborCost:number;
  hourlyLaborCost:number;
  overtimeLaborPct:number;
  laborPct:number;
  splh:number|null;
  employeeLabor:ToastEmployeeLabor[];
};

export type ToastEmployeeLabor={
  employeeGuid:string;
  externalEmployeeId:string;
  employeeName:string;
  email:string;
  location:string;
  regularHours:number;
  overtimeHours:number;
  totalHours:number;
  hourlyWage:number|null;
  regularLaborCost:number;
  overtimeLaborCost:number;
  totalLaborCost:number;
  wageSource:'time_entry'|'employee_override'|'unavailable';
};

const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const ymd=(iso:string)=>Number(iso.replaceAll('-',''));
const rangeStart=(iso:string)=>`${iso}T00:00:00.000Z`;
function dayAfter(iso:string){const d=new Date(`${iso}T00:00:00.000Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString();}

function discountIdentity(discount:ToastDiscount){
  return [discount.name,discount.externalId,discount.appliedPromoCode,discount.discountPlu,discount.discount?.externalId,discount.appliedDiscountReason?.name,discount.appliedDiscountReason?.description,discount.appliedDiscountReason?.comment].filter(Boolean).join(' ').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
}
export function isUberEatsDiscount(discount:ToastDiscount){
  return /(^|[^a-z0-9])(uber\s*eats|ubereats|uber)([^a-z0-9]|$)/i.test(discountIdentity(discount));
}
function activeDiscountAmounts(items:ToastDiscount[]|undefined){
  return (items||[]).filter(discount=>!['VOID','PENDING_VOID'].includes(String(discount.processingState||'').toUpperCase())).reduce((totals,discount)=>{
    const amount=Math.abs(Number(discount.discountAmount||0));totals.total+=amount;if(isUberEatsDiscount(discount))totals.uberEats+=amount;return totals;
  },{total:0,uberEats:0});
}
function selectionGross(selection:ToastSelection){return Number(selection.price||0)*Math.max(1,Number(selection.quantity||1));}

function summarizeOrders(orders:ToastOrder[],start:string,end:string){
  const min=ymd(start),max=ymd(end);
  let netSales=0,discountAmount=0,uberEatsDiscountAmount=0,voidAmount=0;
  for(const order of orders){
    const businessDate=Number(order.businessDate||0);
    if(businessDate<min||businessDate>max)continue;
    if(order.deleted||order.excessFood)continue;
    if(order.voided){
      for(const check of order.checks||[])for(const selection of check.selections||[])if(!selection.deleted&&!selection.deferred&&selection.selectionType!=='HOUSE_ACCOUNT_PAY_BALANCE')voidAmount+=selectionGross(selection);
      continue;
    }
    for(const check of order.checks||[]){
      if(check.deleted)continue;
      if(check.voided){for(const selection of check.selections||[])if(!selection.deleted&&!selection.deferred&&selection.selectionType!=='HOUSE_ACCOUNT_PAY_BALANCE')voidAmount+=selectionGross(selection);continue;}
      let checkNet=Number(check.amount||0);
      for(const selection of check.selections||[]){
        if(selection.deleted)continue;
        if(selection.voided){voidAmount+=selectionGross(selection);continue;}
        if(selection.deferred||selection.selectionType==='HOUSE_ACCOUNT_PAY_BALANCE')checkNet-=selectionGross(selection);
        const discounts=activeDiscountAmounts(selection.appliedDiscounts);discountAmount+=discounts.total;uberEatsDiscountAmount+=discounts.uberEats;
      }
      const checkDiscounts=activeDiscountAmounts(check.appliedDiscounts);discountAmount+=checkDiscounts.total;uberEatsDiscountAmount+=checkDiscounts.uberEats;
      for(const payment of check.payments||[])checkNet-=Number(payment.refund?.refundAmount||0);
      netSales+=checkNet;
    }
  }
  const bonusDiscountAmount=Math.max(0,discountAmount-uberEatsDiscountAmount);
  return {netSales:round(netSales),discountAmount:round(discountAmount),bonusDiscountAmount:round(bonusDiscountAmount),uberEatsDiscountAmount:round(uberEatsDiscountAmount),voidAmount:round(voidAmount)};
}

async function getOrdersForRange(restaurantGuid:string,start:string,end:string){
  const all:ToastOrder[]=[];
  const pageSize=100;
  for(let cursor=start;cursor<=end;){
    let page=1;
    while(page<=50){
      const query=new URLSearchParams({businessDate:String(ymd(cursor)),page:String(page),pageSize:String(pageSize)});
      const data=await standardToastRequest(`/orders/v2/ordersBulk?${query.toString()}`,restaurantGuid) as ToastOrder[];
      all.push(...data);
      if(data.length<pageSize)break;
      page++;
    }
    const next=new Date(`${cursor}T12:00:00.000Z`);next.setUTCDate(next.getUTCDate()+1);cursor=next.toISOString().slice(0,10);
  }
  return all;
}

async function getLaborForRange(restaurantGuid:string,start:string,end:string){
  const query=new URLSearchParams({startDate:rangeStart(start),endDate:dayAfter(end),includeArchived:'false'});
  return await standardToastRequest(`/labor/v1/timeEntries?${query.toString()}`,restaurantGuid) as TimeEntry[];
}

async function getEmployees(restaurantGuid:string){
  return await standardToastRequest('/labor/v1/employees',restaurantGuid) as ToastEmployee[];
}

function validToastHourlyWage(value:unknown){const wage=Number(value);return Number.isFinite(wage)&&wage>0&&wage<=250?wage:0;}
function employeeName(employee:ToastEmployee|undefined,guid:string){return [employee?.chosenName||employee?.firstName,employee?.lastName].filter(Boolean).join(' ').trim()||`Toast employee ${guid.slice(0,8)}`;}

function summarizeEmployeeLabor(entries:TimeEntry[],employees:ToastEmployee[],location:string):ToastEmployeeLabor[]{
  type Acc={employeeGuid:string;externalEmployeeId:string;employeeName:string;email:string;location:string;regularHours:number;overtimeHours:number;wageHours:number;weightedWage:number;regularLaborCost:number;overtimeLaborCost:number;overrideWages:number[]};
  const employeeMap=new Map(employees.filter(employee=>employee.guid).map(employee=>[String(employee.guid),employee]));
  const rows=new Map<string,Acc>();
  const ensure=(guid:string)=>{const employee=employeeMap.get(guid);let row=rows.get(guid);if(!row){row={employeeGuid:guid,externalEmployeeId:String(employee?.externalEmployeeId||''),employeeName:employeeName(employee,guid),email:String(employee?.email||''),location,regularHours:0,overtimeHours:0,wageHours:0,weightedWage:0,regularLaborCost:0,overtimeLaborCost:0,overrideWages:(employee?.wageOverrides||[]).map(override=>validToastHourlyWage(override.wage)).filter(Boolean)};rows.set(guid,row);}return row;};
  for(const entry of entries){
    if(entry.deleted)continue;
    const guid=String(entry.employeeReference?.guid||'').trim();if(!guid)continue;
    const row=ensure(guid),regular=Number(entry.regularHours||0),overtime=Number(entry.overtimeHours||0),hours=regular+overtime;
    row.regularHours+=regular;row.overtimeHours+=overtime;
    const wage=validToastHourlyWage(entry.hourlyWage);
    if(wage&&hours>0){row.wageHours+=hours;row.weightedWage+=wage*hours;row.regularLaborCost+=regular*wage;row.overtimeLaborCost+=overtime*wage*1.5;}
  }
  for(const employee of employees)if(employee.guid&&!employee.deleted)ensure(String(employee.guid));
  return Array.from(rows.values()).map(row=>{
    const uniqueOverrides=Array.from(new Set(row.overrideWages.map(wage=>round(wage))));
    const hourlyWage=row.wageHours?row.weightedWage/row.wageHours:uniqueOverrides.length===1?uniqueOverrides[0]:null;
    const wageSource:ToastEmployeeLabor['wageSource']=row.wageHours?'time_entry':hourlyWage!==null?'employee_override':'unavailable';
    const totalHours=row.regularHours+row.overtimeHours;
    const regularLaborCost=row.wageHours?row.regularLaborCost:hourlyWage!==null?row.regularHours*hourlyWage:0;
    const overtimeLaborCost=row.wageHours?row.overtimeLaborCost:hourlyWage!==null?row.overtimeHours*hourlyWage*1.5:0;
    return {employeeGuid:row.employeeGuid,externalEmployeeId:row.externalEmployeeId,employeeName:row.employeeName,email:row.email,location:row.location,regularHours:round(row.regularHours),overtimeHours:round(row.overtimeHours),totalHours:round(totalHours),hourlyWage:hourlyWage===null?null:round(hourlyWage),regularLaborCost:round(regularLaborCost),overtimeLaborCost:round(overtimeLaborCost),totalLaborCost:round(regularLaborCost+overtimeLaborCost),wageSource};
  });
}

function summarizeLabor(entries:TimeEntry[]){
  let regularHours=0,overtimeHours=0,regularLaborCost=0,overtimeLaborCost=0;
  for(const entry of entries){
    if(entry.deleted)continue;
    const wage=entry.hourlyWage;
    if(wage===null||wage===undefined)continue;
    const regular=Number(entry.regularHours||0),overtime=Number(entry.overtimeHours||0),rate=Number(wage||0);
    regularHours+=regular;overtimeHours+=overtime;
    regularLaborCost+=regular*rate;
    overtimeLaborCost+=overtime*rate*1.5;
  }
  const hourlyLaborCost=regularLaborCost+overtimeLaborCost;
  return {hourlyHours:round(regularHours+overtimeHours),overtimeHours:round(overtimeHours),regularLaborCost:round(regularLaborCost),overtimeLaborCost:round(overtimeLaborCost),hourlyLaborCost:round(hourlyLaborCost),overtimeLaborPct:hourlyLaborCost?round(overtimeLaborCost/hourlyLaborCost*100):0};
}

function accessibleRestaurantList(payload:unknown):AccessibleRestaurant[]{
  if(Array.isArray(payload))return payload as AccessibleRestaurant[];
  if(payload&&typeof payload==='object'){
    const value=payload as {results?:unknown};
    if(Array.isArray(value.results))return value.results as AccessibleRestaurant[];
  }
  return [];
}

async function discoverToastLocations():Promise<Record<string,string>>{
  let payload:unknown;
  try{payload=await standardToastRequest('/partners/v1/restaurants');}
  catch(error){throw new Error(`Toast location discovery failed: ${error instanceof Error?error.message:'unknown error'}`);}
  const locations:Record<string,string>={};
  for(const restaurant of accessibleRestaurantList(payload)){
    const guid=String(restaurant.restaurantGuid||'').trim();
    const name=String(restaurant.locationName||restaurant.restaurantName||'').trim();
    if(guid&&name)locations[name]=guid;
  }
  return locations;
}

async function resolvedToastLocationEntries(requestedLocations?:string[]){
  if(!standardToastConfigured())throw new Error('Toast Standard API is not configured in OpsVista');
  let locationMap=toastLocations();
  if(!Object.keys(locationMap).length)locationMap=await discoverToastLocations();
  const entries=Object.entries(locationMap).filter(([name])=>!requestedLocations?.length||requestedLocations.some(requested=>name.toLowerCase().includes(requested.toLowerCase())||requested.toLowerCase().includes(name.toLowerCase())));
  if(!entries.length)throw new Error('Toast returned no accessible restaurant locations for these credentials');
  return entries;
}

export async function getToastEmployeeLabor(start:string,end:string,requestedLocations?:string[]):Promise<ToastEmployeeLabor[]>{
  const entries=await resolvedToastLocationEntries(requestedLocations);
  const output=await Promise.all(entries.map(async ([location,guid])=>{
    let labor:TimeEntry[],employees:ToastEmployee[];
    try{[labor,employees]=await Promise.all([getLaborForRange(guid,start,end),getEmployees(guid)]);}catch(error){throw new Error(`${location}: ${error instanceof Error?error.message:'Toast request failed'}`);}
    return summarizeEmployeeLabor(labor,employees,location);
  }));
  return output.flat();
}

export async function getToastPerformance(start:string,end:string,requestedLocations?:string[]):Promise<PerformanceLocation[]>{
  const entries=await resolvedToastLocationEntries(requestedLocations);
  return Promise.all(entries.map(async ([location,guid])=>{
    let orders:ToastOrder[],labor:TimeEntry[],employees:ToastEmployee[];
    try{[orders,labor,employees]=await Promise.all([getOrdersForRange(guid,start,end),getLaborForRange(guid,start,end),getEmployees(guid)]);}catch(error){throw new Error(`${location}: ${error instanceof Error?error.message:"Toast request failed"}`);}
    const sales=summarizeOrders(orders,start,end);
    const laborTotals=summarizeLabor(labor);
    const discountPct=sales.netSales?round(sales.discountAmount/sales.netSales*100):0;
    const bonusDiscountPct=sales.netSales?round(sales.bonusDiscountAmount/sales.netSales*100):0;
    const voidPct=sales.netSales?round(sales.voidAmount/sales.netSales*100):0;
    const laborPct=sales.netSales?round(laborTotals.hourlyLaborCost/sales.netSales*100):0;
    const splh=laborTotals.hourlyHours?round(sales.netSales/laborTotals.hourlyHours):null;
    return {location,...sales,...laborTotals,discountPct,bonusDiscountPct,voidPct,laborPct,splh,employeeLabor:summarizeEmployeeLabor(labor,employees,location)};
  }));
}
