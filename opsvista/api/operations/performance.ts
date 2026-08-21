import { readSession } from '../../server/authSession.js';
import { allocateSalaryLabor } from '../../server/salaryLabor.js';
import { getToastPerformance } from '../../server/toastPerformance.js';
import { getSevenShiftsTaskCompliance } from '../../server/sevenShiftsTasks.js';
import { applyToastLaborToScheduleRisk, getSevenShiftsScheduleRisk } from '../../server/sevenShiftsClient.js';

type Req={method?:string;query?:Record<string,string|string[]>;headers?:{cookie?:string}};
type Res={status:(code:number)=>Res;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};

function asString(value:string|string[]|undefined){return Array.isArray(value)?value[0]:value||'';}
function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value);}

export default async function handler(req:Req,res:Res){
  if(req.method!=='GET'){res.setHeader?.('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
  const user=readSession(req.headers?.cookie);
  if(!user)return res.status(401).json({error:'Authentication required'});
  const start=asString(req.query?.start),end=asString(req.query?.end),scheduleEnd=asString(req.query?.schedule_end)||end,location=asString(req.query?.location);
  if(!validDate(start)||!validDate(end))return res.status(400).json({error:'start and end must use YYYY-MM-DD'});
  if(new Date(start)>new Date(end))return res.status(400).json({error:'start must be before end'});
  if(!validDate(scheduleEnd)||new Date(start)>new Date(scheduleEnd))return res.status(400).json({error:'schedule_end must use YYYY-MM-DD and be on or after start'});
  const days=Math.floor((new Date(`${end}T00:00:00Z`).getTime()-new Date(`${start}T00:00:00Z`).getTime())/86400000)+1;
  if(days>31)return res.status(400).json({error:'Date ranges are limited to 31 days for live Toast polling'});
  let requested:string[]|undefined;
  if(location&&location!=='All locations'){
    if(user.role!=='Founder'&&user.role!=='Corporate'&&!user.locations.includes(location))return res.status(403).json({error:'Location not authorized'});
    requested=[location];
  }else if(!['Founder','Corporate','HR','Administration','Maintenance'].includes(user.role))requested=user.locations;
  try{
    const [toastLocations,taskResult,scheduleResult]=await Promise.all([
      getToastPerformance(start,end,requested),
      getSevenShiftsTaskCompliance(start,end).then(data=>({data,error:''})).catch(taskError=>({data:null,error:taskError instanceof Error?taskError.message:'7shifts data unavailable'})),
      getSevenShiftsScheduleRisk(start,scheduleEnd,requested).then(data=>({data,error:''})).catch(scheduleError=>({data:null,error:scheduleError instanceof Error?scheduleError.message:'7shifts schedule data unavailable'})),
    ]);
    const taskCompliance=taskResult.data,taskComplianceError=taskResult.error;
    const scheduleRisk=scheduleResult.data?applyToastLaborToScheduleRisk(scheduleResult.data,toastLocations.flatMap(row=>row.employeeLabor)):null,scheduleRiskError=scheduleResult.error;
    const salary=allocateSalaryLabor(start,end,toastLocations.map(row=>row.location));
    const salaryByLocation=new Map(salary.rows.map(row=>[row.location,row]));
    const round=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
    const locations=toastLocations.map(row=>{
      const {employeeLabor:_,...publicRow}=row;
      const salaryRow=salaryByLocation.get(row.location);
      const salaryLaborCost=salaryRow?.salaryLaborCost??0;
      const totalLaborCost=row.hourlyLaborCost+salaryLaborCost;
      return {
        ...publicRow,
        salaryLaborCost,
        totalLaborCost:round(totalLaborCost),
        hourlyLaborPct:row.netSales?round(row.hourlyLaborCost/row.netSales*100):0,
        salaryLaborPct:row.netSales?round(salaryLaborCost/row.netSales*100):0,
        totalLaborPct:row.netSales?round(totalLaborCost/row.netSales*100):0,
      };
    });
    const totals=locations.reduce((acc,row)=>({
      netSales:acc.netSales+row.netSales,discountAmount:acc.discountAmount+row.discountAmount,voidAmount:acc.voidAmount+row.voidAmount,
      hourlyHours:acc.hourlyHours+row.hourlyHours,overtimeHours:acc.overtimeHours+row.overtimeHours,regularLaborCost:acc.regularLaborCost+row.regularLaborCost,
      overtimeLaborCost:acc.overtimeLaborCost+row.overtimeLaborCost,hourlyLaborCost:acc.hourlyLaborCost+row.hourlyLaborCost,
      salaryLaborCost:acc.salaryLaborCost+row.salaryLaborCost,totalLaborCost:acc.totalLaborCost+row.totalLaborCost,
    }),{netSales:0,discountAmount:0,voidAmount:0,hourlyHours:0,overtimeHours:0,regularLaborCost:0,overtimeLaborCost:0,hourlyLaborCost:0,salaryLaborCost:0,totalLaborCost:0});
    return res.status(200).json({
      source:'Toast Standard API + 7shifts schedule + OpsVista salary allocation',start,end,locations,
      salaryLaborConfigured:salary.configured,taskCompliance,taskComplianceError,scheduleRisk,scheduleRiskError,
      totals:{
        ...Object.fromEntries(Object.entries(totals).map(([k,v])=>[k,round(v)])),
        discountPct:totals.netSales?round(totals.discountAmount/totals.netSales*100):0,
        voidPct:totals.netSales?round(totals.voidAmount/totals.netSales*100):0,
        laborPct:totals.netSales?round(totals.hourlyLaborCost/totals.netSales*100):0,
        hourlyLaborPct:totals.netSales?round(totals.hourlyLaborCost/totals.netSales*100):0,
        salaryLaborPct:totals.netSales?round(totals.salaryLaborCost/totals.netSales*100):0,
        totalLaborPct:totals.netSales?round(totals.totalLaborCost/totals.netSales*100):0,
        overtimeLaborPct:totals.hourlyLaborCost?round(totals.overtimeLaborCost/totals.hourlyLaborCost*100):0,
        splh:totals.hourlyHours?round(totals.netSales/totals.hourlyHours):null
      },
      notes:{
        salaryLabor:salary.configured?'Weekly salaries allocated proportionally across the selected date range.':'Configure OPSVISTA_WEEKLY_SALARY_LABOR_JSON with the real weekly salary cost by location.',
        tasks:'Tasks require the 7shifts production feed.',
        overtime:'Overtime labor % is overtime labor cost divided by hourly labor cost.'
      }
    });
  }catch(error){
    const message=error instanceof Error?error.message:'Performance source unavailable';
    const configuration=message.includes('not configured')||message.includes('GUID');
    return res.status(configuration?503:502).json({error:message,configurationRequired:configuration,requiredEnvironmentVariables:['TOAST_API_HOST','TOAST_CLIENT_ID','TOAST_CLIENT_SECRET','TOAST_LOCATION_GUIDS_JSON','OPSVISTA_WEEKLY_SALARY_LABOR_JSON']});
  }
}
