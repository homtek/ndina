import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyReport, memberReport } from '../app/js/core/format.js';
import { weekStart, addDays } from '../app/js/core/util.js';
import { parseReport } from '../app/js/core/reportparse.js';

test('weeks run Monday to Sunday', () => {
  assert.equal(weekStart('2026-10-13'), '2026-10-12'); // Tuesday -> Monday
  assert.equal(weekStart('2026-10-18'), '2026-10-12'); // Sunday
  assert.equal(weekStart('2026-10-19'), '2026-10-19');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
});

test('daily totals count BL + SL, paid and unpaid, with no Unpaid line', () => {
  const e = [
    { cn: '992041400527', amt: 80000, type: 'BL', status: 'PAID' },
    { cn: '992041400177', amt: 101300, type: 'SL', status: 'PAID' },
    { cn: '992041400274', amt: 20000, type: 'SL', status: 'UNPAID' },
  ];
  const t = memberReport({ name: 'AMOS', date: '2026-10-13', entries: e });
  assert.match(t, /Total BL: 80,000/); assert.match(t, /Total SL: 121,300/); assert.match(t, /Total Amount: 201,300/);
  assert.doesNotMatch(t, /Total Unpaid/);
});

test('weekly report, summary and full', () => {
  const d1 = [{ cn: '992041400527', amt: 80000, type: 'BL', status: 'PAID' }, { cn: '992041400177', amt: 101300, type: 'SL', status: 'PAID' }];
  const d2 = [{ cn: '992041400603', amt: 150000, type: 'BL', status: 'PAID' }];
  const days = [{ date: '2026-10-12', entries: d1 }, { date: '2026-10-13', entries: d2 }];
  const sum = weeklyReport({ name: 'AMOS', from: '2026-10-12', to: '2026-10-18', days, emptyDates: ['2026-10-14'], mode: 'sum' });
  console.log('\n' + sum);
  assert.match(sum, /Jumatatu 12.10.2026: C\/N 2 \| BL 80,000 \| SL 101,300 \| Jumla 181,300/);
  assert.match(sum, /Hakuna ripoti: Jumatano/); assert.match(sum, /Total Amount: 331,300/); assert.match(sum, /Total C\/N:3/);
  const full = weeklyReport({ name: 'AMOS', from: '2026-10-12', to: '2026-10-18', days, mode: 'full' });
  assert.match(full, /992041400603-150,000 BL PAID/); assert.match(full, /Jumla ya siku: 181,300 \(2 C\/N\)/);
});

test('a daily report pasted back in is read with its date', () => {
  const t = memberReport({ name: 'AMOS', date: '2026-10-14', entries: [{ cn: '992041400527', amt: 80000, type: 'BL', status: 'PAID' }] });
  const p = parseReport(t);
  assert.equal(p.date, '2026-10-14'); assert.equal(p.entries.length, 1);
});
