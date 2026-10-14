// Reads the text that OCR extracted from a GePG "Payment Details" screenshot.
// The screen has fixed labels, so we look for labels, not for pixels.
import { parseAmount, dmyToIso } from './util.js';

const UNITS = { ZERO: 0, ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10,
  ELEVEN: 11, TWELVE: 12, THIRTEEN: 13, FOURTEEN: 14, FIFTEEN: 15, SIXTEEN: 16, SEVENTEEN: 17, EIGHTEEN: 18, NINETEEN: 19 };
const TENS = { TWENTY: 20, THIRTY: 30, FORTY: 40, FIFTY: 50, SIXTY: 60, SEVENTY: 70, EIGHTY: 80, NINETY: 90 };

// "ONE HUNDRED THOUSAND" -> 100000. Returns null when the words are not clean.
export function wordsToNumber(text) {
  let s = String(text || '').toUpperCase().replace(/[^A-Z\s-]/g, ' ').replace(/-/g, ' ');
  s = s.replace(/\s+AND\s+[A-Z\s]*CENTS?\s*$/, '').replace(/\bONLY\b/g, '');
  const tokens = s.split(/\s+/).filter(Boolean).filter((t) => t !== 'AND');
  if (!tokens.length) return null;
  let total = 0, cur = 0;
  for (const t of tokens) {
    if (t in UNITS) cur += UNITS[t];
    else if (t in TENS) cur += TENS[t];
    else if (t === 'HUNDRED') cur = (cur || 1) * 100;
    else if (t === 'THOUSAND') { total += (cur || 1) * 1000; cur = 0; }
    else if (t === 'MILLION') { total += (cur || 1) * 1000000; cur = 0; }
    else return null;
  }
  return total + cur;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function parseAnyDate(s) {
  if (!s) return null;
  let m = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*,?\s+(\d{4})/);
  if (m && MONTHS[m[1].slice(0, 3).toLowerCase()]) return dmyToIso(m[2], MONTHS[m[1].slice(0, 3).toLowerCase()], m[3]);
  m = s.match(/(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
  if (m && MONTHS[m[2].slice(0, 3).toLowerCase()]) return dmyToIso(m[1], MONTHS[m[2].slice(0, 3).toLowerCase()], m[3]);
  m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return dmyToIso(m[3], m[2], m[1]);
  m = s.match(/(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})/);
  if (m) return dmyToIso(m[1], m[2], m[3]);
  return null;
}

export function typeFromText(s) {
  if (!s) return null;
  if (/licen|busin|biashara|leseni/i.test(s)) return 'BL';
  if (/levy|serv|huduma|ushuru/i.test(s)) return 'SL';
  return null;
}

// Result: { ok, reason?, cn, amount, type, pay, recv, flags[] }
// flags: 'amount-mismatch' | 'no-words' | 'type' | 'no-date' | 'cn-prefix'
export function parseGepgText(text, { prefix = '99204' } = {}) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const flags = [];

  // Control number: value on the "Control Number" line, else any 12-digit number starting with 99.
  let cn = null;
  for (const l of lines) {
    if (/control\s*n/i.test(l)) {
      const digits = l.replace(/control\s*number|control\s*no\.?/gi, '').replace(/\D/g, '');
      if (digits.length === 12) { cn = digits; break; }
    }
  }
  if (!cn) {
    const m = text.match(/(?<!\d)99\d{10}(?!\d)/);
    if (m) cn = m[0];
  }
  if (!cn) return { ok: false, reason: 'no-control-number' };

  // Amount
  let amount = NaN, amountLine = -1;
  lines.forEach((l, i) => {
    if (!Number.isNaN(amount)) return;
    const m = l.match(/(?:T[Z2]S|TSH)\s*([\d][\d,\.\s]*)/i);
    if (m) { amount = parseAmount(m[1].replace(/[\s\.,]+$/, '')); amountLine = i; }
  });
  if (Number.isNaN(amount)) return { ok: false, reason: 'no-amount', cn };

  // Amount in words (line under the amount) must agree with the digits.
  let words = null;
  for (let k = 1; k <= 2 && amountLine + k < lines.length; k++) {
    const cand = lines.slice(amountLine + 1, amountLine + 1 + k).join(' ');
    if (/^[A-Za-z\s-]+$/.test(cand)) {
      const n = wordsToNumber(cand);
      if (n != null) { words = n; break; }
    }
  }
  if (words == null) flags.push('no-words');
  else if (Math.floor(amount) !== words) flags.push('amount-mismatch');

  // Type: "In Respect Of <value>"
  let type = null;
  const ri = lines.findIndex((l) => /respect\s*of/i.test(l));
  if (ri >= 0) {
    const same = lines[ri].replace(/.*respect\s*of/i, '').trim();
    type = typeFromText(same) || typeFromText(lines[ri + 1]);
  }
  if (!type) flags.push('type');

  // Dates
  let pay = null, recv = null;
  for (const l of lines) {
    if (/received/i.test(l)) recv = recv || parseAnyDate(l);
    else if (/payment\s*date/i.test(l)) pay = pay || parseAnyDate(l);
  }
  if (!pay) {
    const fb = lines.map(parseAnyDate).find(Boolean);
    if (fb) pay = fb;
  }
  if (!pay) flags.push('no-date');

  if (!cn.startsWith(prefix)) flags.push('cn-prefix');

  return { ok: true, cn, amount, type, pay, recv, words, flags };
}
