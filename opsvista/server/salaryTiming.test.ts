import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateSalaryTiming, type OperatingSchedule } from '../shared/salaryTiming.js';
import { allocateSalaryLabor } from './salaryLabor.js';
import { intradaySalary } from './intradaySalary.js';
import { scheduleFromGoogle, type GoogleHoursLocation } from './googleOperatingHours.js';
import { VERIFIED_GOOGLE_HOURS } from './verifiedGoogleHours.js';

const schedule: OperatingSchedule = { timeZone: 'America/New_York', week: Object.fromEntries(Array.from({ length: 7 }, (_, day) => [String(day), { open: '11:00', close: '23:00' }])) };
const input = { location: 'Example', date: '2026-09-21', now: new Date('2026-09-21T17:00:00Z'), fullDaySalary: 600, hourlyLabor: 240, netSales: 1200, salaryConfigured: true, schedule };

test('11–23 example at 13:00: $100 salary, $340 total, 28.33% labor', () => {
  const row = calculateSalaryTiming(input);
  assert.equal(row.accruedSalary, 100);
  assert.equal(row.hourlyAllocation, 50);
  assert.equal(row.allocatedPct, 16.67);
  assert.equal(row.remainingSalary, 500);
  assert.equal(row.totalAccruedLabor, 340);
  assert.equal(row.totalPct, 28.33);
  assert.equal(row.fullDaySalaryPct, 50);
});
test('before opening preserves hourly prep; at and after closing reaches exactly daily salary', () => {
  const before = calculateSalaryTiming({ ...input, now: new Date('2026-09-21T14:00:00Z') });
  assert.equal(before.accruedSalary, 0);
  assert.equal(before.totalAccruedLabor, 240);
  for (const now of ['2026-09-22T03:00:00Z', '2026-09-22T05:00:00Z']) {
    const row = calculateSalaryTiming({ ...input, now: new Date(now) });
    assert.equal(row.accruedSalary, 600);
    assert.equal(row.remainingSalary, 0);
    assert.equal(row.totalAccruedLabor, 840);
  }
});
test('minute-level accrual reconciles cents and never exceeds commitment', () => {
  for (let minute = 0; minute <= 720; minute++) {
    const row = calculateSalaryTiming({ ...input, fullDaySalary: 666.87, now: new Date(Date.parse('2026-09-21T15:00:00Z') + minute * 60_000) });
    assert.ok(Math.abs(row.accruedSalary! + row.remainingSalary! - 666.87) < 0.001);
    assert.ok(row.accruedSalary! >= 0 && row.accruedSalary! <= 666.87);
  }
});
test('no positive sales means unavailable percentage, not zero or infinity', () => {
  for (const netSales of [0, -25]) {
    const row = calculateSalaryTiming({ ...input, netSales });
    assert.equal(row.totalPct, null);
    assert.equal(row.salaryPct, null);
    assert.equal(row.fullDaySalaryPct, null);
  }
});
test('overnight hours stay on the opening business date', () => {
  const row = calculateSalaryTiming({ ...input, now: new Date('2026-09-22T05:00:00Z'), schedule: { ...schedule, dates: { '2026-09-21': { open: '17:00', close: '02:00' } } } });
  assert.equal(row.operatingHours, 9);
  assert.equal(row.elapsedHours, 8);
  assert.equal(row.accruedSalary, 533.33);
});
test('DST uses actual elapsed hours, not a fixed time-zone offset', () => {
  const dstSchedule = { ...schedule, week: { '0': { open: '00:00', close: '04:00' } } };
  const spring = calculateSalaryTiming({ ...input, schedule: dstSchedule, date: '2026-03-08', now: new Date('2026-03-08T07:00:00Z') });
  assert.equal(spring.operatingHours, 3);
  assert.equal(spring.elapsedHours, 2);
  assert.equal(spring.accruedSalary, 400);
  const autumn = calculateSalaryTiming({ ...input, schedule: dstSchedule, date: '2026-11-01', now: new Date('2026-11-01T08:00:00Z') });
  assert.equal(autumn.operatingHours, 5);
  assert.equal(autumn.elapsedHours, 4);
  assert.equal(autumn.accruedSalary, 480);
});
test('missing, invalid and closed schedules do not fabricate an accrued cost', () => {
  for (const value of [undefined, { ...schedule, timeZone: 'invalid' }, { ...schedule, week: {} }, { ...schedule, week: { '1': { open: '11:00', close: '11:00' } } }]) {
    assert.equal(calculateSalaryTiming({ ...input, schedule: value }).accruedSalary, null);
  }
  const closed = calculateSalaryTiming({ ...input, schedule: { ...schedule, dates: { '2026-09-21': null } } });
  assert.equal(closed.status, 'closed');
  assert.equal(closed.fullDaySalary, 600);
  assert.equal(closed.accruedSalary, null);
  assert.equal(calculateSalaryTiming({ ...input, salaryConfigured: false }).status, 'missing_salary');
});
test('the same daily salary accrues more slowly on a longer operating day', () => {
  const longer = calculateSalaryTiming({ ...input, schedule: { ...schedule, week: { '1': { open: '11:00', close: '01:00' } } } });
  assert.equal(longer.accruedSalary, 85.71);
  assert.equal(longer.operatingHours, 14);
});
test('weekly payroll allocation remains unchanged and identifies missing salaries per location', () => {
  const weekly = allocateSalaryLabor('2026-09-09', '2026-09-15', ['Avon', 'Unknown']);
  assert.equal(weekly.rows[0].salaryLaborCost, 4668.08);
  assert.equal(weekly.rows[0].salaryConfigured, true);
  assert.equal(weekly.rows[1].salaryConfigured, false);
});
test('one missing configuration prevents mixed-basis primary totals', () => {
  const rows = [{ location: 'Example', salaryLaborCost: 600, hourlyLaborCost: 240, netSales: 1200, salaryConfigured: true }];
  assert.equal(intradaySalary(input.date, rows, input.now, { Example: schedule }).applied, true);
  const partial = intradaySalary(input.date, [...rows, { ...rows[0], location: 'Other' }], input.now, { Example: schedule });
  assert.equal(partial.applied, false);
  assert.equal(partial.rows[1].accruedSalary, null);
  assert.equal(intradaySalary(input.date, rows, input.now).applied, false);
});

