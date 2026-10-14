import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { extractNames, parseReport, splitMessages, matchMember } from '../app/js/core/reportparse.js';
import { compile } from '../app/js/core/compile.js';
import { compiledReport, correctionsMessage, issueText, memberReport } from '../app/js/core/format.js';

const text = fs.readFileSync(new URL('./fixture-compiled.txt', import.meta.url), 'utf8');
const names = extractNames(text);
const roster = names.map((n, i) => ({ id: 'm' + i, name: n, aliases: [] }));

// Build one pretend WhatsApp message per member from the compiled report.
function blocks() {
  const parts = text.split(/\n(?=_?\u2b55)/).slice(1);
  return parts.map((p, i) => {
    const body = p.replace(/\n_TOTAL PAID[\s\S]*$/, '');
    const nm = body.split('\n')[0].replace(/[_\u2b55\ufe0f]/g, '').trim();
    return `[1${i}:0${i}, 14/10/2026] ${nm}: Tar 13.10.2026\n${body.split('\n').slice(1).join('\n')}`;
  });
}

test('roster names are read from the compiled report', () => {
  assert.deepEqual(names, ['SADA', 'FELICIANA', 'RAJABU', 'SABINA', 'AYUBU', 'JESE', 'KADANGU', 'AMOS KAPUNGU']);
});

test('compile finds the real mistakes in the 13.10.2026 report', () => {
  const reports = blocks().flatMap((b, i) => splitMessages(b).map((m) => {
    const parsed = parseReport(m.text);
    return { id: 'r' + i, memberId: matchMember(roster, m.sender, parsed.name), sender: m.sender, ts: m.ts, addedAt: i, text: m.text, parsed };
  }));
  assert.equal(reports.filter((r) => !r.memberId).length, 0);
  const res = compile({ roster, session: { reports, resolutions: {}, ack: false }, date: '2026-10-13' });
  const kinds = (k) => res.issues.filter((i) => i.kind === k);
  const nameOf = (id) => roster.find((m) => m.id === id).name;

  // 992041399834 is 650,000 for Feliciana and 150,000 for Rajabu
  assert.ok(kinds('conflict').some((i) => i.cn === '992041399834'));
  // Amos wrote 14 CN but has 15 lines
  assert.ok(kinds('count').some((i) => nameOf(i.memberId) === 'AMOS KAPUNGU' && i.data.declared === 14 && i.data.actual === 15));
  // Kadangu's "jana" block is yesterday
  assert.ok(kinds('carry').some((i) => nameOf(i.memberId) === 'KADANGU' && i.data.n === 6));
  // plain duplicates counted once
  for (const cn of ['992041400106', '992041400122', '992041400199', '992041400290', '992041399221', '992041399838', '992041399842']) {
    assert.ok(kinds('dup').some((i) => i.cn === cn), cn);
  }
  assert.ok(res.blocking >= 1);

  // leader resolves the conflict (Rajabu is right), then everything unlocks
  const res2 = compile({ roster, session: { reports, resolutions: { '992041399834': roster.find((m) => m.name === 'RAJABU').id }, ack: false }, date: '2026-10-13' });
  assert.equal(res2.blocking, 0);

  // duplicates are no longer double counted: BL total must be below the old 20,654,000
  assert.ok(res2.totals.blPaid < 20654000, String(res2.totals.blPaid));
  console.log('\nBL paid now', res2.totals.blPaid, 'SL paid', res2.totals.slPaid, 'SL unpaid', res2.totals.slUnpaid);
  const final = compiledReport({ title: 'TAARIFA YA SIKU YA GEREZANI', date: '2026-10-13', result: res2 });
  console.log(final.split('\n').slice(0, 14).join('\n'));
  console.log('...\n' + final.split('\n').slice(-16).join('\n'));
  console.log('\n' + correctionsMessage({ date: '2026-10-13', title: 'TAARIFA YA SIKU YA GEREZANI', result: res }).slice(0, 1800));
});

test('member report round-trips through the parser', () => {
  const entries = [
    { cn: '992041400527', amt: 80000, type: 'BL', status: 'PAID' },
    { cn: '992041400177', amt: 101300, type: 'SL', status: 'PAID' },
    { cn: '992041400274', amt: 20000, type: 'SL', status: 'UNPAID' },
  ];
  const t = memberReport({ name: 'AMOS KAPUNGU', date: '2026-10-13', entries, });
  const p = parseReport(t);
  assert.equal(p.date, '2026-10-13');
  assert.equal(p.name, 'AMOS KAPUNGU');
  assert.equal(p.entries.length, 3);
  assert.deepEqual(p.declared, { count: 3, bl: 80000, sl: 101300, total: 181300 });
  assert.ok(!/imechujwa|akiba/i.test(t));
  assert.equal(p.entries[2].status, 'UNPAID');
});
