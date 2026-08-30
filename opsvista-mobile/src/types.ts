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

export type SevenShiftsTaskLocation = {
  locationId?: number;
  locationName: string;
  completed: number;
  total: number;
  incomplete: number;
  completionPct: number | null;
  detailAvailable?: boolean;
};

export type LogbookEntry = {
  id: number;
  date: string;
  locationName: string;
  author: string;
  category: string;
  message: string;
  attachments: number;
};

export type TasksWeeklyResponse = {
  source: string;
  start: string;
  end: string;
  operationalWeek?: string;
  total: number;
  completed: number;
  incomplete: number;
  completionPct: number | null;
  detailAvailable?: boolean;
  locations: SevenShiftsTaskLocation[];
  logbook: LogbookEntry[];
  logbookComplete: boolean;
  logbookError?: string;
  adapterVersion?: string;
  taskSource?: string;
};

export type ActionSeverity = 'High' | 'Medium' | 'Low';
export type ActionStatus = 'Open' | 'Assigned' | 'Investigating' | 'Completed' | 'Dismissed';
export type ActionVerificationStatus = 'Pending' | 'Worked' | 'Did not work' | 'Not enough evidence yet';

export type ActionRecord = {
  id: string;
  location: string;
  category: string;
  title: string;
  severity: ActionSeverity;
  status: ActionStatus;
  signal: string;
  cause: string;
  recommendation: string;
  impact: string;
  ownerId?: string;
  ownerName?: string;
  dueAt?: string;
  automated: boolean;
  priorityScore: number;
  sources: string[];
  sourceIds: string[];
  detectedAt?: string;
  verificationStatus: ActionVerificationStatus;
  verificationNote?: string;
  verifiedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ActionPatch = Partial<Pick<ActionRecord,
  'status' | 'ownerId' | 'ownerName' | 'dueAt' | 'verificationStatus' | 'verificationNote' | 'verifiedAt'
>>;

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
