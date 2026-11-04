export const OVERTIME_TIME_ZONE = 'America/New_York';
export function nextDate(date:string){const d=new Date(`${date}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
export function easternDate(at:Date){return new Intl.DateTimeFormat('en-CA',{timeZone:OVERTIME_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(at);}
export function easternMidnight(date:string){
  const target=Date.parse(`${date}T00:00:00Z`);let instant=target;
  for(let i=0;i<3;i++){
    const parts=new Intl.DateTimeFormat('en-US',{timeZone:OVERTIME_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
    const p=Object.fromEntries(parts.map(part=>[part.type,part.value]));
    const local=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute),Number(p.second));
    instant+=target-local;
  }
  return new Date(instant).toISOString();
}
export function overtimePeriod(start:string,end:string,workedThrough:string,at=new Date()){
  const rangeStart=easternMidnight(start),rangeEnd=easternMidnight(nextDate(end));
  const periodClosed=end<easternDate(at);
  const cutoff=periodClosed?Date.parse(rangeEnd):workedThrough<easternDate(at)?Date.parse(easternMidnight(nextDate(workedThrough))):at.getTime();
  return {rangeStart,rangeEnd,periodClosed,cutoff:Math.min(Date.parse(rangeEnd),Math.max(Date.parse(rangeStart),cutoff))};
}
