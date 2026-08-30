export type OpsVistaRole =
  | 'Founder'
  | 'Corporate'
  | 'Location Manager'
  | 'Kitchen'
  | 'HR'
  | 'Administration'
  | 'Maintenance';

export type OpsVistaUser = {
  id: string;
  name: string;
  email: string;
  role: OpsVistaRole;
  title: string;
  locations: string[];
  organizationId?: string;
  organizationName?: string;
};

export type PerformanceLocation = {
  location: string;
  netSales: number;
  discountAmount: number;
  discountPct: number;
  voidAmount: number;
  voidPct: number;
  hourlyHours: number;
  overtimeHours: number;
  hourlyLaborCost: number;
  salaryLaborCost: number;
  totalLaborCost: number;
  hourlyLaborPct: number;
  salaryLaborPct: number;
  totalLaborPct: number;
  splh: number | null;
};

export type TaskLocation = {
  location: string;
  completed: number;
  total: number;
  compliancePct: number;
};

export type PerformanceResponse = {
  source: string;
  start: string;
  end: string;
  salaryLaborConfigured: boolean;
  locations: PerformanceLocation[];
  totals: Omit<PerformanceLocation, 'location'>;
  taskCompliance?: {
    source: string;
    totals: { completed: number; total: number; compliancePct: number };
    locations: TaskLocation[];
  } | null;
  taskComplianceError?: string;
  notes?: { salaryLabor?: string; tasks?: string; overtime?: string };
};

export type ServerSessionResponse = {
  authenticated: boolean;
  user: OpsVistaUser;
  token: string;
};
