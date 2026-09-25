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

export function evidenceNeedsAction(item: EvidenceItem) {
  return item.status === 'Rejected' || item.status === 'Pending' || item.status === 'Resubmitted';
}

export function evidenceIsOverdue(item: EvidenceItem, clock = new Date().toISOString()) {
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
