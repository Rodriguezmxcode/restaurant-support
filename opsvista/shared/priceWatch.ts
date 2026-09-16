export type PriceWatchCategory='Food'|'Liquor'|'Supplies'|'Other';
export type PriceWatchLine={
  transactionId:string;invoiceNumber?:string;date:string;location:string;vendor:string;approved:boolean;credit:boolean;
  itemId?:string;itemName:string;vendorItemNumber?:string;uom?:string;quantity:number|null;unitPrice:number|null;lineTotal:number|null;
  packSize?:string;weight?:number|null;category:PriceWatchCategory;source:'r365-item'|'r365-detail';verify:string[];
};
export type PriceWatchPoint={date:string;location:string;vendor:string;invoiceNumber?:string;uom?:string;quantity:number|null;unitPrice:number|null;lineTotal:number|null;packSize?:string;credit:boolean;verify:string[]};
export type PriceWatchAlert={
  key:string;itemName:string;vendorItemNumber?:string;category:PriceWatchCategory;current:PriceWatchPoint;previous?:PriceWatchPoint;
  baselinePrice:number|null;changePct:number|null;impact:number|null;fourWeekHigh:boolean;consecutiveIncreases:number;status:'BUY'|'WATCH'|'HIGH'|'CRITICAL'|'VERIFY';
  locations:string[];vendors:string[];bestComparable?:{vendor:string;location:string;price:number;date:string};history:PriceWatchPoint[];verify:string[];
};
export type PriceWatchSummary={lines:number;items:number;alerts5:number;alerts10:number;alerts20:number;verify:number;estimatedImpact:number;decreases:number};
export type PriceWatchResponse={start:string;end:string;fetchedAt:string;alerts:PriceWatchAlert[];summary:PriceWatchSummary;caveats:string[];sourceCoverage:{itemLines:number;accountLines:number;invoices:number}};
const money=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
const norm=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const canonicalUom=(v?:string)=>{const n=norm(v||'');if(!n)return'';if(/^(case|cs|caja)$/.test(n))return'case';if(/^(each|ea|unit|unidad)$/.test(n))return'each';if(/^(lb|lbs|pound|pounds)$/.test(n))return'lb';if(/^(oz|ounce|ounces)$/.test(n))return'oz';if(/^(gal|gallon|gallons)$/.test(n))return'gal';if(/^(kg|kilogram|kilograms)$/.test(n))return'kg';if(/^(l|liter|litre|liters|litres)$/.test(n))return'l';return n;};
const identity=(line:PriceWatchLine)=>norm(line.itemId||line.vendorItemNumber||line.itemName);
const comparable=(a:PriceWatchLine,b:PriceWatchLine)=>identity(a)===identity(b)&&canonicalUom(a.uom)===canonicalUom(b.uom)&&norm(a.packSize||'')===norm(b.packSize||'')&&!a.verify.length&&!b.verify.length&&a.unitPrice!==null&&b.unitPrice!==null&&!a.credit&&!b.credit;
export function classifyPriceWatchItem(name:string,vendor='',uom=''):PriceWatchCategory{
 const s=norm(`${name} ${vendor} ${uom}`);if(/tequila|mezcal|wine|beer|lager|ale|vodka|rum|whiskey|bourbon|gin|liquor|champagne|prosecco/.test(s))return'Liquor';
 if(/paper|napkin|foil|container|lid|cup|straw|bag|glove|chemical|clean|sanit|soap|towel|smallware|supply/.test(s))return'Supplies';
 if(/food|produce|meat|beef|chicken|pork|seafood|shrimp|fish|cheese|cream|milk|avocado|tomato|onion|pepper|oil|flour|tortilla|rice|bean|grocery|spice|lime|lemon/.test(s))return'Food';return'Other';
}
export function analyzePriceWatch(lines:PriceWatchLine[],start:string,end:string):PriceWatchResponse{
 const usable=lines.filter(l=>l.itemName&&l.date>=start&&l.date<=end).sort((a,b)=>a.date.localeCompare(b.date));const groups=new Map<string,PriceWatchLine[]>();
 for(const line of usable){const key=identity(line);if(!key)continue;const rows=groups.get(key)||[];rows.push(line);groups.set(key,rows);}
 const alerts:PriceWatchAlert[]=[];
 for(const [key,rows] of groups){const priced=rows.filter(r=>r.unitPrice!==null&&!r.credit);if(!priced.length)continue;const current=priced.at(-1)!;const matches=priced.filter(r=>r!==current&&comparable(r,current));const previous=matches.at(-1);const baselineRows=matches.slice(-3);const baselinePrice=baselineRows.length?money(baselineRows.reduce((s,r)=>s+(r.unitPrice||0),0)/baselineRows.length):previous?.unitPrice??null;const changePct=baselinePrice&&current.unitPrice!==null?money((current.unitPrice-baselinePrice)/baselinePrice*100):null;
  const history:PriceWatchPoint[]=priced.map(r=>({date:r.date,location:r.location,vendor:r.vendor,invoiceNumber:r.invoiceNumber,uom:r.uom,quantity:r.quantity,unitPrice:r.unitPrice,lineTotal:r.lineTotal,packSize:r.packSize,credit:r.credit,verify:r.verify}));
  const comparablePrices=priced.filter(r=>comparable(r,current));const fourWeekHigh=current.unitPrice!==null&&comparablePrices.every(r=>(r.unitPrice||0)<=current.unitPrice!);let consecutiveIncreases=0;for(let i=comparablePrices.length-1;i>0;i--){if((comparablePrices[i].unitPrice||0)>(comparablePrices[i-1].unitPrice||0))consecutiveIncreases++;else break;}
  const impact=changePct!==null&&changePct>0&&baselinePrice!==null&&current.quantity!==null&&current.unitPrice!==null?money((current.unitPrice-baselinePrice)*Math.abs(current.quantity)):null;
  const allVerify=[...new Set(rows.flatMap(r=>r.verify))];let status:PriceWatchAlert['status']='BUY';if(allVerify.length||!previous||changePct===null)status='VERIFY';else if(changePct>=20)status='CRITICAL';else if(changePct>=10)status='HIGH';else if(changePct>=5)status='WATCH';
  const alternatives=usable.filter(r=>r!==current&&comparable(r,current)&&(r.unitPrice||Infinity)<(current.unitPrice||Infinity)).sort((a,b)=>(a.unitPrice||Infinity)-(b.unitPrice||Infinity));const best=alternatives[0];
  alerts.push({key,itemName:current.itemName,vendorItemNumber:current.vendorItemNumber,category:current.category,current:{date:current.date,location:current.location,vendor:current.vendor,invoiceNumber:current.invoiceNumber,uom:current.uom,quantity:current.quantity,unitPrice:current.unitPrice,lineTotal:current.lineTotal,packSize:current.packSize,credit:current.credit,verify:current.verify},previous:previous?{date:previous.date,location:previous.location,vendor:previous.vendor,invoiceNumber:previous.invoiceNumber,uom:previous.uom,quantity:previous.quantity,unitPrice:previous.unitPrice,lineTotal:previous.lineTotal,packSize:previous.packSize,credit:previous.credit,verify:previous.verify}:undefined,baselinePrice,changePct,impact,fourWeekHigh,consecutiveIncreases,status,locations:[...new Set(rows.map(r=>r.location))],vendors:[...new Set(rows.map(r=>r.vendor))],bestComparable:best&&best.unitPrice!==null?{vendor:best.vendor,location:best.location,price:best.unitPrice,date:best.date}:undefined,history,verify:allVerify});
 }
 alerts.sort((a,b)=>{const priority={CRITICAL:5,HIGH:4,WATCH:3,VERIFY:2,BUY:1};return priority[b.status]-priority[a.status]||(b.impact||0)-(a.impact||0)||(b.changePct||-999)-(a.changePct||-999);});
 return{start,end,fetchedAt:new Date().toISOString(),alerts,summary:{lines:usable.length,items:groups.size,alerts5:alerts.filter(a=>(a.changePct||0)>=5).length,alerts10:alerts.filter(a=>(a.changePct||0)>=10).length,alerts20:alerts.filter(a=>(a.changePct||0)>=20).length,verify:alerts.filter(a=>a.status==='VERIFY').length,estimatedImpact:money(alerts.reduce((s,a)=>s+(a.impact||0),0)),decreases:alerts.filter(a=>(a.changePct||0)<0).length},caveats:[],sourceCoverage:{itemLines:usable.filter(l=>l.source==='r365-item').length,accountLines:usable.filter(l=>l.source==='r365-detail').length,invoices:new Set(usable.map(l=>l.transactionId)).size}};
}
