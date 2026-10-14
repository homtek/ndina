// Reads WhatsApp report text written by members (and the leader's old compiled format).
import { parseAmount, dmyToIso, nameTokens, normName } from './util.js';

const clean = (l) => l.replace(/[_*~]/g, '').replace(/\u200e|\u200f/g, '').trim();
const ENTRY = /(?<!\d)(\d{9,14})(?!\d)\s*[-–—:=]\s*(\d[\d,\.]*)\s*(BL|SL)?\b\s*(UNPAID|PAID)?/i;

function parseDeclared(line, declared) {
  const l = clean(line);
  if (!/^(total|jumla)/i.test(l)) return;
  const grab = (re) => { const m = l.match(re); return m ? parseAmount(m[1]) : NaN; };
  let m = l.match(/c\s*\/?\s*n\s*[:\-=]?\s*(\d+)/i) || l.match(/\(\s*(\d+)\s*c\s*n\s*\)/i);
  if (m) declared.count = Number(m[1]);
  let v = grab(/\bBL\s*(?:PAID)?\s*[-:=]\s*([\d,\.]+)/i); if (!Number.isNaN(v)) declared.bl = v;
  v = grab(/\bSL\s*(?:PAID)?\s*[-:=]\s*([\d,\.]+)/i); if (!Number.isNaN(v)) declared.sl = v;
  v = grab(/(?:total\s*amount|jumla)\s*(?:paid)?\s*[-:=]\s*([\d,\.]+)/i); if (!Number.isNaN(v)) declared.total = v;
}

// Parse ONE report's text.
export function parseReport(text) {
  const entries = [];
  const declared = {};
  let date = null, name = null, filterNote = null;
  let ctx = 'PAID';
  let blockStart = 0;
  const lines = String(text || '').split(/\r?\n/);
  lines.forEach((raw) => {
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
    if (/^total\s+jana\b/i.test(l)) { for (let i = blockStart; i < entries.length; i++) entries[i].carry = true; blockStart = entries.length; return; }
    if (/^total\s+leo\b/i.test(l)) { blockStart = entries.length; return; }
    let m = l.match(/^(PAID|UNPAID)\s*:?\s*(.*)$/i);
    if (m) { ctx = m[1].toUpperCase(); return; }
    const em = l.match(ENTRY);
    if (em) {
      entries.push({
        cn: em[1], amt: parseAmount(em[2]), type: em[3] ? em[3].toUpperCase() : '?',
        status: em[4] ? em[4].toUpperCase() : ctx, carry: false,
      });
      return;
    }
    parseDeclared(l, declared);
  });
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
    const starts = [];
    mg.lines.forEach((l, i) => { if (/^[_*\s]*(tar|tarehe)\b\W*\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4}/i.test(l)) starts.push(i); });
    if (starts.length > 1) {
      starts.forEach((s, k) => out.push({ sender: mg.sender, ts: mg.ts, text: mg.lines.slice(s, starts[k + 1] ?? undefined).join('\n') }));
    } else out.push({ sender: mg.sender, ts: mg.ts, text: mg.lines.join('\n') });
  }
  return out;
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
