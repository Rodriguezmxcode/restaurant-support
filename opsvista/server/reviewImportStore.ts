import postgres from 'postgres';
import type { SessionUser } from './authSession.js';

export type ReviewDailyAggregate={date:string;location:string;reviewCount:number;ratingSum:number;fiveStarCount:number;lowRatingCount:number};
const activeLocations=['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
let client:ReturnType<typeof postgres>|undefined;let initialized=false;
function databaseUrl(){return process.env.OPSVISTA_DATABASE_URL||process.env.OPSVISTA_DATABASE_DATABASE_URL||'';}
function sql(){const url=databaseUrl();if(!url)throw new Error('OpsVista database URL is not configured');if(!client)client=postgres(url,{max:4,idle_timeout:20,connect_timeout:10});return client;}
async function ensureSchema(){if(initialized)return;await sql()`create table if not exists opsvista_review_daily (
 source text not null, location text not null, review_date date not null, review_count integer not null, rating_sum numeric(12,2) not null,
 five_star_count integer not null default 0, low_rating_count integer not null default 0, updated_at timestamptz not null default now(), updated_by text,
 primary key(source,location,review_date)
)`;await sql()`create index if not exists opsvista_review_daily_range_idx on opsvista_review_daily(review_date,location)`;initialized=true;}
function valid(row:ReviewDailyAggregate){return /^\d{4}-\d{2}-\d{2}$/.test(row.date)&&activeLocations.includes(row.location)&&Number.isInteger(row.reviewCount)&&row.reviewCount>=0&&Number.isFinite(row.ratingSum)&&row.ratingSum>=row.reviewCount&&row.ratingSum<=row.reviewCount*5&&Number.isInteger(row.fiveStarCount)&&row.fiveStarCount>=0&&row.fiveStarCount<=row.reviewCount&&Number.isInteger(row.lowRatingCount)&&row.lowRatingCount>=0&&row.lowRatingCount<=row.reviewCount;}

export function reviewImportConfigured(){return Boolean(databaseUrl());}
export async function importVistaSocialReviewAggregates(rows:ReviewDailyAggregate[],actor:SessionUser){
 await ensureSchema();if(!Array.isArray(rows)||!rows.length)throw new Error('No review aggregates were provided');if(rows.length>250)throw new Error('A review import can contain at most 250 daily location rows');if(rows.some(row=>!valid(row)))throw new Error('The Vista Social review import contains invalid rows');
 await sql().begin(async tx=>{for(const row of rows){await tx`insert into opsvista_review_daily(source,location,review_date,review_count,rating_sum,five_star_count,low_rating_count,updated_by)
 values('Vista Social CSV',${row.location},${row.date},${row.reviewCount},${row.ratingSum},${row.fiveStarCount},${row.lowRatingCount},${actor.id})
 on conflict(source,location,review_date) do update set review_count=excluded.review_count,rating_sum=excluded.rating_sum,five_star_count=excluded.five_star_count,low_rating_count=excluded.low_rating_count,updated_at=now(),updated_by=excluded.updated_by`;}});
 const dates=rows.map(row=>row.date).sort();return{source:'Vista Social CSV',dailyRows:rows.length,reviewCount:rows.reduce((sum,row)=>sum+row.reviewCount,0),dateStart:dates[0],dateEnd:dates[dates.length-1]};
}

export async function getImportedReviewSummaries(start:string,end:string,scope?:string[]){
 await ensureSchema();const selected=scope?.length?scope:activeLocations;const allRows=await sql()`select location,sum(review_count)::int as review_count,sum(rating_sum)::numeric as rating_sum,sum(five_star_count)::int as five_star_count,sum(low_rating_count)::int as low_rating_count,max(updated_at) as updated_at
 from opsvista_review_daily where source='Vista Social CSV' and review_date>=${start} and review_date<=${end} group by location`;const rows=allRows.filter(row=>selected.includes(String(row.location)));
 const locations=selected.map(location=>{const row=rows.find(item=>String(item.location)===location);if(!row)return{location,reviewCount:0,averageRating:null,fiveStarCount:0,lowRatingCount:0,unansweredCount:null,minimumMet:false,scorePct:0};const reviewCount=Number(row.review_count)||0,ratingSum=Number(row.rating_sum)||0,averageRating=reviewCount?ratingSum/reviewCount:null,minimumMet=reviewCount>=5,quality=averageRating===null?0:averageRating/5,volume=Math.min(1,reviewCount/10),scorePct=minimumMet?Math.min(100,(quality*.9+volume*.1)*100):0;return{location,reviewCount,averageRating,fiveStarCount:Number(row.five_star_count)||0,lowRatingCount:Number(row.low_rating_count)||0,unansweredCount:null,minimumMet,scorePct};});
 return{source:'Vista Social CSV',start,end,minimumReviews:5,scoring:{qualityWeight:90,volumeWeight:10,volumeTarget:10},locations,hasData:rows.length>0,lastUpdated:rows.length?new Date(Math.max(...rows.map(row=>new Date(String(row.updated_at)).getTime()))).toISOString():null};
}
