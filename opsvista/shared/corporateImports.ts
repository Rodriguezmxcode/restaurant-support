export type CorporatePnlSection='COGS'|'Labor'|'Operating Expenses'|'Occupancy'|'Other Expense'|'Balance Sheet'|'Review';
export type CorporateImportConfidence='auto'|'manual'|'review';
export type CorporateExpenseRow={
  key:string;
  date:string;
  description:string;
  vendor?:string;
  amount:number;
  section:CorporatePnlSection;
  category:string;
  includeInPnl:boolean;
  sourceFile:string;
  sourceSheet:string;
  sourceRow:number;
  notes?:string;
  confidence:CorporateImportConfidence;
};
export type CorporateImportPayload={schemaVersion:1;sourceFile:string;rows:CorporateExpenseRow[]};
export type CorporatePnlSummary={
  total:number;
  cogs:number;
  labor:number;
  operatingExpenses:number;
  occupancy:number;
  otherExpense:number;
  excluded:number;
  reviewCount:number;
  rowCount:number;
};
export type CorporateImportResponse={rows:CorporateExpenseRow[];summary:CorporatePnlSummary;canImport:boolean;updatedAt?:string;error?:string};

export const corporateSections:CorporatePnlSection[]=['COGS','Labor','Operating Expenses','Occupancy','Other Expense','Balance Sheet','Review'];
export const corporateCategories:Record<CorporatePnlSection,string[]>={
  COGS:['Food COGS','Alcohol / Beverage COGS','Other COGS'],
  Labor:['Wages & Salaries','Employer Payroll Taxes','Payroll / Labor'],
  'Operating Expenses':['Payroll Processing','Telecommunications','Bank Fees','Technology / Software','Accounting / Bookkeeping','Legal','Insurance','Repairs / Maintenance','Office Supplies','Travel / Tolls','Utilities','Other Operating Expense'],
  Occupancy:['Corporate Office Rent','CAM / Occupancy','Other Occupancy'],
  'Other Expense':['Other Expense'],
  'Balance Sheet':['Intercompany / Due To-Due From','Payroll Liability','Clearing / Suspense'],
  Review:['Unclassified / Review','Budget / Forecast (excluded)'],
};

const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Registro corporativo inválido.');return value as Record<string,unknown>;};
const text=(value:unknown,label:string,max=500)=>{if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new Error(`${label}: texto inválido.`);return value.trim();};
const optionalText=(value:unknown,max=1000)=>typeof value==='string'&&value.trim()?value.trim().slice(0,max):undefined;
const date=(value:unknown)=>{const result=text(value,'Fecha',10);if(!/^\d{4}-\d{2}-\d{2}$/.test(result)||Number.isNaN(Date.parse(`${result}T12:00:00Z`)))throw new Error('Fecha inválida.');return result;};
const money=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const amount=(value:unknown)=>{if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>100000000)throw new Error('Importe inválido.');return money(value);};
const rowNumber=(value:unknown)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>1000000)throw new Error('Número de fila inválido.');return value;};

