import type { VerificationStatus } from './verificationLoop';

export type ActionSeverity='High'|'Medium'|'Low';
export type ActionStatus='Open'|'Assigned'|'Investigating'|'Completed'|'Dismissed';
export type ActionRecord={
  id:string;location:string;category:string;title:string;severity:ActionSeverity;status:ActionStatus;signal:string;cause:string;
  recommendation:string;impact:string;ownerId?:string;ownerName?:string;accountableName?:string;accountableRole?:string;dueAt?:string;automationKey?:string;automated:boolean;
  priorityScore:number;sources:string[];sourceIds:string[];sourceUrl?:string;detectedAt?:string;verificationStatus:VerificationStatus;
  verificationNote?:string;verifiedAt?:string;createdAt:string;updatedAt:string;
};
export type ActionReceiptStatus='Sent'|'Push accepted'|'Delivered'|'Seen'|'Accepted'|'In progress'|'Evidence submitted'|'Verified'|'Escalated';
export type ActionNotificationState={actionId:string;recipientId:string;recipientName:string;latestStatus:ActionReceiptStatus;sentAt:string;acceptBy:string;deliveredAt?:string;seenAt?:string;acceptedAt?:string;updatedAt:string};
export type ActionReceiptEvent={id:string;actionId:string;recipientId:string;recipientName:string;status:ActionReceiptStatus;at:string;actorId:string;actorName:string;note?:string};
export type ActionNotificationDetail={state:ActionNotificationState|null;events:ActionReceiptEvent[]};
export type ExternalEscalation={location:string;category?:string;title:string;signal:string;cause:string;recommendation:string;impact:string;severity:ActionSeverity;ownerId?:string;ownerName?:string;accountableName?:string;accountableRole?:string;dueAt?:string;automationKey?:string;priorityScore?:number;sources?:string[];sourceIds?:string[];sourceUrl?:string;detectedAt?:string};
