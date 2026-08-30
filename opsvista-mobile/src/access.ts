import type { OpsVistaRole } from './types';

const allLocations = ['Stamford', 'Orange', 'Fairfield', 'Danbury', 'Avon', 'Southington'];

const mobileModules: Record<OpsVistaRole, string[]> = {
  Founder: ['Resumen', 'Locaciones', 'Ventas', 'Tasks', 'Bono semanal', 'Action Center', 'Proyectos', 'Gastos Ramp', 'Pagos', 'Transferencias'],
  Corporate: ['Resumen', 'Locaciones', 'Ventas', 'Tasks', 'Bono semanal', 'Action Center', 'Proyectos', 'Gastos Ramp', 'Pagos', 'Transferencias'],
  'Location Manager': ['Resumen', 'Locaciones', 'Ventas', 'Tasks', 'Bono semanal', 'Action Center', 'Proyectos', 'Pagos', 'Transferencias'],
  Kitchen: ['Resumen', 'Locaciones', 'Tasks', 'Bono semanal', 'Action Center', 'Proyectos', 'Transferencias'],
  HR: ['Resumen', 'Locaciones', 'Horarios', 'Action Center', 'Proyectos'],
  Administration: ['Resumen', 'Finanzas', 'Gastos Ramp', 'Action Center', 'Proyectos', 'Pagos', 'Transferencias'],
  Maintenance: ['Resumen', 'Locaciones', 'Tasks', 'Action Center', 'Proyectos', 'Prioridades'],
};

export function availableLocations(role: OpsVistaRole, locations: string[]) {
  return ['Founder', 'Corporate', 'HR', 'Administration', 'Maintenance'].includes(role)
    ? allLocations
    : allLocations.filter(location => locations.includes(location));
}

export function availableModules(role: OpsVistaRole) {
  return mobileModules[role];
}

export function canVerifyActions(role: OpsVistaRole) {
  return role !== 'HR';
}
