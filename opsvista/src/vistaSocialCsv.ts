export type ReviewDailyAggregate={date:string;location:string;reviewCount:number;ratingSum:number;fiveStarCount:number;lowRatingCount:number};
export type VistaSocialParseResult={aggregates:ReviewDailyAggregate[];totalRows:number;acceptedRows:number;excludedProfiles:Record<string,number>};

const activeLocations=['Stamford','Orange','Fairfield','Danbury','Avon','Southington'];
const months:Record<string,string>={January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',July:'07',August:'08',September:'09',October:'10',November:'11',December:'12'};

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
  const match=value.trim().match(/^([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})$/);if(!match||!months[match[1]])return'';
  return `${match[3]}-${months[match[1]]}-${match[2].padStart(2,'0')}`;
}

export function parseVistaSocialReviewsCsv(text:string):VistaSocialParseResult{
  const rows=csvRows(text);if(rows.length<2)throw new Error('El archivo CSV no contiene reseñas.');
  const header=rows[0].map(value=>value.trim().toLowerCase());
  const col=(name:string)=>header.indexOf(name);const dateCol=col('date'),profileCol=col('profile'),networkCol=col('network'),ratingCol=col('rating');
  if([dateCol,profileCol,networkCol,ratingCol].some(index=>index<0))throw new Error('El CSV debe incluir date, profile, network y rating.');
  const daily=new Map<string,ReviewDailyAggregate>();const excludedProfiles:Record<string,number>={};let totalRows=0,acceptedRows=0;
  for(const row of rows.slice(1)){if(!row.some(value=>value.trim()))continue;totalRows+=1;
    const network=(row[networkCol]||'').trim().toLowerCase();const profile=(row[profileCol]||'').trim();const location=profile.replace(/^Puerto Vallarta\s+/i,'').trim();const date=isoDate(row[dateCol]||'');const rating=Number(row[ratingCol]);
    if(network!=='googlebusiness'||!date||!Number.isInteger(rating)||rating<1||rating>5)continue;
    if(!activeLocations.includes(location)){excludedProfiles[location||profile||'Unknown']=(excludedProfiles[location||profile||'Unknown']||0)+1;continue;}
    acceptedRows+=1;const key=`${date}|${location}`;const current=daily.get(key)??{date,location,reviewCount:0,ratingSum:0,fiveStarCount:0,lowRatingCount:0};
    current.reviewCount+=1;current.ratingSum+=rating;if(rating===5)current.fiveStarCount+=1;if(rating<=2)current.lowRatingCount+=1;daily.set(key,current);
  }
  return{aggregates:[...daily.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.location.localeCompare(b.location)),totalRows,acceptedRows,excludedProfiles};
}
