import type { VerificationStatus } from './verificationLoop';

export type ActionSeverity='High'|'Medium'|'Low';
export type ActionStatus='Open'|'Assigned'|'Investigating'|'Completed'|'Dismissed';
export type ActionRecord={
  id:string;location:string;category:string;title:string;severity:ActionSeverity;status:ActionStatus;signal:string;cause:string;
  recommendation:string;impact:string;ownerId?:string;ownerName?:string;dueAt?:string;automationKey?:string;automated:boolean;
  priorityScore:number;sources:string[];sourceIds:string[];detectedAt?:string;verificationStatus:VerificationStatus;
  verificationNote?:string;verifiedAt?:string;createdAt:string;updatedAt:string;
};
export type ExternalEscalation={location:string;title:string;signal:string;cause:string;recommendation:string;impact:string;severity:ActionSeverity;automationKey?:string;priorityScore?:number;sources?:string[];sourceIds?:string[];detectedAt?:string};
