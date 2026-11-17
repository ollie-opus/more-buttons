import assert from 'node:assert/strict';
import { calendarDays, shiftDate, todayIso } from '../scripts/kbDatePicker.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('a month is shown as six weeks, Monday first', () => {
  const nov = calendarDays(2026, 11); // 1st November 2026 is a Sunday
  assert.equal(nov.length, 42);
  assert.equal(nov[0].date, '2026-10-26');
  assert.equal(nov[0].inMonth, false);
  assert.deepEqual(nov[6], { date: '2026-11-01', day: 1, inMonth: true });
  assert.equal(nov.filter(d => d.inMonth).length, 30);
  assert.equal(nov[41].date, '2026-12-06');
  // A month that starts on a Monday starts the grid.
  assert.equal(calendarDays(2026, 6)[0].date, '2026-06-01');
  // February in a leap year.
  assert.equal(calendarDays(2028, 2).filter(d => d.inMonth).length, 29);
});

test('dates move by days and months', () => {
  assert.equal(shiftDate('2026-11-30', { days: 1 }), '2026-12-01');
  assert.equal(shiftDate('2026-01-01', { days: -1 }), '2025-12-31');
  assert.equal(shiftDate('2026-11-13', { days: 7 }), '2026-11-20');
  assert.equal(shiftDate('2026-01-31', { months: 1 }), '2026-02-28');
  assert.equal(shiftDate('2026-12-15', { months: 1 }), '2027-01-15');
  assert.equal(shiftDate('2026-01-15', { months: -1 }), '2025-12-15');
  assert.equal(shiftDate('nonsense', { days: 1 }), 'nonsense');
});

test('today is the local date', () => {
  assert.equal(todayIso(new Date(2026, 10, 3, 23, 30)), '2026-11-03');
});

console.log(`\n${passed} passed`);
