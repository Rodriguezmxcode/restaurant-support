export type ReviewDailyAggregate={date:string;location:string;reviewCount:number;ratingSum:number;fiveStarCount:number;lowRatingCount:number};
export type VistaSocialParseResult={aggregates:ReviewDailyAggregate[];totalRows:number;acceptedRows:number;excludedProfiles:Record<string,number>};

const activeLocations=['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
const months:Record<string,string>={January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',July:'07',August:'08',September:'09',October:'10',November:'11',December:'12'};
const shortMonths:Record<string,string>={Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Sept:'09',Oct:'10',Nov:'11',Dec:'12'};

function csvRows(text:string){
  const rows:string[][]=[];let row:string[]=[],field='',quoted=false;
  const input=text.replace(/^\uFEFF/,'');
  for(let i=0;i<input.length;i+=1){const char=input[i];
    if(quoted){if(char==='"'&&input[i+1]==='"'){field+='"';i+=1}else if(char==='"')quoted=false;else field+=char;continue;}
    if(char==='"'){quoted=true;continue}if(char===','){row.push(field);field='';continue}if(char==='\n'){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';continue}field+=char;
  }
  if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row)}return rows;
}

function isoDate(value:string){
  const input=value.trim();
  const isoMatch=input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);if(isoMatch)return`${isoMatch[1]}-${isoMatch[2].padStart(2,'0')}-${isoMatch[3].padStart(2,'0')}`;
  const namedMatch=input.match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})/);const namedMonth=namedMatch&&(months[namedMatch[1]]||shortMonths[namedMatch[1]]);if(namedMatch&&namedMonth)return`${namedMatch[3]}-${namedMonth}-${namedMatch[2].padStart(2,'0')}`;
  const numericMatch=input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);if(numericMatch)return`${numericMatch[3]}-${numericMatch[1].padStart(2,'0')}-${numericMatch[2].padStart(2,'0')}`;
  return'';
}

function normalized(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function locationName(profile:string){const value=normalized(profile);return activeLocations.find(location=>value.includes(normalized(location)))||'';}
function column(header:string[],...names:string[]){const normalizedNames=names.map(normalized);return header.findIndex(value=>normalizedNames.includes(normalized(value)));}

export function parseVistaSocialReviewsCsv(text:string):VistaSocialParseResult{
  const rows=csvRows(text);if(rows.length<2)throw new Error('El archivo CSV no contiene reseñas.');
  const header=rows[0].map(value=>value.trim().toLowerCase());
  const dateCol=column(header,'date','review date','created date','created at'),profileCol=column(header,'profile','profile name','location'),networkCol=column(header,'network','source'),ratingCol=column(header,'rating','star rating','stars');
  if([dateCol,profileCol,networkCol,ratingCol].some(index=>index<0))throw new Error('El CSV debe incluir date, profile, network y rating.');
  const daily=new Map<string,ReviewDailyAggregate>();const excludedProfiles:Record<string,number>={};let totalRows=0,acceptedRows=0;
  for(const row of rows.slice(1)){if(!row.some(value=>value.trim()))continue;totalRows+=1;
    const network=normalized(row[networkCol]||'');const profile=(row[profileCol]||'').trim();const location=locationName(profile);const date=isoDate(row[dateCol]||'');const rating=Number.parseInt(row[ratingCol]||'',10);
    if(!(network.includes('google')&&(network.includes('business')||network.includes('maps')||network==='google'))||!date||!Number.isInteger(rating)||rating<1||rating>5)continue;
    if(!activeLocations.includes(location)){excludedProfiles[location||profile||'Unknown']=(excludedProfiles[location||profile||'Unknown']||0)+1;continue;}
    acceptedRows+=1;const key=`${date}|${location}`;const current=daily.get(key)??{date,location,reviewCount:0,ratingSum:0,fiveStarCount:0,lowRatingCount:0};
    current.reviewCount+=1;current.ratingSum+=rating;if(rating===5)current.fiveStarCount+=1;if(rating<=2)current.lowRatingCount+=1;daily.set(key,current);
  }
  return{aggregates:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.location.localeCompare(b.location)),totalRows,acceptedRows,excludedProfiles};
}
