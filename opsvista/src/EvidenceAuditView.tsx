import { useMemo, useState } from 'react';
import SevenShiftsTasksPanel from './SevenShiftsTasksPanel';
import {
  addAuditEvent,
  evidenceIsOverdue,
  evidenceSummary,
  type EvidenceItem,
} from './evidence';
import './evidenceAudit.css';

type Escalation = {
  location: string;
  title: string;
  signal: string;
  cause: string;
  recommendation: string;
  impact: string;
  severity: 'High' | 'Medium' | 'Low';
};

type Props = {
  onEscalate?: (item: Escalation) => void;
  allowedLocations?: string[];
  canReview?: boolean;
  reviewerName?: string;
  initialSearch?: string;
  initialRecordId?: string;
  initialLocation?: string;
  initialDate?: string;
};

const dt = (value?: string) => value ? new Date(value).toLocaleString() : '—';

function EvidenceVisual({ label, variant }: { label: string; variant: 'reference' | 'current' | 'previous' }) {
  return <div className={`evidence-visual ${variant}`}>
    <div className="evidence-visual-icon">▧</div>
    <strong>{label}</strong>
    <span>{variant === 'reference' ? 'Required standard' : variant === 'previous' ? 'Previous submission' : 'Submitted evidence'}</span>
  </div>;
}