export function normalizeCorporateKey(value:string){return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').trim();}
export function stableCorporateRowKey(row:Pick<CorporateExpenseRow,'date'|'description'|'amount'|'sourceSheet'|'sourceRow'>){
  const base=[row.date,normalizeCorporateKey(row.description),money(row.amount).toFixed(2),normalizeCorporateKey(row.sourceSheet),row.sourceRow].join('|');
  let hash=2166136261;
  for(let index=0;index<base.length;index+=1){hash^=base.charCodeAt(index);hash=Math.imul(hash,16777619);}
  return `corp-${(hash>>>0).toString(36)}`;
}

export function suggestCorporateClassification(description:string,vendor=''):{section:CorporatePnlSection;category:string;includeInPnl:boolean;confidence:CorporateImportConfidence}{
  const all=normalizeCorporateKey(`${vendor} ${description}`);
  if(/intercompany|inter company|due to|due from|funding|online transfer|internal transfer|wallet funding/.test(all))return{section:'Balance Sheet',category:'Intercompany / Due To-Due From',includeInPnl:false,confidence:'auto'};
  if(/employee withholding|retencion|withholding|payroll liability/.test(all))return{section:'Balance Sheet',category:'Payroll Liability',includeInPnl:false,confidence:'auto'};
  if(/budget|presupuesto|forecast/.test(all))return{section:'Review',category:'Budget / Forecast (excluded)',includeInPnl:false,confidence:'review'};
  if(/corporate office.*rent|rent.*corporate|renta corporativa/.test(all))return{section:'Occupancy',category:'Corporate Office Rent',includeInPnl:true,confidence:'auto'};
  if(/rent|lease|occupancy|common area|\bcam\b/.test(all))return{section:'Occupancy',category:'Other Occupancy',includeInPnl:true,confidence:'auto'};
  if(/employer tax|payroll tax|impuestos patronales|\ber\b.*tax/.test(all))return{section:'Labor',category:'Employer Payroll Taxes',includeInPnl:true,confidence:'auto'};
  if(/wage|salary|gross pay|sueldos brutos/.test(all))return{section:'Labor',category:'Wages & Salaries',includeInPnl:true,confidence:'auto'};
  if(/payroll|nomina|nómina|tax collect/.test(all))return{section:'Labor',category:'Payroll / Labor',includeInPnl:true,confidence:'auto'};
  if(/toast.*service|payroll processing|servicio toast/.test(all))return{section:'Operating Expenses',category:'Payroll Processing',includeInPnl:true,confidence:'auto'};
  if(/food|produce|seafood|meat|grocery|kitchen|chef warehouse|performance food|sysco/.test(all))return{section:'COGS',category:'Food COGS',includeInPnl:true,confidence:'auto'};
  if(/liquor|alcohol|beer|wine|beverage|provi/.test(all))return{section:'COGS',category:'Alcohol / Beverage COGS',includeInPnl:true,confidence:'auto'};
  if(/at and t|at&t|telecom|telephone|internet|comcast|optimum|cox communication/.test(all))return{section:'Operating Expenses',category:'Telecommunications',includeInPnl:true,confidence:'auto'};
  if(/bank fee|service charge|comision bancaria|comisión bancaria|chase fee/.test(all))return{section:'Operating Expenses',category:'Bank Fees',includeInPnl:true,confidence:'auto'};
  if(/toast|jolt|resy|zendesk|software|technology|\bpos\b/.test(all))return{section:'Operating Expenses',category:'Technology / Software',includeInPnl:true,confidence:'auto'};
  if(/bookkeep|accounting|\bcpa\b|contador/.test(all))return{section:'Operating Expenses',category:'Accounting / Bookkeeping',includeInPnl:true,confidence:'auto'};
  if(/legal|attorney|law firm/.test(all))return{section:'Operating Expenses',category:'Legal',includeInPnl:true,confidence:'auto'};
  if(/insurance|workers comp/.test(all))return{section:'Operating Expenses',category:'Insurance',includeInPnl:true,confidence:'auto'};
  if(/repair|maintenance|equipment/.test(all))return{section:'Operating Expenses',category:'Repairs / Maintenance',includeInPnl:true,confidence:'auto'};
  if(/office suppl|paper|smallware/.test(all))return{section:'Operating Expenses',category:'Office Supplies',includeInPnl:true,confidence:'auto'};
  if(/travel|toll|ezpass|e z pass/.test(all))return{section:'Operating Expenses',category:'Travel / Tolls',includeInPnl:true,confidence:'auto'};
  if(/electric|utility|utilities|gas utility|natural gas|eversource/.test(all))return{section:'Operating Expenses',category:'Utilities',includeInPnl:true,confidence:'auto'};
  return{section:'Review',category:'Unclassified / Review',includeInPnl:false,confidence:'review'};
}

export function parseCorporateImport(input:unknown):CorporateImportPayload{
  const root=object(input);
  if(root.schemaVersion!==1||!Array.isArray(root.rows)||!root.rows.length||root.rows.length>5000)throw new Error('Carga corporativa inválida (versión 1, máximo 5,000 filas).');
  const sourceFile=text(root.sourceFile,'Archivo fuente',240);
  const rows:CorporateExpenseRow[]=[];
  const keys=new Set<string>();
  for(const value of root.rows){
    const row=object(value),section=text(row.section,'Sección',80) as CorporatePnlSection;
    if(!corporateSections.includes(section))throw new Error('Sección P&L inválida.');
    const confidence=text(row.confidence,'Confianza',20) as CorporateImportConfidence;
    if(!['auto','manual','review'].includes(confidence))throw new Error('Confianza inválida.');
    const parsed:CorporateExpenseRow={
      key:text(row.key,'Clave',120),date:date(row.date),description:text(row.description,'Descripción'),vendor:optionalText(row.vendor,240),amount:amount(row.amount),
      section,category:text(row.category,'Categoría',160),includeInPnl:Boolean(row.includeInPnl),sourceFile:text(row.sourceFile,'Archivo',240),sourceSheet:text(row.sourceSheet,'Hoja',160),sourceRow:rowNumber(row.sourceRow),notes:optionalText(row.notes,1500),confidence,
    };
    if(parsed.sourceFile!==sourceFile)throw new Error('Todas las filas deben pertenecer al mismo archivo fuente.');
    if((parsed.section==='Balance Sheet'||parsed.section==='Review')&&parsed.includeInPnl)throw new Error('Balance general y pendientes no pueden entrar al P&L hasta reclasificarse.');
    if(keys.has(parsed.key))throw new Error('La carga contiene filas duplicadas.');
    keys.add(parsed.key);rows.push(parsed);
  }
  return{schemaVersion:1,sourceFile,rows};
}

export function summarizeCorporateRows(rows:CorporateExpenseRow[]):CorporatePnlSummary{
  const included=rows.filter(row=>row.includeInPnl&&row.section!=='Balance Sheet'&&row.section!=='Review');
  const by=(section:CorporatePnlSection)=>money(included.filter(row=>row.section===section).reduce((sum,row)=>sum+row.amount,0));
  return{
    total:money(included.reduce((sum,row)=>sum+row.amount,0)),cogs:by('COGS'),labor:by('Labor'),operatingExpenses:by('Operating Expenses'),occupancy:by('Occupancy'),otherExpense:by('Other Expense'),
    excluded:money(rows.filter(row=>!row.includeInPnl).reduce((sum,row)=>sum+row.amount,0)),reviewCount:rows.filter(row=>row.section==='Review').length,rowCount:rows.length,
  };
}
