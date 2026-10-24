import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { weeklyRows, fillTemplate } from '../app/js/core/weeklyxlsx.js';

let ExcelJS = null;
try { ExcelJS = (await import('exceljs')).default; } catch { /* npm install exceljs to run these */ }
const tpl = fs.readFileSync(new URL('../app/templates/ripoti-wiki-kanda-2.xlsx', import.meta.url));

const mk = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({
  cn: String(992041400000 + i), amt: 100000 + i * 500, type: i % 5 === 0 ? 'SL' : 'BL', status: 'PAID', name: `MFANYABIASHARA ${i + 1}`, ...extra,
}));

test('unpaid lines are included by default and can be switched off', () => {
  const entries = [...mk(3), { cn: '992041400999', amt: 20000, type: 'SL', status: 'UNPAID', name: 'X' }];
  assert.equal(weeklyRows([{ date: '2026-10-13', entries }]).length, 4);
  assert.equal(weeklyRows([{ date: '2026-10-13', entries }], { includeUnpaid: false }).length, 3);
});

test('fills the template: officer repeated, control number as text, formulas kept', { skip: !ExcelJS }, async () => {
  const rows = weeklyRows([{ date: '2026-10-13', entries: mk(12) }]);
  rows[1].mtaa = 'MCHIKICHINI'; rows[1].tin = '123-456-789';
  const out = await fillTemplate(ExcelJS, tpl, { officer: 'AMOS KAPUNGU', rows });
  fs.writeFileSync('/tmp/ndina-small.xlsx', Buffer.from(out));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(out); const ws = wb.worksheets[0];
  assert.equal(ws.getCell('A1').value, 'HALMASHAURI YA JIJI LA DAR ES SALAAM');
  assert.equal(ws.getCell('B3').value, 'JINA LA AFISA');
  assert.equal(ws.getCell('B4').value, 'AMOS KAPUNGU'); assert.equal(ws.getCell('B15').value, 'AMOS KAPUNGU');
  assert.equal(ws.getCell('B16').value, null);                 // blank numbered rows stay blank
  assert.equal(ws.getCell('A33').value, 30);
  assert.equal(ws.getCell('F4').value, '992041400000'); assert.equal(typeof ws.getCell('F4').value, 'string');
  assert.equal(ws.getCell('G4').value, null); assert.equal(ws.getCell('H4').value, 100000); // first one is SL
  assert.equal(ws.getCell('G5').value, 100500);
  assert.equal(ws.getCell('D5').value, 'MCHIKICHINI'); assert.equal(ws.getCell('E5').value, '123-456-789');
  assert.equal(ws.getCell('M5').value.formula, 'SUM(G5:L5)');
  assert.equal(ws.getCell('A34').value, 'JUMLA'); assert.equal(ws.getCell('G34').value.formula, 'SUM(G4:G33)');
  assert.match(ws.getCell('G5').numFmt, /#,##0\.00/);   // the new template separates thousands
  assert.match(ws.getCell('M5').numFmt, /#,##0\.00/);
});

test('more than 30 lines: rows are added and the total moves down', { skip: !ExcelJS }, async () => {
  const entries = mk(75);
  const rows = weeklyRows([{ date: '2026-10-13', entries }]);
  const out = await fillTemplate(ExcelJS, tpl, { officer: 'AMOS KAPUNGU', rows });
  fs.writeFileSync('/tmp/ndina-big.xlsx', Buffer.from(out));
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(out); const ws = wb.worksheets[0];
  assert.equal(ws.getCell('A78').value, 75);                    // row 4 + 74
  assert.equal(ws.getCell('A79').value, 'JUMLA');
  assert.equal(ws.getCell('G79').value.formula, 'SUM(G4:G78)');
  assert.equal(ws.getCell('M79').value.formula, 'SUM(G79:L79)');
  assert.equal(ws.getCell('A34').value, 31);                    // old total row is now a normal row
  assert.ok(ws.model.merges.includes('A79:B79'));
  assert.ok(!ws.model.merges.includes('A34:B34'));
});
