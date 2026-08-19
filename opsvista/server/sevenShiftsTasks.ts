type SevenShiftsEnvelope={data?:unknown;results?:unknown};

function rows(payload:any):any[]{
  if(Array.isArray(payload))return payload;
  if(Array.isArray(payload?.data))return payload.data;
  if(Array.isArray(payload?.results))return payload.results;
  return [];
}

async function request(path:string){
  const token=process.env.SEVENSHIFTS_ACCESS_TOKEN;
  if(!token)throw new Error('SEVENSHIFTS_ACCESS_TOKEN is not configured');
  const response=await fetch(`https://api.7shifts.com${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json','x-api-version':'2023-04-01'}});
  const text=await response.text();
  let body:any={};
  try{body=text?JSON.parse(text):{};}catch{body={message:text};}
  if(!response.ok)throw new Error(`7shifts API ${response.status}: ${body?.detail||body?.message||text.slice(0,300)}`);
  return body as SevenShiftsEnvelope;
}

function listId(value:any){return value?.id??value?.task_list_id;}
function taskRows(value:any){return rows(value?.tasks??value?.task_list?.tasks??[]);}
function isCompleted(task:any){
  const status=String(task?.status??task?.completion_status??'').toLowerCase();
  return Boolean(task?.completed||task?.is_completed||task?.completed_at||task?.completion?.completed_at||status==='completed'||status==='complete');
}

export async function getSevenShiftsTaskCompliance(start:string,end:string){
  const companyId=process.env.SEVENSHIFTS_COMPANY_ID;
  if(!companyId)throw new Error('SEVENSHIFTS_COMPANY_ID is not configured');
  const locationsPayload:any=await request(`/v2/company/${companyId}/locations?limit=200`);
  const locations=rows(locationsPayload);
  const totals=new Map<string,{location:string;completed:number;total:number}>();
  for(const location of locations){
    const id=String(location?.id??'');
    const name=String(location?.name??location?.location_name??'').trim();
    if(id&&name)totals.set(id,{location:name,completed:0,total:0});
  }

  const startDate=new Date(`${start}T12:00:00Z`),last=new Date(`${end}T12:00:00Z`);
  for(let day=startDate;day<=last;day=new Date(day.getTime()+86400000)){
    const date=day.toISOString().slice(0,10);
    const listsPayload:any=await request(`/v2/company/${companyId}/task_lists?active_on_date=${date}`);
    for(const summary of rows(listsPayload)){
      let detail:any=summary;
      if(!taskRows(detail).length&&listId(summary))detail=await request(`/v2/company/${companyId}/task_lists/${listId(summary)}`);
      const locationId=String(detail?.location_id??detail?.task_list?.location_id??summary?.location_id??'');
      const bucket=totals.get(locationId);
      if(!bucket)continue;
      const tasks=taskRows(detail);
      bucket.total+=tasks.length;
      bucket.completed+=tasks.filter(isCompleted).length;
    }
  }
  const output=[...totals.values()].map(row=>({...row,compliancePct:row.total?Math.round(row.completed/row.total*10000)/100:0}));
  const completed=output.reduce((sum,row)=>sum+row.completed,0),total=output.reduce((sum,row)=>sum+row.total,0);
  return {source:'7shifts live API',start,end,locations:output,totals:{completed,total,compliancePct:total?Math.round(completed/total*10000)/100:0}};
}