export default function EvidenceAuditView({ onEscalate, allowedLocations, canReview = true, reviewerName = 'Authorized Review', initialSearch, initialRecordId, initialLocation, initialDate }: Props) {
  const [items, setItems] = useState<EvidenceItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [status, setStatus] = useState('Needs review');
  const [location, setLocation] = useState('All locations');
  const [comment, setComment] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [escalated, setEscalated] = useState<string[]>([]);

  const selected = items.find(item => item.id === selectedId) ?? items[0];
  const summary = useMemo(() => evidenceSummary(items), [items]);
  const locations = useMemo(() => ['All locations', ...Array.from(new Set(items.map(item => item.location)))], [items]);

  const filtered = items.filter(item => {
    const locationMatch = location === 'All locations' || item.location === location;
    const statusMatch = status === 'All'
      || (status === 'Needs review' && ['Submitted', 'Resubmitted'].includes(item.status))
      || (status === 'Needs correction' && item.status === 'Rejected')
      || (status === 'Overdue' && evidenceIsOverdue(item))
      || item.status === status;
    return locationMatch && statusMatch;
  });

  const approve = () => {
    if (!selected || !canReview) return;
    const at = new Date().toISOString();
    const updated = addAuditEvent({ ...selected, status: 'Approved', reviewer: reviewerName, reviewedAt: at, managerComment: comment || 'Evidence accepted. Standard met.' }, {
      id: `audit-${Date.now()}`,
      at,
      actor: reviewerName,
      action: 'Approved',
      comment: comment || 'Evidence accepted. Standard met.',
    });
    setItems(rows => rows.map(row => row.id === selected.id ? updated : row));
    setComment('');
    setRejectionReason('');
  };

  const reject = () => {
    if (!selected || !canReview || !rejectionReason.trim() || !comment.trim()) return;
    const at = new Date().toISOString();
    const updated = addAuditEvent({ ...selected, status: 'Rejected', reviewer: reviewerName, reviewedAt: at, managerComment: comment, rejectionReason }, {
      id: `audit-${Date.now()}`,
      at,
      actor: reviewerName,
      action: 'Rejected',
      comment,
    });
    setItems(rows => rows.map(row => row.id === selected.id ? updated : row));
    setComment('');
    setRejectionReason('');
  };

  const escalate = () => {
    if (!selected) return;
    onEscalate?.({
      location: selected.location,
      title: `${selected.task} evidence requires follow-up`,
      signal: `${selected.location} · ${selected.area} · ${selected.status}${evidenceIsOverdue(selected) ? ' · overdue' : ''}.`,
      cause: selected.rejectionReason || selected.managerComment || 'Required photo evidence has not been approved.',
      recommendation: selected.status === 'Rejected'
        ? 'Assign the responsible team to correct the issue, resubmit clear evidence, and require manager verification before closing.'
        : 'Review the submitted evidence and close the verification loop with an explicit approve or reject decision.',
      impact: `${selected.task} remains unverified`,
      severity: evidenceIsOverdue(selected) || selected.status === 'Rejected' ? 'High' : 'Medium',
    });
    setEscalated(ids => ids.includes(selected.id) ? ids : [...ids, selected.id]);
  };

  if (!items.length) return <div className="evidence-page">
    <SevenShiftsTasksPanel allowedLocations={allowedLocations} initialSearch={initialSearch} initialRecordId={initialRecordId} initialLocation={initialLocation} initialDate={initialDate}/>
    <section className="panel">
      <div className="panel-header"><div><h2>Evidence Audit</h2><p>La cola se activará cuando la fuente de fotos y evidencia real esté conectada.</p></div><span className="count-pill">FUENTE PENDIENTE</span></div>
      <div style={{padding:18}}><div className="detail-block"><label>ESTADO DE LA FUENTE</label><p>No hay evidencia recibida. OpsVista no mostrará envíos, fotos ni decisiones de prueba.</p></div></div>
    </section>
  </div>;

  return <div className="evidence-page">
    <SevenShiftsTasksPanel allowedLocations={allowedLocations} initialSearch={initialSearch} initialRecordId={initialRecordId} initialLocation={initialLocation} initialDate={initialDate}/>
    <section className="evidence-summary-grid">
      <article className="evidence-summary-card hero"><span>EVIDENCE APPROVAL RATE</span><strong>{summary.approvalRate}%</strong><p>Approved across reviewed submissions</p></article>
      <article className="evidence-summary-card"><span>NEEDS REVIEW</span><strong>{summary.submitted}</strong><p>Submitted or resubmitted</p></article>
      <article className="evidence-summary-card danger"><span>REJECTED</span><strong>{summary.rejected}</strong><p>Correction required</p></article>
      <article className="evidence-summary-card"><span>OVERDUE</span><strong>{summary.overdue}</strong><p>Past required completion time</p></article>
      <article className="evidence-summary-card"><span>PENDING</span><strong>{summary.pending}</strong><p>No evidence submitted yet</p></article>
    </section>

    <section className="evidence-guardrail">
      <div><strong>Evidence is verification, not surveillance.</strong><span>OpsVista records what was submitted and the reviewer decision. It should never accuse an employee of misconduct automatically.</span></div>
      <div><span>Photo proof</span><span>Human review</span><span>Correction loop</span><span>Audit history</span></div>
    </section>

    <div className="evidence-workspace">
      <section className="evidence-queue panel">
        <div className="evidence-panel-head">
          <div><h2>Evidence Review Queue</h2><p>Review only what requires a decision or correction.</p></div>
          <span className="count-pill">{filtered.length}</span>
        </div>
        <div className="evidence-filters">
          <select value={location} onChange={e => setLocation(e.target.value)}>{locations.map(option => <option key={option}>{option}</option>)}</select>
          <select value={status} onChange={e => setStatus(e.target.value)}><option>Needs review</option><option>Needs correction</option><option>Overdue</option><option>All</option><option>Pending</option><option>Submitted</option><option>Resubmitted</option><option>Approved</option><option>Rejected</option></select>
        </div>
        <div className="evidence-list">{filtered.map(item => <button key={item.id} className={`evidence-row ${item.id === selected?.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}>
          <div className={`evidence-status-icon ${item.status.toLowerCase()}`}>{item.status === 'Approved' ? '✓' : item.status === 'Rejected' ? '!' : item.status === 'Pending' ? '○' : '•'}</div>
          <div><div className="evidence-row-meta"><span>{item.location}</span><span>•</span><span>{item.area}</span><span>•</span><span>{item.shift}</span></div><strong>{item.task}</strong><p>{item.employee} · Due {dt(item.dueAt)}</p><div className="evidence-row-footer"><span className={`evidence-status ${item.status.toLowerCase()}`}>{item.status}</span>{evidenceIsOverdue(item) && <span className="evidence-overdue">OVERDUE</span>}{item.resubmissionCount > 0 && <span>{item.resubmissionCount} resubmission</span>}</div></div>
        </button>)}</div>
      </section>

      {selected && <section className="evidence-review panel">
        <div className="evidence-review-head"><div><span>EVIDENCE REVIEW</span><h2>{selected.task}</h2><p>{selected.location} · {selected.area} · {selected.shift}</p></div><span className={`evidence-status large ${selected.status.toLowerCase()}`}>{selected.status}</span></div>

        <div className="evidence-detail-grid">
          <div><label>Submitted by</label><strong>{selected.employee}</strong></div><div><label>Due</label><strong>{dt(selected.dueAt)}</strong></div><div><label>Submitted</label><strong>{dt(selected.submittedAt)}</strong></div><div><label>Reviewer</label><strong>{selected.reviewer || 'Awaiting review'}</strong></div>
        </div>

        <div className="evidence-comparison">
          <EvidenceVisual label="Reference standard" variant="reference" />
          {selected.previousPhotoUrl && <EvidenceVisual label="Before correction" variant="previous" />}
          <EvidenceVisual label={selected.photoUrl ? 'Current submission' : 'No evidence submitted'} variant="current" />
        </div>

        {(selected.rejectionReason || selected.managerComment) && <div className="evidence-feedback"><label>PREVIOUS REVIEW</label>{selected.rejectionReason && <strong>{selected.rejectionReason}</strong>}<p>{selected.managerComment}</p></div>}

        {['Submitted', 'Resubmitted'].includes(selected.status) && canReview && <div className="evidence-decision">
          <label>REVIEW DECISION</label>
          <select value={rejectionReason} onChange={e => setRejectionReason(e.target.value)}><option value="">Rejection reason (required only if rejecting)</option><option>Evidence does not clearly show completion</option><option>Area still does not meet cleanliness standard</option><option>Setup is incomplete</option><option>Wrong area / wrong task evidence</option><option>Photo is too dark or unclear</option><option>Other operational standard not met</option></select>
          <textarea value={comment} onChange={e => setComment(e.target.value)} placeholder="Manager review comment..." rows={3}/>
          <div className="evidence-decision-actions"><button className="approve" onClick={approve}>✓ Approve evidence</button><button className="reject" disabled={!rejectionReason.trim() || !comment.trim()} onClick={reject}>✕ Reject & request correction</button></div>
        </div>}

        {['Submitted', 'Resubmitted'].includes(selected.status) && !canReview && <div className="evidence-feedback"><label>READ ONLY</label><p>Your role can view this evidence but cannot approve or reject it.</p></div>}
        {selected.status === 'Rejected' && canReview && <div className="evidence-correction-box"><strong>Correction required</strong><p>The task remains open until a real resubmission is received from the originating evidence system and approved.</p></div>}

        {selected.status !== 'Approved' && <button className="evidence-escalate" disabled={escalated.includes(selected.id)} onClick={escalate}>{escalated.includes(selected.id) ? 'Added to Action Center' : 'Send to Action Center'}</button>}

        <div className="evidence-history"><div className="evidence-history-head"><strong>Audit history</strong><span>{selected.auditTrail.length} events</span></div>{selected.auditTrail.slice().reverse().map(event => <div className="evidence-history-row" key={event.id}><div className="history-dot"></div><div><strong>{event.action}</strong><span>{event.actor} · {dt(event.at)}</span>{event.comment && <p>{event.comment}</p>}</div></div>)}</div>
      </section>}
    </div>
  </div>;
}
