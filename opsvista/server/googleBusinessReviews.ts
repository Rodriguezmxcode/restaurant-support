type LocationMap=Record<string,string>;
type GoogleReview={starRating?:string;createTime?:string;updateTime?:string};
type ReviewsPage={reviews?:GoogleReview[];nextPageToken?:string};

export type WeeklyReviewLocation={location:string;average:number;count:number};

const text=(...values:Array<string|undefined>)=>values.find(value=>value?.trim())?.trim()||'';
const env=(...names:string[])=>text(...names.map(name=>process.env[name]));
const isoDay=(value:string)=>value.slice(0,10);

function parseLocationMap():LocationMap{
  const raw=env('GOOGLE_BUSINESS_PROFILE_LOCATION_IDS_JSON','GOOGLE_BUSINESS_LOCATION_IDS_JSON','GOOGLE_LOCATION_IDS_JSON');
  if(!raw)throw new Error('Google Business Profile location mapping is not configured in this deployment');
  try{
    const parsed=JSON.parse(raw) as unknown;
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('mapping must be an object');
    return Object.fromEntries(Object.entries(parsed as Record<string,unknown>).filter(([,value])=>typeof value==='string'&&value.trim()).map(([name,value])=>[name,String(value).trim()]));
  }catch(error){throw new Error(`Google Business Profile location mapping is invalid: ${error instanceof Error?error.message:'invalid JSON'}`);}
}

async function oauthToken(){
  const direct=env('GOOGLE_BUSINESS_PROFILE_ACCESS_TOKEN','GOOGLE_BUSINESS_ACCESS_TOKEN','GOOGLE_ACCESS_TOKEN');
  if(direct)return direct;
  const clientId=env('GOOGLE_BUSINESS_PROFILE_CLIENT_ID','GOOGLE_CLIENT_ID');
  const clientSecret=env('GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET','GOOGLE_CLIENT_SECRET');
  const refreshToken=env('GOOGLE_BUSINESS_PROFILE_REFRESH_TOKEN','GOOGLE_REFRESH_TOKEN');
  if(!clientId||!clientSecret||!refreshToken)throw new Error('Google Business Profile OAuth credentials are not available in this deployment');
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'})});
  const body=await response.json().catch(()=>({})) as {access_token?:string;error_description?:string;error?:string};
  if(!response.ok||!body.access_token)throw new Error(`Google Business Profile OAuth ${response.status}: ${body.error_description||body.error||'token refresh failed'}`);
  return body.access_token;
}

function stars(value:string|undefined){
  const normalized=(value||'').toUpperCase();
  const map:Record<string,number>={ONE:1,TWO:2,THREE:3,FOUR:4,FIVE:5,STAR_RATING_UNSPECIFIED:0};
  return map[normalized]??(Number(value)||0);
}

function parent(accountId:string,value:string){
  if(value.startsWith('accounts/'))return value;
  if(value.startsWith('locations/'))return `accounts/${accountId}/${value}`;
  return `accounts/${accountId}/locations/${value}`;
}

async function locationReviews(parentName:string,start:string,end:string,token:string){
  const selected:GoogleReview[]=[];
  let pageToken='';
  for(let page=0;page<10;page+=1){
    const url=new URL(`https://mybusiness.googleapis.com/v4/${parentName}/reviews`);
    url.searchParams.set('pageSize','50');url.searchParams.set('orderBy','updateTime desc');if(pageToken)url.searchParams.set('pageToken',pageToken);
    const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
    const body=await response.json().catch(()=>({})) as ReviewsPage&{error?:{message?:string}};
    if(!response.ok)throw new Error(`Google Business Profile ${response.status}: ${body.error?.message||'reviews request failed'}`);
    const reviews=body.reviews||[];
    for(const review of reviews){const date=isoDay(review.createTime||review.updateTime||'');if(date>=start&&date<=end)selected.push(review);}
    const oldest=reviews.map(review=>isoDay(review.createTime||review.updateTime||'')).filter(Boolean).sort()[0];
    if(!body.nextPageToken||!reviews.length||(oldest&&oldest<start))break;
    pageToken=body.nextPageToken;
  }
  return selected;
}

export async function getWeeklyGoogleReviews(start:string,end:string,requested?:string[]){
  const accountId=env('GOOGLE_BUSINESS_PROFILE_ACCOUNT_ID','GOOGLE_BUSINESS_ACCOUNT_ID','GOOGLE_ACCOUNT_ID');
  if(!accountId)throw new Error('Google Business Profile account is not configured in this deployment');
  const map=parseLocationMap();
  const scope=requested?.length?Object.entries(map).filter(([name])=>requested.some(item=>item.toLowerCase()===name.toLowerCase())):Object.entries(map);
  if(!scope.length)throw new Error('Google Business Profile returned no mapped locations for the selected scope');
  const token=await oauthToken();
  const rows=await Promise.all(scope.map(async([location,id])=>{
    const reviews=await locationReviews(parent(accountId,id),start,end,token);
    const ratings=reviews.map(review=>stars(review.starRating)).filter(value=>value>0);
    const average=ratings.length?ratings.reduce((sum,value)=>sum+value,0)/ratings.length:0;
    return{location,count:ratings.length,average:Math.round(average*100)/100};
  }));
  return{source:'Google Business Profile API',start,end,locations:rows} as const;
}
