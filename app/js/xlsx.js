// Builds the authority's weekly Excel on the phone. The Excel engine and the template are cached for offline use.
import { weeklyRows, fillTemplate } from './core/weeklyxlsx.js';

const BASE = new URL('./', document.baseURI.replace(/[^/]*$/, '')).href;
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.ExcelJS) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('engine'));
    document.head.appendChild(s);
  });
}

export async function buildWeeklyXlsx({ officer, days, includeUnpaid, title }) {
  await loadScript(BASE + 'vendor/exceljs/exceljs.min.js');
  const resp = await fetch(BASE + 'templates/ripoti-wiki-kanda-2.xlsx');
  if (!resp.ok) throw new Error('template');
  const bytes = await resp.arrayBuffer();
  const rows = weeklyRows(days, { includeUnpaid });
  const out = await fillTemplate(window.ExcelJS, bytes, { officer, rows, title });
  return { blob: new Blob([out], { type: XLSX_MIME }), count: rows.length };
}
