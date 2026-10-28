import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateWeeklyBonus, overtimePoints } from '../src/bonusEngine.ts';
test('OT points decrease continuously and preserve the eligibility threshold', () => {
  assert.equal(overtimePoints(0),15);
  assert.equal(overtimePoints(4),7.5);
  assert.equal(overtimePoints(8),0);
  assert.equal(overtimePoints(9),0);
  for(const value of [undefined,NaN,Infinity,-1]) assert.equal(overtimePoints(value),undefined);
  let previous=16;
  for(let i=0;i<=800;i++){const points=overtimePoints(i/100);assert(points<previous);previous=points;}
  const base={tasksPct:100,discountsPct:1,voidsPct:0.1,reviewAverage:5,reviewCount:10};
  assert.equal(calculateWeeklyBonus({...base,overtimeLaborPct:8}).eligible,true);
  assert.equal(calculateWeeklyBonus({...base,overtimeLaborPct:8.01}).eligible,false);
  assert.equal(calculateWeeklyBonus({...base,overtimeLaborPct:NaN}).eligible,null);
});
test('screenshot values produce the expected OT points and overall ranking', () => {
  const inputs = [
    ['Avon',98.8,4.98,7.99,5],['Fairfield',93.2,4.96,3.15,4],
    ['Danbury',96.2,4.86,1.5,3],['Southington',96.6,4.97,0.08,2],
    ['Orange',99,4.9,3.42,1],['Stamford',94.5,5,0.43,0],
  ];
  const totals=inputs.map(([name,tasksPct,reviewAverage,overtimeLaborPct,beverage])=>{
    const result=calculateWeeklyBonus({tasksPct,reviewAverage,overtimeLaborPct,reviewCount:21,
      discountsPct:1,voidsPct:0.3,leadershipScorePct:100,logbookComplete:true,liquorCostScorePct:beverage*20});
    assert.equal(result.maxScore,100);assert.equal(result.ready,true);
    return {name,score:result.score};
  }).sort((a,b)=>b.score-a.score);
  assert.deepEqual(totals.map(r=>r.name),['Southington','Danbury','Stamford','Fairfield','Orange','Avon']);
  assert.deepEqual(totals.map(r=>Math.round((r.score+1e-9)*100)/100),[95.54,93.3,92.27,90.55,88.84,84.52]);
});
