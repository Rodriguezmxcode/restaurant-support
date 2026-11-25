import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateWeeklyBonus,discountVoidPoints} from '../src/bonusEngine.ts';
const baseline={periodStart:'2026-10-28',tasksPct:100,discountsPct:0,voidsPct:0,overtimeLaborPct:0,reviewAverage:5,reviewCount:10,liquorCostScorePct:100,leadershipScorePct:100,logbookComplete:true};
test('each metric declines proportionally up to its exact limit and stays at zero above it',()=>{
 for(const [key,limit,weight] of [['discounts',2,20],['voids',.5,15]]){
  for(const date of ['2026-10-28','2026-11-04'])for(const fraction of [0,.25,.5,.75,1,1.01])assert.ok(Math.abs(discountVoidPoints(key,limit*fraction,date)-weight*Math.max(0,1-fraction))<1e-9);
  for(const date of [undefined,'2026-10-21'])assert.equal(discountVoidPoints(key,limit*.5,date),weight);
  for(const invalid of [undefined,NaN,Infinity,-1])assert.equal(discountVoidPoints(key,invalid,baseline.periodStart),undefined);
 }
});
test('exact limits qualify with zero points; above either limit disqualifies',()=>{
 for(const [field,key,limit] of [['discountsPct','discounts',2],['voidsPct','voids',.5]]){
  const at=calculateWeeklyBonus({...baseline,[field]:limit});
  assert.equal(at.eligible,true);assert.equal(at.metrics.find(m=>m.key===key).points,0);
  assert.equal(calculateWeeklyBonus({...baseline,[field]:limit+.001}).eligible,false);
 }
});
test('total ranking reflects both metrics without altering other components',()=>{
 const perfect=calculateWeeklyBonus(baseline), half=calculateWeeklyBonus({...baseline,discountsPct:1,voidsPct:.25});
 assert.equal(perfect.score,100);assert.equal(half.score,82.5);
 assert.deepEqual(perfect.metrics.filter(m=>!['discounts','voids'].includes(m.key)),half.metrics.filter(m=>!['discounts','voids'].includes(m.key)));
 assert.equal(calculateWeeklyBonus({...baseline,periodStart:'2026-10-21',discountsPct:1,voidsPct:.25}).score,100);
});
