import test from 'node:test';
import assert from 'node:assert/strict';
import { overtimePoints, calculateWeeklyBonus } from '../src/bonusEngine.ts';
const baseline={tasksPct:100,discountsPct:1,voidsPct:0.1,reviewAverage:5,reviewCount:10,liquorCostScorePct:100,leadershipScorePct:100,logbookComplete:true};
test('effective week and future weeks reward lower overtime proportionally',()=>{
  for(const period of ['2026-10-28','2026-11-04','2027-01-06']){
    for(const [ot,points] of [[0,15],[2,11.25],[4,7.5],[6,3.75],[8,0],[9,0]]) assert.equal(overtimePoints(ot,period),points);
    for(let ot=0;ot<8;ot+=0.25) assert.ok(overtimePoints(ot,period)>overtimePoints(ot+0.25,period));
  }
});
test('historical and unspecified periods preserve the previous policy',()=>{
  for(const period of [undefined,'2026-10-21','2026-10-27']){
    for(const ot of [0,4,8]) assert.equal(overtimePoints(ot,period),15);
    assert.equal(overtimePoints(9,period),15*(8/9));
  }
});
test('only overtime changes total points; eligibility limit stays above 8%',()=>{
  const old=calculateWeeklyBonus({...baseline,periodStart:'2026-10-21',overtimeLaborPct:4});
  const current=calculateWeeklyBonus({...baseline,periodStart:'2026-10-28',overtimeLaborPct:4});
  assert.equal(old.score,100);assert.equal(current.score,92.5);
  assert.deepEqual(old.metrics.filter(m=>m.key!=='overtime'),current.metrics.filter(m=>m.key!=='overtime'));
  assert.equal(calculateWeeklyBonus({...baseline,periodStart:'2026-10-28',overtimeLaborPct:8}).eligible,true);
  assert.equal(calculateWeeklyBonus({...baseline,periodStart:'2026-10-28',overtimeLaborPct:8.01}).eligible,false);
});
test('missing or invalid overtime cannot earn points or confirm eligibility',()=>{
  for(const ot of [undefined,NaN,Infinity,-1]){
    const result=calculateWeeklyBonus({...baseline,periodStart:'2026-10-28',overtimeLaborPct:ot});
    assert.equal(result.eligible,null);assert.equal(result.ready,false);assert.equal(result.score,null);
    assert.equal(result.metrics.find(m=>m.key==='overtime').points,undefined);
  }
});
