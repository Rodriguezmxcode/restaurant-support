import { getRestaurant365Credentials, type Restaurant365Credentials } from './integrationStore.js';

const DEFAULT_BASE_URL = 'https://odata.restaurant365.net/api/v2/views';
const restaurantLocations = ['Stamford', 'Orange', 'Fairfield', 'Danbury', 'Avon', 'Southington'];
const corporateLocation = 'Corporate Office';
const opsVistaLocations = [...restaurantLocations, corporateLocation];

type ODataRow = Record<string, unknown>;
type ODataView = 'Location' | 'GlAccount' | 'Transaction' | 'TransactionDetail' | 'Company';

export type Restaurant365TransactionRow = {
  id: string;
  date: string;
  number?: string;
  name: string;
  type: string;
  approved: boolean;
  location: string;
  entity?: string;
  vendor?: string;
  createdBy?: string;
};

export type Restaurant365AccountRow = {
  id: string;
  autoId?: string;
  number?: string;
  name: string;
  glType?: string;
  operationalCategory?: string;
  locationName?: string;
};

export type Restaurant365LedgerRow = {
  id: string;
  transactionId: string;
  date: string;
  transactionNumber?: string;
  transactionName: string;
  transactionType: string;
  vendor?: string;
  accountId: string;
  accountNumber?: string;
  accountName: string;
  glType?: string;
  operationalCategory?: string;
  classification: 'Revenue' | 'COGS' | 'Labor' | 'Operating Expense' | 'Other Income' | 'Other Expense' | 'Balance Sheet' | 'Unclassified';
  comment?: string;
  debit: number;
  credit: number;
  balance: number;
};

export type Restaurant365LedgerSnapshot = {
  provider: 'restaurant365-odata';
  period: { month: string; start: string; endExclusive: string };
  entity: string;
  sourceLocation: { id: string; name: string };
  fetchedAt: string;
  totals: {
    transactions: number;
    approvedTransactions: number;
    apInvoices: number;
    detailRows: number;
    debits: number;
    credits: number;
    revenue: number;
    cogs: number;
    labor: number;
    operatingExpense: number;
    otherIncome: number;
    otherExpense: number;
    classifiedResult: number;
  };
  groups: Array<{ classification: Restaurant365LedgerRow['classification']; amount: number; accountCount: number }>;
  accounts: Array<Restaurant365AccountRow & { classification: Restaurant365LedgerRow['classification']; debit: number; credit: number; balance: number; pnlAmount: number; lineCount: number }>;
  rows: Restaurant365LedgerRow[];
  quality: {
    status: 'ready-for-reconciliation' | 'incomplete';
    transactionDetailCoveragePct: number | null;
    transactionsWithoutDetails: number;
    detailsWithoutGlAccount: number;
    unclassifiedDetailRows: number;
    duplicateTransactionIds: number;
    duplicateDetailIds: number;
  };
  caveats: string[];
};

export type Restaurant365ApSnapshot = {
  provider: 'restaurant365-odata';
  period: { month: string; start: string; endExclusive: string };
  fetchedAt: string;
  transactions: Restaurant365TransactionRow[];
  totals: { invoices: number; approved: number; pending: number; vendors: number; locations: number };
  caveats: string[];
};

export type Restaurant365CatalogSnapshot = {
  provider: 'restaurant365-odata';
  fetchedAt: string;
  vendors?: Array<{ id: string; number?: string; name: string; comment?: string }>;
  accounts?: Restaurant365AccountRow[];
};

export type Restaurant365Location = {
  id: string;
  number?: string;
  name: string;
  opsVistaLocation?: string;
  entityType?: 'restaurant' | 'corporate-office';
};

export type Restaurant365Status = {
  provider: 'restaurant365-odata';
  mode: 'read-only';
  configured: boolean;
  connected: boolean;
  credentialSource?: 'encrypted-store' | 'environment';
  domain?: string;
  usernameHint?: string;
  savedAt?: string;
  checkedAt?: string;
  latestTransactionAt?: string;
  locations: Restaurant365Location[];
  expectedLocations: string[];
  mappedLocationCount: number;
  mappedRestaurantCount: number;
  corporateMapped: boolean;
  probes: { locations: boolean; glAccounts: boolean; transactions: boolean };
  probeErrors?: Partial<Record<'locations' | 'glAccounts' | 'transactions', string>>;
  pnlReady: boolean;
  error?: string;
};

