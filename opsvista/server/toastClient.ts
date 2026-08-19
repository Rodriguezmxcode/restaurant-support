type ToastAuthResponse={token?:{accessToken?:string;expiresIn?:number}};

type TokenCache={accessToken:string;expiresAt:number};
let standardToken:TokenCache|undefined;
let analyticsToken:TokenCache|undefined;
let standardRequestQueue:Promise<void>=Promise.resolve();
let lastStandardRequestAt=0;
const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

function cleanHost(value:string|undefined){return (value||'').replace(/\/$/,'');}

async function authenticate(host:string,clientId:string,clientSecret:string,cache:TokenCache|undefined){
  if(cache&&cache.expiresAt>Date.now()+60_000)return cache;
  const response=await fetch(`${host}/authentication/v1/authentication/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientId,clientSecret,userAccessType:'TOAST_MACHINE_CLIENT'})});
  if(!response.ok)throw new Error(`Toast authentication failed (${response.status})`);
  const body=await response.json() as ToastAuthResponse;
  const accessToken=body.token?.accessToken;
  if(!accessToken)throw new Error('Toast authentication response did not include an access token');
  return {accessToken,expiresAt:Date.now()+Math.max(60,Number(body.token?.expiresIn??300))*1000};
}

export function standardToastConfigured(){return !!(process.env.TOAST_API_HOST&&process.env.TOAST_CLIENT_ID&&process.env.TOAST_CLIENT_SECRET&&process.env.TOAST_LOCATION_GUIDS_JSON);}
export function analyticsToastConfigured(){return !!(process.env.TOAST_ANALYTICS_API_HOST&&process.env.TOAST_ANALYTICS_CLIENT_ID&&process.env.TOAST_ANALYTICS_CLIENT_SECRET);}

function isRestaurantGuid(value:unknown):value is string{
  return typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

export function toastLocations():Record<string,string>{
  const raw=process.env.TOAST_LOCATION_GUIDS_JSON;
  if(!raw)return {};
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{throw new Error('TOAST_LOCATION_GUIDS_JSON must be valid JSON');}
  if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error('TOAST_LOCATION_GUIDS_JSON must map each location name to its Toast restaurant GUID');
  const locations=Object.fromEntries(Object.entries(parsed as Record<string,unknown>).filter(([,guid])=>isRestaurantGuid(guid)).map(([name,guid])=>[name,(guid as string).trim()]));
  return locations;
}

export async function standardToastRequest(path:string,restaurantGuid?:string){
  const host=cleanHost(process.env.TOAST_API_HOST);
  const clientId=process.env.TOAST_CLIENT_ID||'';
  const clientSecret=process.env.TOAST_CLIENT_SECRET||'';
  if(!host||!clientId||!clientSecret)throw new Error('Toast Standard API environment variables are not configured');
  standardToken=await authenticate(host,clientId,clientSecret,standardToken);
  const headers:Record<string,string>={Authorization:`Bearer ${standardToken.accessToken}`};
  if(restaurantGuid)headers['Toast-Restaurant-External-ID']=restaurantGuid;
  const execute=async()=>{
    const spacing=Math.max(0,175-(Date.now()-lastStandardRequestAt));
    if(spacing)await wait(spacing);
    for(let attempt=0;attempt<5;attempt++){
      lastStandardRequestAt=Date.now();
      const response=await fetch(`${host}${path}`,{headers});
      if(response.ok)return response.json();
      const detail=await response.text().catch(()=>"");
      if(response.status===429&&attempt<4){
        const retryHeader=Number(response.headers.get('retry-after')||0);
        await wait(retryHeader>0?retryHeader*1000:500*Math.pow(2,attempt));
        continue;
      }
      throw new Error(`Toast API request failed (${response.status}) for ${path}${detail?`: ${detail.slice(0,500)}`:""}`);
    }
    throw new Error(`Toast API request failed after retries for ${path}`);
  };
  const queued=standardRequestQueue.then(execute);
  standardRequestQueue=queued.then(()=>undefined,()=>undefined);
  return queued;
}

export async function analyticsToastRequest(path:string,init?:RequestInit){
  const host=cleanHost(process.env.TOAST_ANALYTICS_API_HOST);
  const clientId=process.env.TOAST_ANALYTICS_CLIENT_ID||'';
  const clientSecret=process.env.TOAST_ANALYTICS_CLIENT_SECRET||'';
  if(!host||!clientId||!clientSecret)throw new Error('Toast Analytics API environment variables are not configured');
  analyticsToken=await authenticate(host,clientId,clientSecret,analyticsToken);
  const headers:Record<string,string>={Authorization:`Bearer ${analyticsToken.accessToken}`,'Content-Type':'application/json',...((init?.headers||{}) as Record<string,string>)};
  const response=await fetch(`${host}${path}`,{...init,headers});
  if(!response.ok)throw new Error(`Toast Analytics request failed (${response.status}) for ${path}`);
  return response.json();
}
