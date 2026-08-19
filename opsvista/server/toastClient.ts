type ToastAuthResponse={token?:{accessToken?:string;expiresIn?:number}};

type TokenCache={accessToken:string;expiresAt:number};
let standardToken:TokenCache|undefined;
let analyticsToken:TokenCache|undefined;

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

export function toastLocations():Record<string,string>{
  const raw=process.env.TOAST_LOCATION_GUIDS_JSON;
  if(!raw)return {};
  try{return JSON.parse(raw) as Record<string,string>;}catch{throw new Error('TOAST_LOCATION_GUIDS_JSON must be valid JSON');}
}

export async function standardToastRequest(path:string,restaurantGuid?:string){
  const host=cleanHost(process.env.TOAST_API_HOST);
  const clientId=process.env.TOAST_CLIENT_ID||'';
  const clientSecret=process.env.TOAST_CLIENT_SECRET||'';
  if(!host||!clientId||!clientSecret)throw new Error('Toast Standard API environment variables are not configured');
  standardToken=await authenticate(host,clientId,clientSecret,standardToken);
  const headers:Record<string,string>={Authorization:`Bearer ${standardToken.accessToken}`};
  if(restaurantGuid)headers['Toast-Restaurant-External-ID']=restaurantGuid;
  const response=await fetch(`${host}${path}`,{headers});
  if(!response.ok){const detail=await response.text().catch(()=>"");throw new Error(`Toast API request failed (${response.status}) for ${path}${detail?`: ${detail.slice(0,500)}`:""}`);}
  return response.json();
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