function environmentCredentials(): Restaurant365Credentials | null {
  const domain = process.env.RESTAURANT365_DOMAIN?.trim();
  const username = process.env.RESTAURANT365_USERNAME?.trim();
  const password = process.env.RESTAURANT365_PASSWORD;
  return domain && username && password ? { domain, username, password } : null;
}

async function credentialsFor(organizationId: string) {
  const stored = await getRestaurant365Credentials(organizationId);
  if (stored) return { credentials: stored, source: 'encrypted-store' as const };
  const environment = environmentCredentials();
  return environment ? { credentials: environment, source: 'environment' as const } : null;
}

function normalized(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/puerto\s+vallarta|mexican\s+restaurant|restaurant/g, '').replace(/[^a-z0-9]/g, '');
}

function mappedLocation(name: string) {
  const candidate = normalized(name);
  return opsVistaLocations.find(location => {
    const expected = normalized(location);
    return candidate === expected || candidate.includes(expected) || expected.includes(candidate);
  });
}

function value(row: ODataRow, candidates: string[]) {
  const entry = Object.entries(row).find(([key]) => candidates.some(candidate => key.toLowerCase() === candidate.toLowerCase()));
  return entry?.[1];
}

function stringValue(row: ODataRow, candidates: string[]) {
  const result = value(row, candidates);
  return result === undefined || result === null ? '' : String(result);
}

function numberValue(row: ODataRow, candidates: string[]) {
  const result = Number(value(row, candidates));
  return Number.isFinite(result) ? result : 0;
}

function booleanValue(row: ODataRow, candidates: string[]) {
  const result = value(row, candidates);
  return result === true || result === 1 || ['true','1','yes'].includes(String(result).toLowerCase());
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function monthPeriod(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('El periodo de Restaurant365 debe usar el formato YYYY-MM.');
  const [year, monthNumber] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));
  if (start.getTime() > Date.now()) throw new Error('Restaurant365 no puede consultar un mes futuro.');
  return { month, start: start.toISOString().slice(0,10), endExclusive: end.toISOString().slice(0,10) };
}

function responseRows(payload: unknown): ODataRow[] {
  if (Array.isArray(payload)) return payload.filter(item => item && typeof item === 'object') as ODataRow[];
  if (!payload || typeof payload !== 'object') return [];
  const rows = (payload as { value?: unknown }).value;
  return Array.isArray(rows) ? rows.filter(item => item && typeof item === 'object') as ODataRow[] : [];
}

function usernameHint(username: string) {
  if (username.includes('@')) {
    const [local, host] = username.split('@');
    return `${local.slice(0, 2)}***@${host}`;
  }
  return username.length <= 3 ? '***' : `${username.slice(0, 2)}***${username.slice(-1)}`;
}

async function odata(credentials: Restaurant365Credentials, view: ODataView, params: Record<string, string>) {
  const base = (process.env.RESTAURANT365_ODATA_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, '');
  const url = new URL(`${base}/${view}`);
  Object.entries(params).forEach(([key, parameter]) => url.searchParams.set(key, parameter));
  const authorization = Buffer.from(`${credentials.domain}\\${credentials.username}:${credentials.password}`, 'utf8').toString('base64');
  const response = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Basic ${authorization}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Restaurant365 rechazó el usuario, la contraseña o el permiso OData.');
    if (response.status === 429) throw new Error('Restaurant365 limitó temporalmente las consultas. Intenta de nuevo en unos minutos.');
    throw new Error(`${view}: Restaurant365 OData respondió con estado ${response.status}.`);
  }
  return responseRows(await response.json());
}

