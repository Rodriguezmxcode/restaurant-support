export type OpsVistaUser={id:string;name:string;email:string;role:string;title:string;locations:string[]};
export type PerformanceLocation={location:string;netSales:number;totalLaborCost:number;totalLaborPct:number;hourlyHours:number;overtimeHours:number};
export type PerformanceResponse={start:string;end:string;source:string;locations:PerformanceLocation[];totals:{netSales:number;totalLaborCost:number;totalLaborPct:number;hourlyHours:number;overtimeHours:number}};
export type ActionRecord={id:string;location:string;category:string;title:string;severity:'High'|'Medium'|'Low';status:string;signal:string;cause:string;recommendation:string;impact:string;ownerId?:string;ownerName?:string;dueAt?:string;priorityScore:number;verificationStatus:string;updatedAt:string};
export type Assignee={id:string;name:string;title:string;role:string;locations:string[]};
export type SuggestedAssignee={id:string;name:string;title:string;reason:string};
export type ActionReceiptEvent={id:string;status:string;at:string;actorName:string;note?:string};
export type ActionNotificationDetail={state:null|{latestStatus:string;recipientName:string;sentAt:string;acceptBy:string;seenAt?:string;acceptedAt?:string};events:ActionReceiptEvent[]};
