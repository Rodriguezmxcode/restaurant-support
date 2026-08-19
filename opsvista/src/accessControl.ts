export type OpsVistaRole = 'Founder' | 'Corporate' | 'Location Manager' | 'Kitchen' | 'HR' | 'Administration' | 'Maintenance';

export type OpsVistaModule =
  | 'Resumen' | 'Locaciones' | 'Ventas' | 'Local Intelligence' | 'Finanzas' | 'Gastos'
  | 'Horarios' | 'Tasks' | 'Action Center' | 'Prioridades' | 'Pagos' | 'Transferencias' | 'Configuración';

export type LocationAccessGrant = {
  location: string;
  type: 'Primary' | 'Additional';
  expiresAt?: string;
  note?: string;
};

export type PermissionSet = {
  modules: OpsVistaModule[];
  allLocations: boolean;
  canManageUsers: boolean;
  canManagePlatform: boolean;
  canManageIntegrations: boolean;
  canRunAutomation: boolean;
  canUseCopilot: boolean;
  canReviewEvidence: boolean;
  canEscalateActions: boolean;
  canVerifyActions: boolean;
  canApprovePayments: boolean;
  canSeeFinancialImpact: boolean;
};

export type OpsVistaUser = {
  id: string;
  name: string;
  email?: string;
  role: OpsVistaRole;
  title: string;
  /** Legacy/permanent scope kept for backwards-compatible auth payloads. */
  locations: string[];
  /** Preferred model: one principal location plus explicit additional grants. */
  locationGrants?: LocationAccessGrant[];
  active: boolean;
};

const allModules: OpsVistaModule[] = ['Resumen','Locaciones','Ventas','Local Intelligence','Finanzas','Gastos','Horarios','Tasks','Action Center','Prioridades','Pagos','Transferencias','Configuración'];

export const rolePermissions: Record<OpsVistaRole, PermissionSet> = {
  Founder: {
    modules: allModules,
    allLocations: true, canManageUsers: true, canManagePlatform: true, canManageIntegrations: true,
    canRunAutomation: true, canUseCopilot: true, canReviewEvidence: true, canEscalateActions: true,
    canVerifyActions: true, canApprovePayments: true, canSeeFinancialImpact: true,
  },
  Corporate: {
    modules: allModules,
    allLocations: true, canManageUsers: true, canManagePlatform: false, canManageIntegrations: false,
    canRunAutomation: true, canUseCopilot: true, canReviewEvidence: true, canEscalateActions: true,
    canVerifyActions: true, canApprovePayments: true, canSeeFinancialImpact: true,
  },
  'Location Manager': {
    modules: ['Resumen','Locaciones','Ventas','Local Intelligence','Horarios','Tasks','Action Center','Prioridades','Transferencias'],
    allLocations: false, canManageUsers: false, canManagePlatform: false, canManageIntegrations: false,
    canRunAutomation: false, canUseCopilot: true, canReviewEvidence: true, canEscalateActions: true,
    canVerifyActions: true, canApprovePayments: false, canSeeFinancialImpact: true,
  },
  Kitchen: {
    modules: ['Resumen','Locaciones','Tasks','Action Center','Prioridades','Transferencias'],
    allLocations: false, canManageUsers: false, canManagePlatform: false, canManageIntegrations: false,
    canRunAutomation: false, canUseCopilot: true, canReviewEvidence: true, canEscalateActions: true,
    canVerifyActions: true, canApprovePayments: false, canSeeFinancialImpact: false,
  },
  HR: {
    modules: ['Resumen','Locaciones','Horarios','Action Center','Configuración'],
    allLocations: true, canManageUsers: false, canManagePlatform: false, canManageIntegrations: false,
    canRunAutomation: false, canUseCopilot: true, canReviewEvidence: false, canEscalateActions: true,
    canVerifyActions: false, canApprovePayments: false, canSeeFinancialImpact: false,
  },
  Administration: {
    modules: ['Resumen','Finanzas','Gastos','Action Center','Pagos','Transferencias','Configuración'],
    allLocations: true, canManageUsers: false, canManagePlatform: false, canManageIntegrations: false,
    canRunAutomation: false, canUseCopilot: true, canReviewEvidence: false, canEscalateActions: true,
    canVerifyActions: true, canApprovePayments: true, canSeeFinancialImpact: true,
  },
  Maintenance: {
    modules: ['Resumen','Locaciones','Tasks','Action Center','Prioridades'],
    allLocations: true, canManageUsers: false, canManagePlatform: false, canManageIntegrations: false,
    canRunAutomation: false, canUseCopilot: true, canReviewEvidence: false, canEscalateActions: true,
    canVerifyActions: true, canApprovePayments: false, canSeeFinancialImpact: false,
  },
};

const grants = (locations: string[]): LocationAccessGrant[] => locations.map((location,index)=>({ location, type:index===0?'Primary':'Additional', note:index===0?'Home location':'Permanent management coverage' }));