async function odataAll(credentials: Restaurant365Credentials, view: ODataView, params: Record<string, string>, maxRows = 10_000, requestedPageSize = 500) {
  const pageSize = Math.max(1,Math.min(500,requestedPageSize));
  const rows: ODataRow[] = [];
  for (let skip = 0; skip < maxRows; skip += pageSize) {
    const page = await odata(credentials, view, { ...params, '$top': String(Math.min(pageSize,maxRows-skip)), '$skip': String(skip) });
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function probe(credentials: Restaurant365Credentials, view: 'Location' | 'GlAccount' | 'Transaction', params: Record<string, string>) {
  try { return { ok: true as const, rows: await odata(credentials, view, params) }; }
  catch (error) { return { ok: false as const, rows: [] as ODataRow[], error: error instanceof Error ? error.message : `${view}: validación no disponible.` }; }
}

export async function getRestaurant365Status(organizationId: string): Promise<Restaurant365Status> {
  const resolved = await credentialsFor(organizationId);
  const empty: Restaurant365Status = {
    provider: 'restaurant365-odata', mode: 'read-only', configured: Boolean(resolved), connected: false,
    credentialSource: resolved?.source, domain: resolved?.credentials.domain,
    usernameHint: resolved ? usernameHint(resolved.credentials.username) : undefined,
    savedAt: resolved?.credentials.savedAt, locations: [], expectedLocations: opsVistaLocations,
    mappedLocationCount: 0, mappedRestaurantCount: 0, corporateMapped: false,
    probes: { locations: false, glAccounts: false, transactions: false }, pnlReady: false,
  };
  if (!resolved) return empty;

  const [locationProbe, glProbe, transactionProbe] = await Promise.all([
    probe(resolved.credentials, 'Location', { '$select': 'locationId,locationNumber,name', '$orderby': 'name', '$top': '250' }),
    probe(resolved.credentials, 'GlAccount', { '$select': 'glAccountId,glAccountNumber,name,glType,operationalCategory', '$top': '1' }),
    probe(resolved.credentials, 'Transaction', { '$select': 'transactionId,date,type,modifiedOn', '$orderby': 'modifiedOn desc', '$top': '1' }),
  ]);
  const failures = {
    locations: locationProbe.ok ? undefined : locationProbe.error,
    glAccounts: glProbe.ok ? undefined : glProbe.error,
    transactions: transactionProbe.ok ? undefined : transactionProbe.error,
  };
  const authenticationError = [locationProbe,glProbe,transactionProbe].find(result=>!result.ok&&/rechazó el usuario/i.test(result.error||''));
  const connected = locationProbe.ok || glProbe.ok || transactionProbe.ok;
  const mapped = locationProbe.rows.map(row => {
    const name = stringValue(row, ['name', 'locationName']);
    const opsVistaLocation = mappedLocation(name);
    return {
      id: stringValue(row, ['locationId', 'id']),
      number: stringValue(row, ['locationNumber', 'number']) || undefined,
      name,
      opsVistaLocation,
      entityType: opsVistaLocation === corporateLocation ? 'corporate-office' as const : opsVistaLocation ? 'restaurant' as const : undefined,
    };
  }).filter(location => location.id || location.name);
  const mappedLocationCount = new Set(mapped.map(location => location.opsVistaLocation).filter(Boolean)).size;
  const mappedRestaurantCount = new Set(mapped.filter(location=>location.entityType==='restaurant').map(location=>location.opsVistaLocation)).size;
  const corporateMapped = mapped.some(location=>location.entityType==='corporate-office');
  const latestTransactionAt = transactionProbe.rows[0] ? stringValue(transactionProbe.rows[0], ['modifiedOn', 'date']) || undefined : undefined;
  const failedNames = Object.entries(failures).filter(([,message])=>message).map(([name])=>name==='glAccounts'?'plan de cuentas':name==='transactions'?'transacciones':'locaciones');
  return {
    ...empty, connected, checkedAt: new Date().toISOString(), locations: mapped, mappedLocationCount, mappedRestaurantCount, corporateMapped,
    probes: { locations: locationProbe.ok, glAccounts: glProbe.ok, transactions: transactionProbe.ok },
    probeErrors: failures,
    latestTransactionAt,
    pnlReady: mappedLocationCount === opsVistaLocations.length && glProbe.ok && transactionProbe.ok,
    error: authenticationError?.error || (failedNames.length ? `La autenticación funcionó, pero falta validar: ${failedNames.join(', ')}.` : undefined),
  };
}

async function requiredCredentials(organizationId: string) {
  const resolved = await credentialsFor(organizationId);
  if (!resolved) throw new Error('Restaurant365 no está configurado para esta organización.');
  return resolved.credentials;
}

function locationFromRow(row: ODataRow): Restaurant365Location {
  const name = stringValue(row,['name','locationName']);
  const opsVistaLocation = mappedLocation(name);
  return {
    id: stringValue(row,['locationId','id']),
    number: stringValue(row,['locationNumber','number']) || undefined,
    name,
    opsVistaLocation,
    entityType: opsVistaLocation === corporateLocation ? 'corporate-office' : opsVistaLocation ? 'restaurant' : undefined,
  };
}

function accountFromRow(row: ODataRow): Restaurant365AccountRow {
  return {
    id: stringValue(row,['glAccountId','id']),
    autoId: stringValue(row,['glAccountAutoId']) || undefined,
    number: stringValue(row,['glAccountNumber','number']) || undefined,
    name: stringValue(row,['name','glAccountName']) || 'Cuenta GL sin nombre',
    glType: stringValue(row,['glType']) || undefined,
    operationalCategory: stringValue(row,['operationalCategory']) || undefined,
    locationName: stringValue(row,['locationName']) || undefined,
  };
}

function transactionFromRow(row: ODataRow, companies: Map<string,string>): Restaurant365TransactionRow {
  const companyId = stringValue(row,['companyId']).toLowerCase();
  const locationName = stringValue(row,['locationName']);
  return {
    id: stringValue(row,['transactionId','id']),
    date: stringValue(row,['date']),
    number: stringValue(row,['transactionNumber','number']) || undefined,
    name: stringValue(row,['name']) || 'Transacción sin nombre',
    type: stringValue(row,['type']) || 'Sin tipo',
    approved: booleanValue(row,['isApproved']),
    location: locationName,
    entity: mappedLocation(locationName),
    vendor: companies.get(companyId),
    createdBy: stringValue(row,['createdBy']) || undefined,
  };
}

function classifyAccount(account?: Restaurant365AccountRow): Restaurant365LedgerRow['classification'] {
  if (!account) return 'Unclassified';
  const type = normalized(account.glType||'');
  const category = normalized(account.operationalCategory||'');
  const name = normalized(account.name);
  if (/asset|liability|equity/.test(type)) return 'Balance Sheet';
  if (/costofgoods|cogs|foodcost|beveragecost/.test(`${type}${category}`)) return 'COGS';
  if (/labor|payroll|wage/.test(`${category}${name}`)) return 'Labor';
  if (/otherincome/.test(`${type}${category}`)) return 'Other Income';
  if (/income|revenue|sales/.test(`${type}${category}`)) return 'Revenue';
  if (/otherexpense/.test(`${type}${category}`)) return 'Other Expense';
  if (/expense/.test(`${type}${category}`)) return 'Operating Expense';
  return 'Unclassified';
}

function pnlAmount(classification: Restaurant365LedgerRow['classification'], debit: number, credit: number) {
  if (classification === 'Revenue' || classification === 'Other Income') return money(credit-debit);
  if (['COGS','Labor','Operating Expense','Other Expense'].includes(classification)) return money(debit-credit);
  return 0;
}

function uniqueRows(rows: ODataRow[], candidates: string[]) {
  const found = new Map<string,ODataRow>();
  let duplicates = 0;
  for (const row of rows) {
    const id = stringValue(row,candidates).toLowerCase();
    if (!id) continue;
    if (found.has(id)) duplicates += 1;
    else found.set(id,row);
  }
  return { rows: Array.from(found.values()), duplicates };
}

function chunks<T>(rows: T[], size: number) {
  const result: T[][] = [];
  for (let index=0; index<rows.length; index+=size) result.push(rows.slice(index,index+size));
  return result;
}

async function parallelMap<T,R>(items:T[], concurrency:number, callback:(item:T)=>Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await callback(items[index]);
    }
  }));
  return results;
}

