export type BonusMetricKey='tasks'|'discounts'|'voids'|'overtime'|'reviews'|'liquorCost'|'leadership';
export type BonusInputs={
  tasksPct?:number;
  discountsPct?:number;
  voidsPct?:number;
  overtimeLaborPct?:number;
  reviewAverage?:number;
  reviewCount?:number;
  liquorCostScorePct?:number;
  leadershipScorePct?:number;
  logbookComplete?:boolean;
  disciplinaryIssue?:boolean;
};
export type BonusMetricResult={key:BonusMetricKey;label:string;weight:number;value?:number;points?:number;source:string;ready:boolean;note:string};
export type BonusResult={eligible:boolean|null;eligibilityReasons:string[];score:number|null;maxScore:number;metrics:BonusMetricResult[];ready:boolean};

export const bonusPolicy={
  weights:{tasks:35,discounts:20,voids:15,overtime:15,reviews:5,liquorCost:5,leadership:5} as Record<BonusMetricKey,number>,
  requirements:{tasksPct:80,discountsPct:2,voidsPct:0.5,overtimeLaborPct:8,minimumWeeklyReviews:5,leadershipWeeklySummaries:4,logbookComplete:true,noDisciplinaryIssues:true},
};

const clamp=(n:number,min=0,max=1)=>Math.max(min,Math.min(max,n));
const lowerIsBetter=(value:number,target:number)=>clamp(target/Math.max(value,target));
const higherIsBetter=(value:number,target:number)=>clamp(value/target);

/**
 * Google Reviews rewards quality first and volume second. A location must
 * receive at least five reviews in the Wednesday–Tuesday operating week to
 * earn points. Quality represents 80% of the metric and volume 20%, capped at
 * ten weekly reviews. This deliberately makes 5 reviews at 5.0 outperform
 * 7 reviews at 4.5 while still rewarding additional five-star reviews.
 */
export function googleReviewPoints(average:number|undefined,count:number|undefined){
  if(average===undefined||count===undefined||count<bonusPolicy.requirements.minimumWeeklyReviews)return undefined;
  const quality=clamp((average-4)/1);
  const volume=clamp(count/10);
  return bonusPolicy.weights.reviews*(quality*.8+volume*.2);
}

export function calculateWeeklyBonus(input:BonusInputs):BonusResult{
  const w=bonusPolicy.weights;
  const metrics:BonusMetricResult[]=[
    {key:'tasks',label:'Tasks',weight:w.tasks,value:input.tasksPct,points:input.tasksPct===undefined?undefined:w.tasks*higherIsBetter(input.tasksPct,100),source:'7shifts Tasks',ready:input.tasksPct!==undefined,note:'35% of score · eligibility minimum 80%'},
    {key:'discounts',label:'Discounts excl. Uber Eats',weight:w.discounts,value:input.discountsPct,points:input.discountsPct===undefined?undefined:w.discounts*lowerIsBetter(input.discountsPct,2),source:'Toast',ready:input.discountsPct!==undefined,note:'20% of score · Uber Eats promotions excluded · eligibility maximum 2.00%'},
    {key:'voids',label:'Voids',weight:w.voids,value:input.voidsPct,points:input.voidsPct===undefined?undefined:w.voids*lowerIsBetter(input.voidsPct,0.5),source:'Toast',ready:input.voidsPct!==undefined,note:'15% of score · eligibility maximum 0.50%'},
    {key:'overtime',label:'Overtime',weight:w.overtime,value:input.overtimeLaborPct,points:input.overtimeLaborPct===undefined?undefined:w.overtime*lowerIsBetter(input.overtimeLaborPct,8),source:'Toast / Labor',ready:input.overtimeLaborPct!==undefined,note:'15% of score · eligibility maximum 8.00% of labor'},
    {key:'reviews',label:'Google Reviews',weight:w.reviews,value:input.reviewAverage,points:googleReviewPoints(input.reviewAverage,input.reviewCount),source:'Google Business Profile',ready:input.reviewAverage!==undefined&&input.reviewCount!==undefined,note:'5% of score · minimum 5 weekly reviews · quality 80% + volume 20%'},
    {key:'liquorCost',label:'Liquor Cost',weight:w.liquorCost,value:input.liquorCostScorePct,points:input.liquorCostScorePct===undefined?undefined:w.liquorCost*clamp(input.liquorCostScorePct/100),source:'Inventory / R365',ready:input.liquorCostScorePct!==undefined,note:'5% of score · rolling operating performance'},
    {key:'leadership',label:'Logbook / Leadership',weight:w.leadership,value:input.leadershipScorePct,points:input.leadershipScorePct===undefined?undefined:w.leadership*clamp(input.leadershipScorePct/100),source:'7shifts Logbook',ready:input.leadershipScorePct!==undefined&&input.logbookComplete!==undefined,note:'5% of score · 4 verified summaries per operating week · does not block qualification'},
  ];
  // Qualification is decided by the operating gates. Leadership/Logbook
  // contributes points to the ranking, but an incomplete Logbook cannot
  // disqualify a restaurant that passed Tasks, Discounts, Voids and OT.
  const eligibilityKnown=input.tasksPct!==undefined&&input.discountsPct!==undefined&&input.voidsPct!==undefined&&input.overtimeLaborPct!==undefined;
  const reasons:string[]=[];
  if(input.tasksPct!==undefined&&input.tasksPct<80)reasons.push(`Tasks ${input.tasksPct.toFixed(1)}% < 80%`);
  if(input.discountsPct!==undefined&&input.discountsPct>2)reasons.push(`Discounts ${input.discountsPct.toFixed(2)}% > 2.00%`);
  if(input.voidsPct!==undefined&&input.voidsPct>0.5)reasons.push(`Voids ${input.voidsPct.toFixed(2)}% > 0.50%`);
  if(input.overtimeLaborPct!==undefined&&input.overtimeLaborPct>8)reasons.push(`OT ${input.overtimeLaborPct.toFixed(2)}% > 8.00% of labor`);
  if(input.reviewCount!==undefined&&input.reviewCount<bonusPolicy.requirements.minimumWeeklyReviews)reasons.push(`Google Reviews ${input.reviewCount} < ${bonusPolicy.requirements.minimumWeeklyReviews} minimum`);
  if(input.disciplinaryIssue===true)reasons.push('Disciplinary issue present');
  const ready=metrics.every(m=>m.ready);
  const score=ready?metrics.reduce((sum,m)=>sum+(m.points??0),0):null;
  return {eligible:eligibilityKnown?reasons.length===0:null,eligibilityReasons:reasons,score,maxScore:100,metrics,ready};
}
