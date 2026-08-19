import { standardToastConfigured,standardToastRequest,toastLocations } from './toastClient.js';

type ToastDiscount={discountAmount?:number;processingState?:string};
type ToastSelection={price?:number;quantity?:number;voided?:boolean;deleted?:boolean;deferred?:boolean;selectionType?:string;appliedDiscounts?:ToastDiscount[]};
type ToastPayment={refund?:{refundAmount?:number}};
type ToastCheck={amount?:number;voided?:boolean;deleted?:boolean;selections?:ToastSelection[];payments?:ToastPayment[];appliedDiscounts?:ToastDiscount[]};
type ToastOrder={businessDate?:number;voided?:boolean;deleted?:boolean;excessFood?:boolean;checks?:ToastCheck[]};
type TimeEntry={deleted?:boolean;regularHours?:number;overtimeHours?:number;hourlyWage?:number|null};

export type PerformanceLocation={
  location:string;
  netSales:number;
  discountAmount:number;
  discountPct:number;
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
};

const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
const ymd=(iso:string)=>Number(iso.replaceAll('-',''));
const rangeStart=(iso:string)=>`${iso}T00:00:00.000Z`;
function dayAfter(iso:string){const d=new Date(`${iso}T00:00:00.000Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString();}

function activeDiscountAmount(items:ToastDiscount[]|undefined){
  return (items||[]).filter(d=>!['VOID','PENDING_VOID'].includes(String(d.processingState||'').toUpperCase())).reduce((sum,d)=>sum+Number(d.discountAmount||0),0);
}
function selectionGross(selection:ToastSelection){return Number(selection.price||0)*Math.max(1,Number(selection.quantity||1));}

function summarizeOrders(orders:ToastOrder[],start:string,end:string){
  const min=ymd(start),max=ymd(end);
  let netSales=0,discountAmount=0,voidAmount=0;
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
        discountAmount+=activeDiscountAmount(selection.appliedDiscounts);
      }
      discountAmount+=activeDiscountAmount(check.appliedDiscounts);
      for(const payment of check.payments||[])checkNet-=Number(payment.refund?.refundAmount||0);
      netSales+=checkNet;
    }
  }
  return {netSales:round(netSales),discountAmount:round(discountAmount),voidAmount:round(voidAmount)};
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

export async function getToastPerformance(start:string,end:string,requestedLocations?:string[]):Promise<PerformanceLocation[]>{
  if(!standardToastConfigured())throw new Error('Toast Standard API is not configured in OpsVista');
  const locationMap=toastLocations();
  const entries=Object.entries(locationMap).filter(([name])=>!requestedLocations?.length||requestedLocations.includes(name));
  if(!entries.length)throw new Error('No Toast restaurant GUIDs are configured for the requested locations');
  const output:PerformanceLocation[]=[];
  for(const [location,guid] of entries){
    const [orders,labor]=await Promise.all([getOrdersForRange(guid,start,end),getLaborForRange(guid,start,end)]);
    const sales=summarizeOrders(orders,start,end);
    const laborTotals=summarizeLabor(labor);
    const discountPct=sales.netSales?round(sales.discountAmount/sales.netSales*100):0;
    const voidPct=sales.netSales?round(sales.voidAmount/sales.netSales*100):0;
    const laborPct=sales.netSales?round(laborTotals.hourlyLaborCost/sales.netSales*100):0;
    const splh=laborTotals.hourlyHours?round(sales.netSales/laborTotals.hourlyHours):null;
    output.push({location,...sales,...laborTotals,discountPct,voidPct,laborPct,splh});
  }
  return output;
}
