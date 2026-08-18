export type EvidenceStatus = 'Pending' | 'Submitted' | 'Approved' | 'Rejected' | 'Resubmitted';

export type EvidenceItem = {
  id: string;
  location: string;
  area: string;
  task: string;
  employee: string;
  submittedAt?: string;
  status: EvidenceStatus;
  photoUrl?: string;
  referencePhotoUrl?: string;
  managerComment?: string;
  previousEvidenceId?: string;
  requiresPhoto: boolean;
};

export const demoEvidence: EvidenceItem[] = [
  {
    id: 'ev-001',
    location: 'Stamford',
    area: 'Kitchen',
    task: 'Walk-in cooler closing cleanliness',
    employee: 'Closing team',
    submittedAt: '2026-08-17 22:41',
    status: 'Rejected',
    managerComment: 'Clean underneath the lower shelving and resubmit a clear photo.',
    requiresPhoto: true,
  },
  {
    id: 'ev-002',
    location: 'Orange',
    area: 'Front of House',
    task: 'Host station closing standard',
    employee: 'Host team',
    submittedAt: '2026-08-17 23:03',
    status: 'Submitted',
    requiresPhoto: true,
  },
];

export function evidenceNeedsAction(item: EvidenceItem) {
  return item.status === 'Rejected' || item.status === 'Pending';
}
