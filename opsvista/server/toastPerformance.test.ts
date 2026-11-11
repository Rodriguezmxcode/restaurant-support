import test from 'node:test';
import assert from 'node:assert/strict';
import { isEmployeeMealDiscount, summarizeOrders } from './toastPerformance.js';

test('employee meal names allow formatting variants without excluding unrelated discounts',()=>{
  for(const name of ['Employee Meal Discounts','EMPLOYEE MEAL 50%','employee-meal','Employee_Meals','Staff Meal','Emp Meal','Comida de empleados','Comida del personal','EmployeeMealDiscount','Employee Disc 25%- Item','Emplyoee 20% To-go item Discount','Employee Discount'])assert.equal(isEmployeeMealDiscount({name}),true,name);
  for(const name of ['Customer Meal','Kids Meal','Manager Discount','Employee Appreciation','Happy Hour'])assert.equal(isEmployeeMealDiscount({name}),false,name);
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

 test('Avon report reconciles employee exclusions and retains unconfirmed promotions',()=>{
 const rows:[string,number][]=[['$10 Reward',50],['Birthday Rewards',5],['Cash Reward',500],['Courtesy meal',83],['Employee Disc 25%- Item',9],['Emplyoee 20% To-go item Discount',4.60],['Gasta $45, ahorra $7',7],['Manager Comp - Item',82],['Open % Check',5.25],['Open % Item',49],['Open $ Check',13],['Spend $45, save $10',7],['Spend $45, save $7',84],['Spend $45, save $9',14],['UberEats FLAT',270]];
 const result=summarizeOrders([{businessDate:20260909,checks:[{amount:10000,appliedDiscounts:rows.map(([name,discountAmount])=>({name,discountAmount}))}]}],'2026-09-09','2026-09-15');
 assert.equal(result.discountAmount,1182.85);
 assert.equal(result.employeeMealDiscountAmount,13.60);
 assert.equal(result.uberEatsDiscountAmount,270);
 assert.equal(result.bonusDiscountAmount,899.25);
});

test('Danbury report recognizes all supplied employee discount variants',()=>{
 const rows:[string,number][]=[['$10 Reward',10],['Cash Reward',148.25],['Employee Disc 25%- Item',57.50],['Employee Discount - 50% Check',26],['Employee Discount -50%  Item',49.50],['Emplyoee 20% To-go item Discount',5],['Manager Comp - Item',104],['Spend $45, save $7',21],['Spend $45, save $9',14],['UberEats FLAT',252]];
 const result=summarizeOrders([{businessDate:20260909,checks:[{amount:10000,appliedDiscounts:rows.map(([name,discountAmount])=>({name,discountAmount}))}]}],'2026-09-09','2026-09-15');
 assert.equal(result.discountAmount,687.25);
 assert.equal(result.employeeMealDiscountAmount,138);
 assert.equal(result.uberEatsDiscountAmount,252);
 assert.equal(result.bonusDiscountAmount,297.25);
});

test('Fairfield report reconciles five employee labels without excluding family courtesy',()=>{
 const rows:[string,number][]=[['$10 Reward',40],['Birthday Courtesy Dessert',58],['Birthday Rewards',15],['Cash Reward',387.60],['Employee Disc 25% - Check',78.50],['Employee Disc 25%- Item',9],['Employee Discount - 50% Check',184.42],['Employee Discount -50%  Item',43],['Emplyoee 20% To-go item Discount',14.40],['Family courtesy meal',28],['Gasta $45, ahorra $12',7],['Guacamole Comp.',17],['Manager Comp - Check',38],['Manager Comp - Item',110],['Open % Item',24.20],['Spend $45, save $10',7],['Spend $45, save $7',35],['UberEats FLAT',540]];
 const result=summarizeOrders([{businessDate:20260909,checks:[{amount:10000,appliedDiscounts:rows.map(([name,discountAmount])=>({name,discountAmount}))}]}],'2026-09-09','2026-09-15');
 assert.equal(result.discountAmount,1636.12);
 assert.equal(result.employeeMealDiscountAmount,329.32);
 assert.equal(result.uberEatsDiscountAmount,540);
 assert.equal(result.bonusDiscountAmount,766.80);
});
