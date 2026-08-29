export type OpsVistaRole = 'Founder' | 'Corporate' | 'Location Manager' | 'Kitchen' | 'HR' | 'Administration' | 'Maintenance';

export type OpsVistaModule =
  | 'Resumen' | 'Locaciones' | 'Ventas' | 'Google Reviews' | 'Local Intelligence' | 'Finanzas' | 'Gastos'
  | 'Horarios' | 'Tasks' | 'Bono semanal' | 'Action Center' | 'Proyectos' | 'Prioridades' | 'Pagos' | 'Transferencias' | 'Configuración';

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
  locations: string[];
  locationGrants?: LocationAccessGrant[];
  active: boolean;
};

const allModules: OpsVistaModule[] = ['Resumen','Locaciones','Ventas','Google Reviews','Local Intelligence','Finanzas','Gastos','Horarios','Tasks','Bono semanal','Action Center','Proyectos','Prioridades','Pagos','Transferencias','Configuración'];

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
    modules: ['Resumen','Locaciones','Ventas','Google Reviews','Local Intelligence','Horarios','Tasks','Bono semanal','Action Center','Proyectos','Prioridades','Pagos','Transferencias'],
    allLocations: false, canManageUsers: false, canManagePlatform: false, canManageIntegrations: false,
    canRunAutomation: false, canUseCopilot: true, canReviewEvidence: true, canEscalateActions: true,
    canVerifyActions: true, canApprovePayments: false, canSeeFinancialImpact: true,
  },
  Kitchen: {
    modules: ['Resumen','Locaciones','Tasks','Bono semanal','Action Center','Proyectos','Prioridades','Transferencias'],
    allLocations: false, canManageUsers: false, canManagePlatform: false, canManageIntegrations: false,
    canRunAutomation: false, canUseCopilot: true, canReviewEvidence: true, canEscalateActions: true,
    canVerifyActions: true, canApprovePayments: false, canSeeFinancialImpact: false,
  },
  HR: {
    modules: ['Resumen','Locaciones','Horarios','Action Center','Proyectos','Configuración'],
    allLocations: true, canManageUsers: false, canManagePlatform: false, canManageIntegrations: false,
    canRunAutomation: false, canUseCopilot: true, canReviewEvidence: false, canEscalateActions: true,
    canVerifyActions: false, canApprovePayments: false, canSeeFinancialImpact: false,
  },
  Administration: {
    modules: ['Resumen','Finanzas','Gastos','Action Center','Proyectos','Pagos','Transferencias','Configuración'],
    allLocations: true, canManageUsers: false, canManagePlatform: false, canManageIntegrations: false,
    canRunAutomation: false, canUseCopilot: true, canReviewEvidence: false, canEscalateActions: true,
    canVerifyActions: true, canApprovePayments: false, canSeeFinancialImpact: true,
  },
  Maintenance: {
    modules: ['Resumen','Locaciones','Tasks','Action Center','Proyectos','Prioridades'],
    allLocations: true, canManageUsers: false, canManagePlatform: false, canManageIntegrations: false,
    canRunAutomation: false, canUseCopilot: true, canReviewEvidence: false, canEscalateActions: true,
    canVerifyActions: true, canApprovePayments: false, canSeeFinancialImpact: false,
  },
};

function cloneUser(user: OpsVistaUser): OpsVistaUser {
  return { ...user, locations:[...user.locations], locationGrants:user.locationGrants?.map(grant=>({...grant})) };
}

let authenticatedUser: OpsVistaUser | null = null;

export function bindAuthenticatedUser(user: OpsVistaUser) {
  authenticatedUser = cloneUser(user);
}

export function currentAuthenticatedUser() {
  if (!authenticatedUser) throw new Error('Authenticated OpsVista user is unavailable');
  return cloneUser(authenticatedUser);
}

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
