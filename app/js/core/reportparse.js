// Reads WhatsApp report text written by members (and the leader's old compiled format).
import { parseAmount, dmyToIso, nameTokens, normName } from './util.js';

const clean = (l) => l.replace(/[_*~]/g, '').replace(/\u200e|\u200f/g, '').trim();
const CN_START = /^\D{0,3}(\d{9,14})(?!\d)/;
const SUMMARY_START = /^(total|jumla|idadi|bl\b|sl\b|paid|unpaid)/i;
const NOT_A_NAME = /^(paid|unpaid|total|jumla|idadi|bl|sl|tar|tarehe|taarifa|date|jina|name|hello|habari|poa|asante|salaam|imechujwa)\b/i;

// numbers written as 1,000 / 1.000 / 111;200 / 41,271.20 / 2,550,000.
const num = (s) => (s == null ? NaN : parseAmount(String(s).replace(/;/g, ',').replace(/[.,;]+$/, '')));

// Pull type / amount / status out of loose text such as "-600,000blpaid", "----200,000-Paid", "200,000 PAID".
function fields(str) {
  let r = str.toLowerCase();
  const status = /unpaid/.test(r) ? 'UNPAID' : /paid/.test(r) ? 'PAID' : null;
  r = r.replace(/unpaid|paid/g, ' ');
  const tm = r.match(/(?<![a-z])(bl|sl)(?![a-z])/);
  const nm = r.match(/\d[\d,.;]*/);
  return { type: tm ? tm[1].toUpperCase() : null, amt: nm ? num(nm[0]) : NaN, status };
}

// Totals members write at the end of a report. Returns the type this line talks about (if any).
function parseSummary(l, declared, hints) {
  const grab = (re) => { const m = l.match(re); return m ? num(m[1]) : NaN; };
  let v;
  // count: "Total C/N:14", "Idadi bl-9", "Bl cn 12", "(14 CN)"
  const cm = l.match(/(?:idadi|c\s*\/?\s*n)\D{0,14}?(\d{1,4})(?![\d,.])/i) || l.match(/\(\s*(\d+)\s*c\s*n\s*\)/i);
  if (cm) {
    declared.count = Number(cm[1]);
    if (/(?<![a-z])bl(?![a-z])/i.test(l)) hints.add('BL');
    if (/(?<![a-z])sl(?![a-z])/i.test(l)) hints.add('SL');
  }
  // anywhere on a total line (legacy compiled style): "Total BL-2,067,100 / SL-101,300 / Jumla-2,168,400"
  if (/^(total|jumla)/i.test(l)) {
    v = grab(/\bBL\s*(?:PAID)?\s*[-:=]\s*(\d[\d,.;]*)/i); if (!Number.isNaN(v)) declared.bl = v;
    v = grab(/\bSL\s*(?:PAID)?\s*[-:=]\s*(\d[\d,.;]*)/i); if (!Number.isNaN(v)) declared.sl = v;
  }
  // "BL=2,550,000", "Sl-2,011,243", "Total bl-4,036,500/="
  const tm = l.match(/^(?:total\s*)?(bl|sl)\s*(?:paid)?\s*[-:=.\s]+\s*(\d[\d,.;]*)/i);
  if (tm && !cm) { v = num(tm[2]); if (!Number.isNaN(v)) declared[tm[1].toLowerCase()] = v; }
  // "Paid .....1,316,200.00" / "Unpaid......231,304.45"
  const pm = l.match(/^(paid|unpaid)\s*[.,:=\-\s]+(\d[\d,.;]*)/i);
  if (pm) { v = num(pm[2]); if (!Number.isNaN(v)) declared[pm[1].toLowerCase()] = v; return; }
  // "TOTAL=2,550,000.", "Total paid: 3,231,000/=", "Total Amount: 2,168,400", "Jumla-2,369,243"
  const tt = l.match(/^(?:total|jumla)\s*(paid|amount|kuu)?\s*[.:=\-,\s]*(\d[\d,.;]*)/i);
  if (tt) { v = num(tt[2]); if (!Number.isNaN(v)) declared[/paid/i.test(tt[1] || '') ? 'paid' : 'total'] = v; }
}