function odataIdentifier(value:string) {
  const candidate=value.trim();
  return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(candidate)||/^\d+$/.test(candidate)?candidate:'';
}

async function companiesForTransactions(credentials:Restaurant365Credentials,rows:ODataRow[]) {
  const ids=Array.from(new Set(rows.map(row=>odataIdentifier(stringValue(row,['companyId']))).filter(Boolean)));
  if(!ids.length)return new Map<string,string>();
  const pages=await parallelMap(chunks(ids,40),5,batch=>odataAll(credentials,'Company',{
    '$select':'companyId,name',
    '$filter':batch.map(id=>`companyId eq ${id}`).join(' or '),
    '$orderby':'companyId',
  },500,100));
  return new Map(pages.flat().map(row=>[stringValue(row,['companyId','id']).toLowerCase(),stringValue(row,['name'])]).filter(([id,name])=>id&&name));
}

async function glAccountsForDetails(credentials:Restaurant365Credentials,rows:ODataRow[]) {
  const ids=Array.from(new Set(rows.map(row=>odataIdentifier(stringValue(row,['glAccountId']))).filter(Boolean)));
  if(!ids.length)return [] as Restaurant365AccountRow[];
  const pages=await parallelMap(chunks(ids,40),5,batch=>odataAll(credentials,'GlAccount',{
    '$select':'glAccountAutoId,glAccountId,glAccountNumber,name,glType,operationalCategory,locationName',
    '$filter':batch.map(id=>/^\d+$/.test(id)?`glAccountAutoId eq ${id}`:`glAccountId eq ${id}`).join(' or '),
    '$orderby':'glAccountAutoId',
  },500,100));
  return uniqueRows(pages.flat(),['glAccountAutoId','glAccountId','id']).rows.map(accountFromRow);
}