/** Finalized initial directory for database bootstrap. No credentials or password material live here. */
export const seedUsers: OpsVistaUser[] = [
  { id:'usr-founder-roberto', name:'Roberto Rodríguez', email:'rodriguez.evolife@gmail.com', role:'Founder', title:'Founder / Owner / Super Admin', locations:[], active:true },
  { id:'usr-roberto-ops', name:'Roberto Rodríguez', email:'roberto@puertovallartausa.com', role:'Corporate', title:'Operations', locations:[], active:true },
  { id:'usr-jacob', name:'Jacob Rodríguez', email:'jacob@puertovallartausa.com', role:'Corporate', title:'President', locations:[], active:true },
  { id:'usr-esaul', name:'Esaul Rodríguez', email:'esaul08@gmail.com', role:'Corporate', title:'CEO', locations:[], active:true },
  { id:'usr-caleb', name:'Caleb Kyllo', email:'caleb@puertovallartausa.com', role:'Corporate', title:'Corporate', locations:[], active:true },
  { id:'usr-gladys', name:'Gladys Valdez', email:'gvaldez1223@outlook.com', role:'HR', title:'Human Resources & Payroll', locations:[], active:true },
  { id:'usr-eduardo', name:'Eduardo Santos', email:'lalo@puertovallartausa.com', role:'Kitchen', title:'Kitchen Operations', locations:['Stamford','Orange','Fairfield','Danbury','Avon','Southington'], locationGrants:grants(['Stamford','Orange','Fairfield','Danbury','Avon','Southington']), active:true },
  { id:'usr-miguel', name:'Miguel Bello', email:'miguel@puertovallartausa.com', role:'Maintenance', title:'Maintenance', locations:[], active:true },
  { id:'usr-samantha', name:'Samantha Lora', email:'invoicepv@puertovallartausa.com', role:'Administration', title:'Administration', locations:[], active:true },
  { id:'usr-jonathan', name:'Jonathan Rodríguez', email:'jonathan@puertovallartausa.com', role:'Administration', title:'Administration', locations:[], active:true },
  { id:'usr-ali', name:'Ali Vinicio', email:'ali@puertovallartausa.com', role:'Location Manager', title:'Restaurant Manager', locations:['Avon'], locationGrants:grants(['Avon']), active:true },
  { id:'usr-christopher', name:'Christopher Guerrero', email:'cristopher@puertovallartausa.com', role:'Location Manager', title:'Restaurant Manager', locations:['Danbury'], locationGrants:grants(['Danbury']), active:true },
  { id:'usr-daniel', name:'Daniel Castro', email:'daniel@puertovallartausa.com', role:'Location Manager', title:'Restaurant Manager', locations:['Danbury'], locationGrants:grants(['Danbury']), active:true },
  { id:'usr-janneth', name:'Janneth Domínguez', email:'janneth@puertovallartausa.com', role:'Location Manager', title:'Restaurant Manager', locations:['Orange'], locationGrants:grants(['Orange']), active:true },
  { id:'usr-jhohan', name:'Jhohan Hernández', email:'jhohan@puertovallartausa.com', role:'Location Manager', title:'Restaurant Manager', locations:['Southington','Avon'], locationGrants:grants(['Southington','Avon']), active:true },
  { id:'usr-juan-delgado', name:'Juan Delgado', email:'juandelgado@puertovallartausa.com', role:'Location Manager', title:'Restaurant Manager', locations:['Stamford'], locationGrants:grants(['Stamford']), active:true },
  { id:'usr-juan-sebastian', name:'Juan Sebastián Zuleta', email:'jzuleta@puertovallartausa.com', role:'Location Manager', title:'Restaurant Manager', locations:['Southington'], locationGrants:grants(['Southington']), active:true },
  { id:'usr-juan-zuleta', name:'Juan Zuleta', email:'juanzuleta@puertovallartausa.com', role:'Location Manager', title:'Restaurant Manager', locations:['Stamford','Southington'], locationGrants:grants(['Stamford','Southington']), active:true },
  { id:'usr-michael', name:'Michael Monsalve', email:'michael@puertovallartausa.com', role:'Location Manager', title:'Restaurant Manager', locations:['Fairfield'], locationGrants:grants(['Fairfield']), active:true },
  { id:'usr-pedro', name:'Pedro Santiago', email:'pedro@puertovallartausa.com', role:'Location Manager', title:'Restaurant Manager', locations:['Orange'], locationGrants:grants(['Orange']), active:true },
];

function cloneUser(user: OpsVistaUser): OpsVistaUser {
  return { ...user, locations:[...user.locations], locationGrants:user.locationGrants?.map(grant=>({...grant})) };
}

/** Mutable preview/session directory. Authentication replaces this with the signed-in identity. */
export const demoUsers: OpsVistaUser[] = seedUsers.map(cloneUser);

export function permissionsFor(user: OpsVistaUser) { return rolePermissions[user.role]; }
export function canAccessModule(user: OpsVistaUser, module: string) { return permissionsFor(user).modules.includes(module as OpsVistaModule); }

export function activeLocationGrants(user: OpsVistaUser, now = new Date()) {
  const source = user.locationGrants?.length ? user.locationGrants : user.locations.map((location,index)=>({location,type:index===0?'Primary':'Additional'} as LocationAccessGrant));
  return source.filter(grant=>!grant.expiresAt || new Date(grant.expiresAt).getTime()>now.getTime());
}
export function effectiveLocations(user: OpsVistaUser, now = new Date()) { return Array.from(new Set(activeLocationGrants(user,now).map(grant=>grant.location))); }
export function primaryLocation(user: OpsVistaUser) { return activeLocationGrants(user).find(grant=>grant.type==='Primary')?.location ?? effectiveLocations(user)[0]; }
export function canAccessLocation(user: OpsVistaUser, location: string) { return permissionsFor(user).allLocations || effectiveLocations(user).includes(location); }
export function visibleLocations(user: OpsVistaUser, allLocations: string[]) { return permissionsFor(user).allLocations ? allLocations : allLocations.filter(location=>effectiveLocations(user).includes(location)); }
export function scopeRows<T extends { location:string }>(user:OpsVistaUser,rows:T[]) { return rows.filter(row=>canAccessLocation(user,row.location)); }
