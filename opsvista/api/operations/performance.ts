import { readSession } from '../../server/authSession.js';
import { getToastPerformance } from '../../server/toastPerformance.js';

type Req={method?:string;query?:Record<string,string|string[]>;headers?:{cookie?:string}};
type Res={status:(code:number)=>Res;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};

function asString(value:string|string[]|undefined){return Array.isArray(value)?value[0]:value||'';}
function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value);}

export default async function handler(req:Req,res:Res){
  if(req.method!=='GET'){res.setHeader?.('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
  const user=readSession(req.headers?.cookie);
  if(!user)return res.status(401).json({error:'Authentication required'});
  const start=asString(req.query?.start),end=asString(req.query?.end),location=asString(req.query?.location);
  if(!validDate(start)||!validDate(end))return res.status(400).json({error:'start and end must use YYYY-MM-DD'});
  if(new Date(start)>new Date(end))return res.status(400).json({error:'start must be before end'});
  const days=Math.floor((new Date(`${end}T00:00:00Z`).getTime()-new Date(`${start}T00:00:00Z`).getTime())/86400000)+1;
  if(days>31)return res.status(400).json({error:'Date ranges are limited to 31 days for live Toast polling'});
  let requested:string[]|undefined;
  if(location&&location!=='All locations'){
    if(user.role!=='Founder'&&user.role!=='Corporate'&&!user.locations.includes(location))return res.status(403).json({error:'Location not authorized'});
    requested=[location];
  }else if(!['Founder','Corporate','HR','Administration','Maintenance'].includes(user.role))requested=user.locations;
  try{
    const locations=await getToastPerformance(start,end,requested);
    const totals=locations.reduce((acc,row)=>({
      netSales:acc.netSales+row.netSales,discountAmount:acc.discountAmount+row.discountAmount,voidAmount:acc.voidAmount+row.voidAmount,
      hourlyHours:acc.hourlyHours+row.hourlyHours,overtimeHours:acc.overtimeHours+row.overtimeHours,regularLaborCost:acc.regularLaborCost+row.regularLaborCost,
      overtimeLaborCost:acc.overtimeLaborCost+row.overtimeLaborCost,hourlyLaborCost:acc.hourlyLaborCost+row.hourlyLaborCost,
    }),{netSales:0,discountAmount:0,voidAmount:0,hourlyHours:0,overtimeHours:0,regularLaborCost:0,overtimeLaborCost:0,hourlyLaborCost:0});
    const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
    return res.status(200).json({
      source:'Toast Standard API',start,end,locations,
      totals:{
        ...Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,round(v)])),
        discountPct:totals.netSales?round(totals.discountAmount/totals.netSales*100):0,
        voidPct:totals.netSales?round(totals.voidAmount/totals.netSales*100):0,
        laborPct:totals.netSales?round(totals.hourlyLaborCost/totals.netSales*100):0,
        overtimeLaborPct:totals.hourlyLaborCost?round(totals.overtimeLaborCost/totals.hourlyLaborCost*100):0,
        splh:totals.hourlyHours?round(totals.netSales/totals.hourlyHours):null
      },
      notes:{salaryLabor:'Salary labor is not available from Toast Standard time entries when hourlyWage is null.',tasks:'Tasks require the 7shifts production feed.',overtime:'Overtime labor % is overtime labor cost divided by hourly labor cost.'}
    });
  }catch(error){
    const message=error instanceof Error?error.message:'Performance source unavailable';
    const configuration=message.includes('not configured')||message.includes('GUID');
    return res.status(configuration?503:502).json({error:message,configurationRequired:configuration,requiredEnvironmentVariables:['TOAST_API_HOST','TOAST_CLIENT_ID','TOAST_CLIENT_SECRET','TOAST_LOCATION_GUIDS_JSON']});
  }
}