async function locationCatalog(credentials: Restaurant365Credentials) {
  const rows = await odataAll(credentials,'Location',{'$select':'locationId,locationNumber,name','$orderby':'name,locationId'},1_000);
  return rows.map(locationFromRow).filter(location=>location.id&&location.name);
}

async function companyCatalog(credentials: Restaurant365Credentials) {
  const rows = await odataAll(credentials,'Company',{'$select':'companyId,companyNumber,name,comment','$orderby':'name,companyId'},10_000,250);
  const companies = new Map(rows.map(row=>[stringValue(row,['companyId','id']).toLowerCase(),stringValue(row,['name'])]).filter(([id,name])=>id&&name));
  return {rows,companies};
}

async function glAccountCatalog(credentials: Restaurant365Credentials, locationId:string) {
  const rows = await odataAll(credentials,'GlAccount',{
    '$select':'glAccountAutoId,glAccountId,glAccountNumber,name,glType,operationalCategory,locationName',
    '$filter':`locationId eq ${locationId}`,
    '$orderby':'glAccountAutoId',
  },5_000,100);
  return uniqueRows(rows,['glAccountAutoId','glAccountId','id']).rows.map(accountFromRow);
}

async function monthTransactionRows(credentials: Restaurant365Credentials, month:string, locationId?:string) {
  const period = monthPeriod(month);
  const locationFilter = locationId ? ` and locationId eq ${locationId}` : '';
  const rows = await odataAll(credentials,'Transaction',{
    '$select':'transactionId,locationId,locationName,date,transactionNumber,name,type,isApproved,companyId,createdBy,createdOn,modifiedOn',
    '$filter':`date ge ${period.start}T00:00:00Z and date lt ${period.endExclusive}T00:00:00Z${locationFilter}`,
    '$orderby':'date,transactionNumber,transactionId',
  },10_000,250);
  return {period,...uniqueRows(rows,['transactionId','id'])};
}

async function transactionDetails(credentials: Restaurant365Credentials, transactionIds:string[]) {
  const ids=transactionIds.map(odataIdentifier).filter(Boolean);
  const batches = chunks(ids,40);
  const pages = await parallelMap(batches,6,batch=>odataAll(credentials,'TransactionDetail',{
    '$select':'transactionDetailAutoId,transactionDetailId,transactionId,locationId,glAccountId,item,credit,debit,amount,quantity,adjustment,unitOfMeasureName,comment,createdOn,modifiedOn',
    '$filter':batch.map(id=>`transactionId eq ${id}`).join(' or '),
    '$orderby':'transactionId,transactionDetailAutoId',
  },10_000));
  return uniqueRows(pages.flat(),['transactionDetailAutoId','transactionDetailId']);
}