test('verified public Google schedules include every weekday and correct overnight duration', () => {
  assert.equal(Object.keys(VERIFIED_GOOGLE_HOURS).length, 8);
  for (const [location, schedule] of Object.entries(VERIFIED_GOOGLE_HOURS)) {
    assert.equal(Object.keys(schedule.week).length, 7);
    const row = calculateSalaryTiming({ ...input, location, date: '2026-09-25', now: new Date('2026-09-26T07:00:00Z'), schedule });
    assert.equal(row.accruedSalary, 600);
    assert.ok(row.hoursSourceUrl?.startsWith('https://www.google.com/maps/place/'));
    if (location === 'Orange' || location === 'Danbury') assert.equal(row.operatingHours, 15);
  }
});

const googleLocation: GoogleHoursLocation = {
  name: 'locations/test', title: 'Puerto Vallarta Example', storefrontAddress: { administrativeArea: 'CT', regionCode: 'US' },
  regularHours: { periods: [{ openDay: 'MONDAY', closeDay: 'MONDAY', openTime: { hours: 11 }, closeTime: { hours: 24 } }] },
};
test('Google midnight, holiday overrides, split service, and closed days', () => {
  const base = scheduleFromGoogle(googleLocation, input.now.toISOString())!;
  assert.equal(calculateSalaryTiming({ ...input, schedule: base }).operatingHours, 13);
  const special = scheduleFromGoogle({ ...googleLocation, specialHours: { specialHourPeriods: [
    { startDate: { year: 2026, month: 9, day: 21 }, openTime: { hours: 11 }, closeTime: { hours: 14 } },
    { startDate: { year: 2026, month: 9, day: 21 }, openTime: { hours: 17 }, closeTime: { hours: 22 } },
    { startDate: { year: 2026, month: 9, day: 22 }, closed: true },
  ] } }, input.now.toISOString())!;
  const between = calculateSalaryTiming({ ...input, schedule: special, now: new Date('2026-09-21T19:00:00Z') });
  assert.equal(between.operatingHours, 8);
  assert.equal(between.elapsedHours, 3);
  assert.equal(between.accruedSalary, 225);
  assert.equal(calculateSalaryTiming({ ...input, date: '2026-09-22', schedule: special }).status, 'closed');
});
test('invalid Google special hours do not silently use regular hours', () => {
  const schedule = scheduleFromGoogle({ ...googleLocation, specialHours: { specialHourPeriods: [
    { startDate: { year: 2026, month: 9, day: 21 }, openTime: { hours: 11 }, closeTime: { hours: 5 } },
  ] } }, input.now.toISOString());
  assert.equal(calculateSalaryTiming({ ...input, schedule }).status, 'missing_hours');
  assert.equal(scheduleFromGoogle({ ...googleLocation, storefrontAddress: { administrativeArea: 'CA' } }, input.now.toISOString()), undefined);
});