// Parse ONE report's text.
export function parseReport(text) {
  const entries = [];
  const declared = {};
  const hints = new Set();
  let date = null, name = null, filterNote = null;
  let ctx = 'PAID';
  let blockStart = 0;
  let pending = null; // control number whose amount is on the next line
  const flush = () => { if (pending) { entries.push(pending); pending = null; } };

  String(text || '').split(/\r?\n/).forEach((raw) => {
    const l = clean(raw);
    if (!l) return;
    if (!date) {
      const dm = l.match(/(?:^|\b)(?:tar(?:ehe)?|date)\b\W*(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/i);
      if (dm) date = dmyToIso(dm[1], dm[2], dm[3]);
    }
    const nm = l.match(/^(?:jina|name)\s*[:\-]\s*(.+)$/i);
    if (nm && !name) { name = nm[1].trim(); return; }
    if (/^\u2b55/.test(l) && !name) { name = l.replace(/^[\u2b55\ufe0f\s]+/, '').trim(); return; }
    if (/^imechujwa/i.test(l)) { filterNote = l; return; }
    if (/^total\s+jana\b/i.test(l)) { flush(); for (let i = blockStart; i < entries.length; i++) entries[i].carry = true; blockStart = entries.length; return; }
    if (/^total\s+leo\b/i.test(l)) { flush(); blockStart = entries.length; return; }

    // second line of a two-line entry: "200,000 PAID"
    if (pending && !SUMMARY_START.test(l) && !CN_START.test(l)) {
      const f = fields(l);
      if (!Number.isNaN(f.amt)) {
        pending.amt = f.amt;
        if (f.type && pending.type === '?') pending.type = f.type;
        if (f.status) pending.status = f.status;
        flush();
        return;
      }
    }

    const cn = l.match(CN_START);
    if (cn) {
      flush();
      const f = fields(l.slice(cn[0].length));
      const e = { cn: cn[1], amt: f.amt, type: f.type || '?', status: f.status || ctx, carry: false };
      if (Number.isNaN(f.amt)) pending = e; else entries.push(e);
      return;
    }

    if (!/^(paid|unpaid)\s*[.,:=\-\s]+\d/i.test(l)) {
      const sec = l.match(/^(PAID|UNPAID)\s*:?\s*(.*)$/i);
      if (sec) { flush(); ctx = sec[1].toUpperCase(); return; }
    }
    if (SUMMARY_START.test(l) || /c\s*\/?\s*n\b/i.test(l)) { flush(); parseSummary(l, declared, hints); return; }

    // a lone line of letters before any entry is the member's name ("RAJABU")
    if (!name && !entries.length && !pending && /^[A-Za-z][A-Za-z'. ]{1,40}$/.test(l) && !NOT_A_NAME.test(l)) name = l;
  });
  flush();

  // No type on the lines, but the totals only talk about one type: use it, and say so.
  if (declared.bl > 0) hints.add('BL');
  if (declared.sl > 0) hints.add('SL');
  if (hints.size === 1) {
    const only = [...hints][0];
    entries.forEach((e) => { if (e.type === '?') { e.type = only; e.inferred = true; } });
  }
  return { date, name, entries, declared, filterNote };
}

// Names from "⭕️NAME" headers of a compiled report.
export function extractNames(text) {
  const out = [];
  String(text || '').split(/\r?\n/).forEach((raw) => {
    const l = raw.replace(/[_*~]/g, '').trim();
    if (!/^\u2b55/.test(l)) return;
    const n = l.replace(/^[\u2b55\ufe0f\s]+/, '').trim();
    if (n && !/^\d/.test(n) && !out.includes(n)) out.push(n);
  });
  return out;
}

// Split pasted WhatsApp text into messages. Falls back to splitting on "Tar dd.mm.yyyy" lines.
const HEAD_DATE_FIRST = /^\[?(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?\s*\]?\s*[-–]?\s*([^:\n]{1,60}?):\s?(.*)$/;
const HEAD_TIME_FIRST = /^\[(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?,?\s+(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\]\s*([^:\n]{1,60}?):\s?(.*)$/;

function tsOf(d, mo, y, h, mi, ap) {
  const iso = dmyToIso(d, mo, y);
  if (!iso) return null;
  let hh = Number(h);
  if (ap) { const pm = /p/i.test(ap); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
  const [yy, mm, dd] = iso.split('-').map(Number);
  return new Date(yy, mm - 1, dd, hh, Number(mi)).getTime();
}

export function splitMessages(text) {
  const rawLines = String(text || '').replace(/\u200e|\u200f/g, '').split(/\r?\n/);
  const msgs = [];
  let cur = null;
  for (const line of rawLines) {
    let m = line.match(HEAD_DATE_FIRST), ts = null, sender = null, rest = '';
    if (m) { ts = tsOf(m[1], m[2], m[3], m[4], m[5], m[6]); sender = m[7].trim(); rest = m[8]; }
    else if ((m = line.match(HEAD_TIME_FIRST))) { ts = tsOf(m[4], m[5], m[6], m[1], m[2], m[3]); sender = m[7].trim(); rest = m[8]; }
    if (sender) { cur = { sender, ts, lines: [rest] }; msgs.push(cur); }
    else if (cur) cur.lines.push(line);
    else { cur = { sender: null, ts: null, lines: [line] }; msgs.push(cur); }
  }
  // Split any message holding several "Tar dd.mm.yyyy" reports.
  const out = [];
  for (const mg of msgs) {
    if (!mg.sender) { out.push(...splitBare(mg.lines)); continue; }
    const starts = [];
    mg.lines.forEach((l, i) => { if (/^[_*\s]*(tar|tarehe)\b\W*\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/i.test(l)) starts.push(i); });
    if (starts.length > 1) {
      starts.forEach((s, k) => out.push({ sender: mg.sender, ts: mg.ts, text: mg.lines.slice(s, starts[k + 1] ?? undefined).join('\n') }));
    } else out.push({ sender: mg.sender, ts: mg.ts, text: mg.lines.join('\n') });
  }
  return out;
}

// Text pasted without WhatsApp headers: cut it into one block per member.
// A new report starts at: a "Tar" date line, a lone name line, a ⭕ line, or a control number that follows a totals line.
function splitBare(lines) {
  const blocks = [];
  let cur = [], hasEntry = false, sawTotals = false;
  const push = () => { if (cur.some((l) => l.trim())) blocks.push({ sender: null, ts: null, text: cur.join('\n') }); cur = []; hasEntry = false; sawTotals = false; };
  for (const raw of lines) {
    const l = clean(raw);
    if (!l) { cur.push(raw); continue; }
    const isCn = CN_START.test(l);
    const isDate = /^(tar|tarehe)\b\W*\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/i.test(l);
    const isName = /^\u2b55/.test(l) || (/^[A-Za-z][A-Za-z'. ]{1,40}$/.test(l) && !NOT_A_NAME.test(l));
    const isTotals = /^(total|jumla|idadi|bl\b|sl\b|paid|unpaid)/i.test(l) && !/^total\s+(jana|leo)\b/i.test(l) && !/^(paid|unpaid)\s*:?\s*$/i.test(l);
    if (hasEntry && (isDate || isName || (isCn && sawTotals))) push();
    cur.push(raw);
    if (isCn) hasEntry = true;
    if (isTotals && hasEntry) sawTotals = true;
  }
  push();
  return blocks;
}

// Match a sender/name against the roster. Returns member id or null.
export function matchMember(roster, ...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    const n = normName(c);
    if (!n) continue;
    const exact = roster.filter((m) => [m.name, ...(m.aliases || [])].some((a) => normName(a) === n));
    if (exact.length === 1) return exact[0].id;
  }
  for (const c of candidates) {
    if (!c) continue;
    const ct = nameTokens(c);
    if (!ct.length) continue;
    const hits = roster.filter((m) => {
      const mt = [m.name, ...(m.aliases || [])].map(nameTokens);
      return mt.some((t) => t.length && (t.every((x) => ct.includes(x)) || ct.every((x) => t.includes(x))));
    });
    if (hits.length === 1) return hits[0].id;
  }
  return null;
}