export async function getRestaurant365Ledger(organizationId:string, month:string, entity:string):Promise<Restaurant365LedgerSnapshot> {
  if (!opsVistaLocations.includes(entity)) throw new Error('La entidad solicitada no está mapeada en OpsVista.');
  const credentials = await requiredCredentials(organizationId);
  const locations = await locationCatalog(credentials);
  const sourceLocation = locations.find(location=>location.opsVistaLocation===entity);
  if (!sourceLocation) throw new Error(`${entity} no tiene una locación correspondiente en Restaurant365.`);
  const transactionResult = await monthTransactionRows(credentials,month,sourceLocation.id);
  const approvedSourceRows=transactionResult.rows.filter(row=>booleanValue(row,['isApproved']));
  const [detailResult,companies] = await Promise.all([
    transactionDetails(credentials,approvedSourceRows.map(row=>stringValue(row,['transactionId','id']))),
    companiesForTransactions(credentials,approvedSourceRows),
  ]);
  const accounts=await glAccountsForDetails(credentials,detailResult.rows);
  const transactions = transactionResult.rows.map(row=>transactionFromRow(row,companies));
  const approved = transactions.filter(transaction=>transaction.approved);
  const transactionMap = new Map(approved.map(transaction=>[transaction.id.toLowerCase(),transaction]));
  const accountMap = new Map<string,Restaurant365AccountRow>();
  for (const account of accounts) {
    accountMap.set(account.id.toLowerCase(),account);
    if (account.autoId) accountMap.set(account.autoId.toLowerCase(),account);
  }
  const rows: Restaurant365LedgerRow[] = detailResult.rows.map(row=>{
    const transactionId = stringValue(row,['transactionId']).toLowerCase();
    const transaction = transactionMap.get(transactionId);
    const accountId = stringValue(row,['glAccountId']).toLowerCase();
    const account = accountMap.get(accountId);
    const classification = classifyAccount(account);
    const debit = money(numberValue(row,['debit']));
    const credit = money(numberValue(row,['credit']));
    return {
      id:stringValue(row,['transactionDetailAutoId','transactionDetailId']),transactionId,
      date:transaction?.date||'',transactionNumber:transaction?.number,transactionName:transaction?.name||'Transacción sin encabezado',
      transactionType:transaction?.type||'Sin tipo',vendor:transaction?.vendor,accountId,
      accountNumber:account?.number,accountName:account?.name||'Cuenta GL sin correspondencia',glType:account?.glType,
      operationalCategory:account?.operationalCategory,classification,comment:stringValue(row,['comment'])||undefined,
      debit,credit,balance:money(debit-credit),
    };
  }).filter(row=>transactionMap.has(row.transactionId));

  const accountTotals = new Map<string,Restaurant365LedgerSnapshot['accounts'][number]>();
  for (const row of rows) {
    const current = accountTotals.get(row.accountId) || {
      id:row.accountId,number:row.accountNumber,name:row.accountName,glType:row.glType,operationalCategory:row.operationalCategory,
      classification:row.classification,debit:0,credit:0,balance:0,pnlAmount:0,lineCount:0,
    };
    current.debit = money(current.debit+row.debit);
    current.credit = money(current.credit+row.credit);
    current.balance = money(current.debit-current.credit);
    current.pnlAmount = pnlAmount(current.classification,current.debit,current.credit);
    current.lineCount += 1;
    accountTotals.set(row.accountId,current);
  }
  const accounts = Array.from(accountTotals.values()).sort((left,right)=>Math.abs(right.pnlAmount)-Math.abs(left.pnlAmount)||left.name.localeCompare(right.name));
  const classifications:Restaurant365LedgerRow['classification'][]=['Revenue','COGS','Labor','Operating Expense','Other Income','Other Expense','Balance Sheet','Unclassified'];
  const groups = classifications.map(classification=>({classification,amount:money(accounts.filter(account=>account.classification===classification).reduce((sum,account)=>sum+account.pnlAmount,0)),accountCount:accounts.filter(account=>account.classification===classification).length}));
  const groupAmount = (classification:Restaurant365LedgerRow['classification'])=>groups.find(group=>group.classification===classification)?.amount||0;
  const transactionIdsWithDetails = new Set(rows.map(row=>row.transactionId));
  const transactionsWithoutDetails = approved.filter(transaction=>!transactionIdsWithDetails.has(transaction.id.toLowerCase())).length;
  const detailsWithoutGlAccount = rows.filter(row=>!accountMap.has(row.accountId)).length;
  const unclassifiedDetailRows = rows.filter(row=>row.classification==='Unclassified').length;
  const qualityReady = approved.length>0 && transactionsWithoutDetails===0 && detailsWithoutGlAccount===0 && unclassifiedDetailRows===0;
  const revenue=groupAmount('Revenue'),cogs=groupAmount('COGS'),labor=groupAmount('Labor'),operatingExpense=groupAmount('Operating Expense'),otherIncome=groupAmount('Other Income'),otherExpense=groupAmount('Other Expense');
  return {
    provider:'restaurant365-odata',period:transactionResult.period,entity,sourceLocation:{id:sourceLocation.id,name:sourceLocation.name},fetchedAt:new Date().toISOString(),
    totals:{transactions:transactions.length,approvedTransactions:approved.length,apInvoices:approved.filter(transaction=>/ap\s*invoice/i.test(transaction.type)).length,detailRows:rows.length,
      debits:money(rows.reduce((sum,row)=>sum+row.debit,0)),credits:money(rows.reduce((sum,row)=>sum+row.credit,0)),revenue,cogs,labor,operatingExpense,otherIncome,otherExpense,
      classifiedResult:money(revenue+otherIncome-cogs-labor-operatingExpense-otherExpense)},
    groups,accounts,rows:rows.sort((left,right)=>right.date.localeCompare(left.date)||left.accountName.localeCompare(right.accountName)),
    quality:{status:qualityReady?'ready-for-reconciliation':'incomplete',transactionDetailCoveragePct:approved.length?money((approved.length-transactionsWithoutDetails)/approved.length*100):null,
      transactionsWithoutDetails,detailsWithoutGlAccount,unclassifiedDetailRows,duplicateTransactionIds:transactionResult.duplicates,duplicateDetailIds:detailResult.duplicates},
    caveats:['Solo se incluyen transacciones aprobadas en los cálculos del ledger.','El resultado clasificado es preliminar hasta compararlo con el P&L oficial de Restaurant365.','El estado exacto de pago y los archivos de recibos no forman parte de estas vistas OData verificadas.'],
  };
}

