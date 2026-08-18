export type OpsVistaRole = 'Corporate' | 'Location Manager' | 'Kitchen' | 'HR' | 'Administration' | 'Maintenance';

export type OpsVistaModule =
  | 'Resumen' | 'Locaciones' | 'Ventas' | 'Local Intelligence' | 'Finanzas' | 'Gastos'
  | 'Horarios' | 'Tasks' | 'Action Center' | 'Prioridades' | 'Pagos' | 'Transferencias' | 'Configuración';

export type PermissionSet = {
  modules: OpsVistaModule[];
  allLocations: boolean;
  canManageUsers: boolean;
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
  role: OpsVistaRole;
  title: string;
  locations: string[];
  active: boolean;
};

export const rolePermissions: Record<OpsVistaRole, PermissionSet> = {
  Corporate: {
    modules: ['Resumen','Locaciones','Ventas','Local Intelligence','Finanzas','Gastos','Horarios','Tasks','Action Center','Prioridades','Pagos','Transferencias','Configuración'],
    allLocations: true, canManageUsers: true, canRunAutomation: true, canUseCopilot: true,
    canReviewEvidence: true, canEscalateActions: true, canVerifyActions: true,
    canApprovePayments: true, canSeeFinancialImpact: true,
  },
  'Location Manager': {
    modules: ['Resumen','Locaciones','Ventas','Local Intelligence','Gastos','Horarios','Tasks','Action Center','Prioridades','Transferencias'],
    allLocations: false, canManageUsers: false, canRunAutomation: false, canUseCopilot: true,
    canReviewEvidence: true, canEscalateActions: true, canVerifyActions: true,
    canApprovePayments: false, canSeeFinancialImpact: true,
  },
  Kitchen: {
    modules: ['Resumen','Locaciones','Tasks','Action Center','Prioridades','Transferencias'],
    allLocations: false, canManageUsers: false, canRunAutomation: false, canUseCopilot: true,
    canReviewEvidence: true, canEscalateActions: true, canVerifyActions: true,
    canApprovePayments: false, canSeeFinancialImpact: false,
  },
  HR: {
    modules: ['Resumen','Locaciones','Horarios','Action Center','Configuración'],
    allLocations: true, canManageUsers: false, canRunAutomation: false, canUseCopilot: true,
    canReviewEvidence: false, canEscalateActions: true, canVerifyActions: false,
    canApprovePayments: false, canSeeFinancialImpact: false,
  },
  Administration: {
    modules: ['Resumen','Finanzas','Gastos','Action Center','Pagos','Transferencias','Configuración'],
    allLocations: true, canManageUsers: false, canRunAutomation: false, canUseCopilot: true,
    canReviewEvidence: false, canEscalateActions: true, canVerifyActions: true,
    canApprovePayments: true, canSeeFinancialImpact: true,
  },
  Maintenance: {
    modules: ['Resumen','Locaciones','Tasks','Action Center','Prioridades'],
    allLocations: true, canManageUsers: false, canRunAutomation: false, canUseCopilot: true,
    canReviewEvidence: false, canEscalateActions: true, canVerifyActions: true,
    canApprovePayments: false, canSeeFinancialImpact: false,
  },
};

export const demoUsers: OpsVistaUser[] = [
  { id:'usr-corp', name:'Roberto Rodríguez', role:'Corporate', title:'Operaciones corporativas', locations:[], active:true },
  { id:'usr-manager', name:'Location Manager', role:'Location Manager', title:'Restaurant Manager', locations:['Orange'], active:true },
  { id:'usr-kitchen', name:'Kitchen Operations', role:'Kitchen', title:'Kitchen Operations', locations:['Orange','Stamford'], active:true },
  { id:'usr-hr', name:'HR & Payroll', role:'HR', title:'Human Resources', locations:[], active:true },
  { id:'usr-admin', name:'Administration', role:'Administration', title:'Administration', locations:[], active:true },
  { id:'usr-maint', name:'Maintenance', role:'Maintenance', title:'Maintenance', locations:[], active:true },
];

export function permissionsFor(user: OpsVistaUser) { return rolePermissions[user.role]; }
export function canAccessModule(user: OpsVistaUser, module: string) { return permissionsFor(user).modules.includes(module as OpsVistaModule); }
export function canAccessLocation(user: OpsVistaUser, location: string) {
  return permissionsFor(user).allLocations || user.locations.includes(location);
}
export function visibleLocations(user: OpsVistaUser, allLocations: string[]) {
  return permissionsFor(user).allLocations ? allLocations : allLocations.filter(location => user.locations.includes(location));
}
export function scopeRows<T extends { location: string }>(user: OpsVistaUser, rows: T[]) {
  return rows.filter(row => canAccessLocation(user, row.location));
}
