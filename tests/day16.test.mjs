import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { splitMessages, parseReport, extractNames } from '../app/js/core/reportparse.js';
import { compile } from '../app/js/core/compile.js';
import { issueText } from '../app/js/core/format.js';

const raw = fs.readFileSync(new URL('./fixture-day16.txt', import.meta.url), 'utf8');
const blocks = splitMessages(raw);
const parsed = blocks.map((b) => ({ ...b, p: parseReport(b.text) }));
const byName = (n) => parsed.find((x) => x.p.name === n);

test('compiled report pasted back: 11 members, clean names, footer not attached to anyone', () => {
  assert.deepEqual(extractNames(raw), ['AYUBU', 'FELICIANA', 'RAJABU', 'SADA', 'SABINA', 'HAMAD', 'MARIAM', 'KADANGU', 'JESE', 'PASKAL', 'AMOS KAPUNGU']);
  assert.equal(parsed.length, 11);
  assert.deepEqual(parsed.map((x) => x.p.entries.length), [5, 12, 8, 14, 11, 5, 8, 12, 3, 13, 11]);
  const amos = byName('AMOS KAPUNGU');
  assert.equal(amos.p.declared.bl, 2232000); assert.equal(amos.p.declared.sl, 241961.34); assert.equal(amos.p.declared.total, 2473961.34);
  assert.equal(byName('PASKAL').p.entries.length, 13);
});

test('real mistakes are caught, and nothing else is flagged falsely', () => {
  const names = parsed.map((x) => x.p.name);
  const roster = names.map((n, i) => ({ id: 'm' + i, name: n, aliases: [] }));
  const reports = parsed.map((x, i) => ({ id: 'r' + i, memberId: 'm' + i, ts: null, addedAt: i, text: x.text, parsed: x.p }));
  const run = (resolutions = {}, ack = false) => compile({ roster, session: { reports, resolutions, ack }, date: '2026-10-16', prefix: '99204' });
  const res = run();
  const nameOf = (id) => roster.find((m) => m.id === id).name;
  const show = res.issues.filter((i) => !['dup'].includes(i.kind)).map((i) => `${nameOf(i.memberId)}: ${issueText(i, nameOf, 'en')}`);
  console.log('\n' + show.join('\n'));
  const of = (kind, who) => res.issues.filter((i) => i.kind === kind && (!who || nameOf(i.memberId) === who));

  // Kadangu: dashed number and wrong prefix are both flagged, and his own total now adds up
  assert.deepEqual(of('cnformat', 'KADANGU').map((i) => i.cn).sort(), ['167345646', '991041399804']);
  assert.equal(of('sum', 'KADANGU').length, 0);
  // Sabina: "FAIN" is not guessed as BL
  assert.equal(of('type', 'SABINA')[0].data.raw, 'FAIN');
  assert.equal(of('inferred', 'SABINA').length, 0);
  // Paskal wrote two numbers twice with different amounts
  assert.deepEqual(of('withinconflict', 'PASKAL').map((i) => i.cn).sort(), ['992041401484', '992041402758']);
  // Amos and the others have no false total mismatch
  for (const n of ['AMOS KAPUNGU', 'AYUBU', 'SADA', 'JESE', 'HAMAD', 'RAJABU']) assert.equal(of('sum', n).length, 0, n);
  // Mariam / Feliciana wrote their C/N counts correctly
  assert.equal(of('count').length, 0);
  // blocking: 2 bad control numbers + 1 FAIN + 2 Paskal duplicates = 5 decisions
  assert.equal(res.blocking, 5);

  // leader picks the right amounts -> Paskal's two are resolved
  const res2 = run({ 'w:m9:992041402758': '0', 'w:m9:992041401484': '1' });
  assert.equal(res2.issues.filter((i) => i.kind === 'withinconflict' && !i.resolved).length, 0);
  const paskal = res2.members.find((m) => m.member.name === 'PASKAL');
  assert.equal(paskal.paid.find((e) => e.cn === '992041402758').amt, 200000);
  assert.equal(paskal.paid.find((e) => e.cn === '992041401484').amt, 150000);
  assert.equal(res2.blocking, 3);
});