export async function getRestaurant365Ap(organizationId:string,month:string):Promise<Restaurant365ApSnapshot> {
  const credentials = await requiredCredentials(organizationId);
  const transactionResult=await monthTransactionRows(credentials,month);
  const apSourceRows=transactionResult.rows.filter(row=>/ap\s*invoice/i.test(stringValue(row,['type'])));
  const companies=await companiesForTransactions(credentials,apSourceRows);
  const transactions = apSourceRows.map(row=>transactionFromRow(row,companies)).sort((left,right)=>right.date.localeCompare(left.date));
  return {provider:'restaurant365-odata',period:transactionResult.period,fetchedAt:new Date().toISOString(),transactions,
    totals:{invoices:transactions.length,approved:transactions.filter(row=>row.approved).length,pending:transactions.filter(row=>!row.approved).length,vendors:new Set(transactions.map(row=>row.vendor).filter(Boolean)).size,locations:new Set(transactions.map(row=>row.entity).filter(Boolean)).size},
    caveats:['Aprobada en R365 no significa necesariamente pagada.','El estado exacto de pago y el archivo del recibo requieren una fuente adicional verificable de R365.']};
}

export async function getRestaurant365Catalog(organizationId:string,kind:'vendors'|'accounts'):Promise<Restaurant365CatalogSnapshot> {
  const credentials = await requiredCredentials(organizationId);
  if (kind==='vendors') {
    const {rows} = await companyCatalog(credentials);
    return {provider:'restaurant365-odata',fetchedAt:new Date().toISOString(),vendors:rows.map(row=>({id:stringValue(row,['companyId','id']),number:stringValue(row,['companyNumber','number'])||undefined,name:stringValue(row,['name'])||'Vendor sin nombre',comment:stringValue(row,['comment'])||undefined})).filter(vendor=>vendor.id&&vendor.name)};
  }
  const locations = await locationCatalog(credentials);
  const accountPages = await parallelMap(locations.filter(location=>location.id),3,location=>glAccountCatalog(credentials,location.id));
  const accounts = uniqueRows(accountPages.flat().map(account=>account as unknown as ODataRow),['autoId','id']).rows.map(row=>row as unknown as Restaurant365AccountRow)
    .sort((left,right)=>(left.number||'').localeCompare(right.number||'')||left.name.localeCompare(right.name));
  return {provider:'restaurant365-odata',fetchedAt:new Date().toISOString(),accounts};
}
