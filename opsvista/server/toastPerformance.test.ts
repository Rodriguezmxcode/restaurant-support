import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmployeeMealDiscount, summarizeOrders } from './toastPerformance.js';

test('employee meal names allow formatting variants without excluding unrelated discounts',()=>{
  for(const name of ['Employee Meal Discounts','EMPLOYEE MEAL 50%','employee-meal','Employee_Meals','Staff Meal','Emp Meal','Comida de empleados','Comida del personal','EmployeeMealDiscount'])assert.equal(isEmployeeMealDiscount({name}),true,name);
  for(const name of ['Employee Discount','Customer Meal','Kids Meal','Manager Discount','Employee Appreciation','Happy Hour'])assert.equal(isEmployeeMealDiscount({name}),false,name);
  assert.equal(isEmployeeMealDiscount({name:'Guest recovery',appliedDiscountReason:{comment:'employee meal discussed'}}),false);
});

test('bonus excludes check and item employee meals and Uber Eats once while retaining sales totals',()=>{
  const result=summarizeOrders([{businessDate:20260909,checks:[{amount:1000,selections:[{appliedDiscounts:[{name:'Employee Meal',discountAmount:20},{name:'Happy Hour',discountAmount:10}]}],appliedDiscounts:[{name:'Uber Eats',discountAmount:30},{name:'Staff Meal',discountAmount:-15},{name:'Uber Eats Employee Meal',discountAmount:5},{name:'Employee Meal',discountAmount:999,processingState:'VOID'},{name:'Employee Meal',discountAmount:999,processingState:'PENDING_VOID'}]}]}],'2026-09-09','2026-09-15');
  assert.deepEqual(result,{netSales:1000,discountAmount:80,bonusDiscountAmount:10,uberEatsDiscountAmount:35,employeeMealDiscountAmount:35,voidAmount:0});
  assert.equal(result.bonusDiscountAmount/result.netSales*100,1);
});

test('deleted, voided and out-of-period activity cannot add employee exclusions',()=>{
  const check={amount:100,selections:[{price:10,quantity:1,voided:true,appliedDiscounts:[{name:'Employee Meal',discountAmount:10}]}]};
  const result=summarizeOrders([{businessDate:20260908,checks:[check]},{businessDate:20260909,deleted:true,checks:[check]},{businessDate:20260909,checks:[check]}],'2026-09-09','2026-09-15');
  assert.equal(result.employeeMealDiscountAmount,0);
  assert.equal(result.voidAmount,10);
  assert.equal(result.netSales,100);
});
