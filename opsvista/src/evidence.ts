export type EvidenceStatus = 'Pending' | 'Submitted' | 'Approved' | 'Rejected' | 'Resubmitted';

export type EvidenceAuditEvent = {
  id: string;
  at: string;
  actor: string;
  action: 'Created' | 'Submitted' | 'Approved' | 'Rejected' | 'Resubmitted' | 'Escalated';
  comment?: string;
};

export type EvidenceItem = {
  id: string;
  location: string;
  area: string;
  shift: 'Opening' | 'Mid' | 'Closing';
  task: string;
  employee: string;
  reviewer?: string;
  dueAt: string;
  submittedAt?: string;
  reviewedAt?: string;
  status: EvidenceStatus;
  photoUrl?: string;
  referencePhotoUrl?: string;
  beforePhotoUrl?: string;
  previousPhotoUrl?: string;
  managerComment?: string;
  rejectionReason?: string;
  previousEvidenceId?: string;
  requiresPhoto: boolean;
  resubmissionCount: number;
  auditTrail: EvidenceAuditEvent[];
};

const now = '2026-08-18T12:45:00-06:00';

export const demoEvidence: EvidenceItem[] = [
  {
    id: 'ev-001',
    location: 'Stamford',
    area: 'Kitchen',
    shift: 'Closing',
    task: 'Walk-in cooler closing cleanliness',
    employee: 'Closing team',
    reviewer: 'Juan Zuleta',
    dueAt: '2026-08-17T23:30:00-04:00',
    submittedAt: '2026-08-17T22:41:00-04:00',
    reviewedAt: '2026-08-17T23:02:00-04:00',
    status: 'Rejected',
    managerComment: 'Clean underneath the lower shelving and resubmit a clear photo.',
    rejectionReason: 'Area still visibly dirty / evidence does not meet standard',
    referencePhotoUrl: 'reference://walk-in-clean-standard',
    photoUrl: 'evidence://stamford-walkin-before',
    beforePhotoUrl: 'evidence://stamford-walkin-before',
    requiresPhoto: true,
    resubmissionCount: 0,
    auditTrail: [
      { id: 'a-001', at: '2026-08-17T18:00:00-04:00', actor: 'OpsVista', action: 'Created' },
      { id: 'a-002', at: '2026-08-17T22:41:00-04:00', actor: 'Closing team', action: 'Submitted' },
      { id: 'a-003', at: '2026-08-17T23:02:00-04:00', actor: 'Juan Zuleta', action: 'Rejected', comment: 'Clean underneath the lower shelving and resubmit a clear photo.' },
    ],
  },
  {
    id: 'ev-002',
    location: 'Orange',
    area: 'Front of House',
    shift: 'Closing',
    task: 'Host station closing standard',
    employee: 'Host team',
    dueAt: '2026-08-18T00:00:00-04:00',
    submittedAt: '2026-08-17T23:03:00-04:00',
    status: 'Submitted',
    referencePhotoUrl: 'reference://host-station-standard',
    photoUrl: 'evidence://orange-host-station',
    requiresPhoto: true,
    resubmissionCount: 0,
    auditTrail: [
      { id: 'a-004', at: '2026-08-17T18:00:00-04:00', actor: 'OpsVista', action: 'Created' },
      { id: 'a-005', at: '2026-08-17T23:03:00-04:00', actor: 'Host team', action: 'Submitted' },
    ],
  },
  {
    id: 'ev-003',
    location: 'Fairfield',
    area: 'Front of House',
    shift: 'Closing',
    task: 'Restroom closing inspection',
    employee: 'Closing server',
    reviewer: 'Michael Monsalve',
    dueAt: '2026-08-17T23:45:00-04:00',
    submittedAt: '2026-08-17T23:16:00-04:00',
    reviewedAt: '2026-08-17T23:22:00-04:00',
    status: 'Approved',
    managerComment: 'Evidence accepted. Standard met.',
    referencePhotoUrl: 'reference://restroom-standard',
    photoUrl: 'evidence://fairfield-restroom',
    requiresPhoto: true,
    resubmissionCount: 0,
    auditTrail: [
      { id: 'a-006', at: '2026-08-17T18:00:00-04:00', actor: 'OpsVista', action: 'Created' },
      { id: 'a-007', at: '2026-08-17T23:16:00-04:00', actor: 'Closing server', action: 'Submitted' },
      { id: 'a-008', at: '2026-08-17T23:22:00-04:00', actor: 'Michael Monsalve', action: 'Approved', comment: 'Evidence accepted. Standard met.' },
    ],
  },
  {
    id: 'ev-004',
    location: 'Danbury',
    area: 'Kitchen',
    shift: 'Opening',
    task: 'Line opening cleanliness and setup',
    employee: 'Opening cook',
    dueAt: '2026-08-18T10:30:00-04:00',
    status: 'Pending',
    referencePhotoUrl: 'reference://line-opening-standard',
    requiresPhoto: true,
    resubmissionCount: 0,
    auditTrail: [
      { id: 'a-009', at: '2026-08-18T08:00:00-04:00', actor: 'OpsVista', action: 'Created' },
    ],
  },
  {
    id: 'ev-005',
    location: 'Stamford',
    area: 'Bar',
    shift: 'Closing',
    task: 'Bar closing bottle and sanitation setup',
    employee: 'Bar team',
    reviewer: 'Juan Delgado',
    dueAt: '2026-08-17T23:45:00-04:00',
    submittedAt: '2026-08-17T23:18:00-04:00',
    reviewedAt: '2026-08-17T23:31:00-04:00',
    status: 'Resubmitted',
    managerComment: 'First submission rejected. New photo received and awaiting final review.',
    rejectionReason: 'Sanitation bottles were not labeled and counter was incomplete',
    previousPhotoUrl: 'evidence://stamford-bar-first',
    photoUrl: 'evidence://stamford-bar-resubmission',
    referencePhotoUrl: 'reference://bar-closing-standard',
    requiresPhoto: true,
    resubmissionCount: 1,
    auditTrail: [
      { id: 'a-010', at: '2026-08-17T18:00:00-04:00', actor: 'OpsVista', action: 'Created' },
      { id: 'a-011', at: '2026-08-17T22:52:00-04:00', actor: 'Bar team', action: 'Submitted' },
      { id: 'a-012', at: '2026-08-17T23:01:00-04:00', actor: 'Juan Delgado', action: 'Rejected', comment: 'Label sanitation bottles and finish the counter setup.' },
      { id: 'a-013', at: '2026-08-17T23:18:00-04:00', actor: 'Bar team', action: 'Resubmitted' },
    ],
  },
];

export function evidenceNeedsAction(item: EvidenceItem) {
  return item.status === 'Rejected' || item.status === 'Pending' || item.status === 'Resubmitted';
}

export function evidenceIsOverdue(item: EvidenceItem, clock = now) {
  if (item.status === 'Approved') return false;
  return new Date(item.dueAt).getTime() < new Date(clock).getTime();
}

export function evidenceSummary(items: EvidenceItem[]) {
  const approved = items.filter(item => item.status === 'Approved').length;
  const submitted = items.filter(item => item.status === 'Submitted' || item.status === 'Resubmitted').length;
  const rejected = items.filter(item => item.status === 'Rejected').length;
  const pending = items.filter(item => item.status === 'Pending').length;
  const overdue = items.filter(item => evidenceIsOverdue(item)).length;
  const reviewed = items.filter(item => item.reviewedAt).length;
  const approvalRate = reviewed ? Math.round((approved / reviewed) * 100) : 100;

  return { total: items.length, approved, submitted, rejected, pending, overdue, approvalRate };
}

export function addAuditEvent(item: EvidenceItem, event: EvidenceAuditEvent): EvidenceItem {
  return { ...item, auditTrail: [...item.auditTrail, event] };
}
