import { readSession } from '../../server/authSession.js';
import { standardToastConfigured, standardToastRequest, toastLocations } from '../../server/toastClient.js';

type Req={method?:string;query?:Record<string,string|string[]>;headers?:{cookie?:string;authorization?:string}};
type Res={status:(code:number)=>Res;json:(body:unknown)=>void;setHeader?:(name:string,value:string)=>void};
type ToastEmployee={guid?:string;externalEmployeeId?:string;firstName?:string;chosenName?:string;lastName?:string;email?:string;phoneNumber?:string;deleted?:boolean;createdDate?:string;modifiedDate?:string;wageOverrides?:Array<{jobReference?:{guid?:string}}>};
type Job={guid?:string;title?:string;name?:string};
const clean=(v:unknown)=>String(v??'').trim();
const matches=(a:string,b:string)=>a.toLowerCase().includes(b.toLowerCase())||b.toLowerCase().includes(a.toLowerCase());

export default async function handler(req:Req,res:Res){
  if(req.method!=='GET'){res.setHeader?.('Allow','GET');return res.status(405).json({error:'Method not allowed'});}
  const user=readSession(req.headers?.cookie,req.headers?.authorization);
  if(!user)return res.status(401).json({error:'Authentication required'});
  if(!['Founder','Corporate','HR'].includes(user.role))return res.status(403).json({error:'Team roster access requires Corporate or HR permissions'});
  if(!standardToastConfigured())return res.status(503).json({error:'Toast Standard API is not configured'});
  try{
    const configured=toastLocations();
    if(!Object.keys(configured).length)return res.status(503).json({error:'Toast restaurant GUID mapping is required for Team sync'});
    const byGuid=new Map<string,any>();
    for(const [location,restaurantGuid] of Object.entries(configured)){
      const [employees,jobs]=await Promise.all([
        standardToastRequest('/labor/v1/employees',restaurantGuid) as Promise<ToastEmployee[]>,
        standardToastRequest('/labor/v1/jobs',restaurantGuid).catch(()=>[]) as Promise<Job[]>
      ]);
      const jobMap=new Map(jobs.filter(j=>j.guid).map(j=>[clean(j.guid),clean(j.title||j.name)]));
      for(const employee of employees){
        const guid=clean(employee.guid);if(!guid)continue;
        const positions=Array.from(new Set((employee.wageOverrides||[]).map(w=>jobMap.get(clean(w.jobReference?.guid))).filter(Boolean)));
        const existing=byGuid.get(guid);
        if(existing){if(!existing.locations.includes(location))existing.locations.push(location);existing.positions=Array.from(new Set([...existing.positions,...positions]));if(!employee.deleted)existing.status='Active';continue;}
        byGuid.set(guid,{opsvistaEmployeeId:`OV-${guid.slice(0,8).toUpperCase()}`,toastEmployeeGuid:guid,externalEmployeeId:clean(employee.externalEmployeeId),firstName:clean(employee.chosenName||employee.firstName),lastName:clean(employee.lastName),email:clean(employee.email),phone:clean(employee.phoneNumber),hireDate:clean(employee.createdDate).slice(0,10),positions,position:positions[0]||'',location,locations:[location],status:employee.deleted?'Inactive':'Active',toastModifiedDate:clean(employee.modifiedDate)});
      }
    }
    const employees=Array.from(byGuid.values()).filter(e=>user.role!=='HR'||e.locations.some((l:string)=>Object.keys(configured).some(x=>matches(x,l))));
    const missingInformation=employees.filter(e=>!e.email||!e.phone||!e.hireDate||!e.position).length;
    return res.status(200).json({source:'Toast Labor API',mode:'preview',employees,newEmployees:employees.length,updated:0,deactivated:employees.filter(e=>e.status==='Inactive').length,missingInformation});
  }catch(error){return res.status(502).json({error:error instanceof Error?error.message:'Toast Team roster unavailable'});}
}
