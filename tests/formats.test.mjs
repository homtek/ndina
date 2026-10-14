import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { splitMessages, parseReport } from '../app/js/core/reportparse.js';
import { compile } from '../app/js/core/compile.js';
import { issueText } from '../app/js/core/format.js';

const raw = fs.readFileSync(new URL('./fixture-formats.txt', import.meta.url), 'utf8');

test('header-less paste is cut into the 8 members and every format is read', () => {
  const blocks = splitMessages(raw);
  assert.equal(blocks.length, 8);
  const p = blocks.map((b) => parseReport(b.text));
  const counts = p.map((x) => x.entries.length);
  assert.deepEqual(counts, [9, 12, 14, 23, 11, 7, 10, 15]);
  assert.equal(p[2].name, 'RAJABU');
  assert.equal(p[4].name, 'AYUBU');
  // glued text, no-space amounts, semicolon thousands, decimals
  assert.deepEqual(p[0].entries[0], { cn: '992041400362', amt: 600000, type: 'BL', status: 'PAID', carry: false });
  assert.equal(p[3].entries.find((e) => e.cn === '992041400242').amt, 2000000);
  assert.equal(p[6].entries.find((e) => e.cn === '992041399272').amt, 111200);
  assert.equal(p[6].entries.find((e) => e.cn === '992041400157').amt, 41271.2);
  assert.equal(p[6].entries.find((e) => e.cn === '992041400157').status, 'UNPAID');
  assert.equal(p[3].entries.find((e) => e.cn === '992041400274').status, 'UNPAID');
  // two-line entries
  assert.deepEqual(p[2].entries[0], { cn: '992041399402', amt: 200000, type: 'BL', status: 'PAID', carry: false });
  // Feliciana has no type on the lines: BL comes from "Bl cn 12", and it is marked as inferred
  assert.ok(p[1].entries.every((e) => e.type === 'BL' && e.inferred));
  // totals
  assert.equal(p[0].declared.count, 9); assert.equal(p[0].declared.bl, 4036500);
  assert.equal(p[1].declared.paid, 3231000); assert.equal(p[1].declared.count, 12);
  assert.equal(p[2].declared.total, 2550000); assert.equal(p[2].declared.sl, 0);
  assert.equal(p[5].declared.sl, 2011243); assert.equal(p[5].declared.bl, 358000);
  assert.deepEqual([p[6].declared.total, p[6].declared.paid, p[6].declared.unpaid], [1547504.45, 1316200, 231304.45]);
  assert.equal(p[7].declared.count, 14);
});

test('compile reports the real mistakes in these formats', () => {
  const blocks = splitMessages(raw).map((b, i) => ({ id: 'r' + i, memberId: 'm' + i, ts: null, addedAt: i, text: b.text, parsed: parseReport(b.text) }));
  const names = ['SADA', 'FELICIANA', 'RAJABU', 'SABINA', 'AYUBU', 'JESE', 'KADANGU', 'AMOS'];
  const roster = names.map((n, i) => ({ id: 'm' + i, name: n, aliases: [] }));
  const res = compile({ roster, session: { reports: blocks, resolutions: {}, ack: false }, date: '2026-10-13', prefix: '99204' });
  const nameOf = (id) => roster.find((m) => m.id === id).name;
  const lines = res.issues.map((i) => `${nameOf(i.memberId)}: ${issueText(i, nameOf, 'en')}`);
  console.log('\n' + lines.join('\n'));
  assert.ok(res.issues.some((i) => i.kind === 'conflict' && i.cn === '992041399834'));
  assert.ok(res.issues.some((i) => i.kind === 'count' && nameOf(i.memberId) === 'AMOS'));
  assert.ok(res.issues.some((i) => i.kind === 'inferred' && nameOf(i.memberId) === 'FELICIANA'));
  assert.ok(res.issues.some((i) => i.kind === 'sum' && nameOf(i.memberId) === 'FELICIANA'));
  assert.equal(res.issues.filter((i) => i.kind === 'noamount').length, 0);
});
