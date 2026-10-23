// Fills the authority's "FOMU YA RIPOTI YA WIKI KANDA NA 02" template.
// ExcelJS is passed in, so this runs in the browser (global ExcelJS) and in Node tests.
const FIRST = 4;            // first data row in the template
const MIN_ROWS = 30;        // the template ships with 30 numbered rows
const COLS = 13;            // A..M
const AMOUNT_COLS = ['G', 'H', 'I', 'J', 'K', 'L']; // Leseni, Service Levy, Hotel Levy, Mazingira, Vileo, Mabango

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const clone = (o) => JSON.parse(JSON.stringify(o || {}));

// days: [{ date, entries }]  ->  one row per control number, day by day
export function weeklyRows(days, { includeUnpaid = true } = {}) {
  const rows = [];
  for (const { entries } of days) {
    for (const e of entries) {
      if (e.status === 'UNPAID' && !includeUnpaid) continue;
      rows.push({
        trader: e.name || '', mtaa: e.mtaa || '', tin: e.tin || '', cn: e.cn,
        bl: e.type === 'BL' ? e.amt : null, sl: e.type === 'SL' ? e.amt : null,
      });
    }
  }
  return rows;
}

const fmtFor = (v) => (Number.isInteger(v) ? '#,##0' : '#,##0.00');

export async function fillTemplate(ExcelJS, templateBytes, { officer, rows, title }) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBytes);
  const ws = wb.worksheets[0];

  const total = Math.max(MIN_ROWS, rows.length);
  const totalRow = FIRST + total;               // template: 4 + 30 = 34
  const dataStyle = [], totalStyle = [];
  for (let c = 1; c <= COLS; c++) {
    dataStyle[c] = clone(ws.getCell(FIRST, c).style);
    totalStyle[c] = clone(ws.getCell(34, c).style);
  }
  const dataHeight = ws.getRow(FIRST).height || 15.75;
  const totalHeight = ws.getRow(34).height || 16.5;

  try { ws.unMergeCells('A34:B34'); } catch { /* already unmerged */ }
  for (let c = 1; c <= COLS; c++) { const cell = ws.getCell(34, c); cell.value = null; }

  // data rows (blank numbered rows are kept, exactly like the template)
  for (let i = 0; i < total; i++) {
    const r = FIRST + i;
    const row = ws.getRow(r);
    row.height = dataHeight;
    for (let c = 1; c <= COLS; c++) { const cell = row.getCell(c); cell.style = clone(dataStyle[c]); cell.value = null; }
    const d = rows[i];
    row.getCell(1).value = i + 1;
    if (d) {
      row.getCell(2).value = officer;
      row.getCell(3).value = d.trader || null;
      row.getCell(4).value = d.mtaa || null;
      row.getCell(5).value = d.tin ? String(d.tin) : null;
      const cn = row.getCell(6); cn.value = String(d.cn); cn.numFmt = '@';       // keep 12 digits, never 9.92E+11
      if (d.bl != null) { const g = row.getCell(7); g.value = d.bl; g.numFmt = fmtFor(d.bl); }
      if (d.sl != null) { const h = row.getCell(8); h.value = d.sl; h.numFmt = fmtFor(d.sl); }
    }
    const sum = (d?.bl || 0) + (d?.sl || 0);
    const m = row.getCell(13);
    m.value = { formula: `SUM(G${r}:L${r})`, result: round2(sum) };
    m.numFmt = fmtFor(round2(sum));
    row.commit?.();
  }

  // total row
  const tr = ws.getRow(totalRow);
  tr.height = totalHeight;
  for (let c = 1; c <= COLS; c++) { const cell = tr.getCell(c); cell.style = clone(totalStyle[c]); cell.value = null; }
  tr.getCell(1).value = 'JUMLA';
  ws.mergeCells(`A${totalRow}:B${totalRow}`);
  const colSum = { G: 0, H: 0, I: 0, J: 0, K: 0, L: 0 };
  rows.forEach((d) => { colSum.G += d.bl || 0; colSum.H += d.sl || 0; });
  AMOUNT_COLS.forEach((L) => {
    const cell = ws.getCell(`${L}${totalRow}`);
    cell.value = { formula: `SUM(${L}${FIRST}:${L}${totalRow - 1})`, result: round2(colSum[L]) };
    cell.numFmt = fmtFor(round2(colSum[L]));
  });
  const grand = round2(Object.values(colSum).reduce((a, b) => a + b, 0));
  const mt = ws.getCell(`M${totalRow}`);
  mt.value = { formula: `SUM(G${totalRow}:L${totalRow})`, result: grand };
  mt.numFmt = fmtFor(grand);

  // tidy: open at the top, print landscape on one page width
  ws.views = [{ state: 'normal', activeCell: 'A1', showGridLines: true }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  wb.creator = 'Ndina';
  if (title) wb.title = title;
  return wb.xlsx.writeBuffer();
}
