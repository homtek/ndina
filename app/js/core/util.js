// Small shared helpers (no DOM, runs in browser and Node).

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export function fmtNum(n) {
  const r = round2(n);
  const [i, d] = Math.abs(r).toFixed(2).split('.');
  const withCommas = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (r < 0 ? '-' : '') + (d === '00' ? withCommas : withCommas + '.' + d);
}

// "30,000.00" -> 30000 ; "200.000" -> 200000 ; "41,271.20" -> 41271.2
export function parseAmount(raw) {
  if (raw == null) return NaN;
  let s = String(raw).trim().replace(/\s+/g, '');
  if (!s) return NaN;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  return round2(parseFloat(s));
}

const pad = (n) => String(n).padStart(2, '0');

export function todayIso(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const isoToDmy = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};
export function dmyToIso(d, m, y) {
  d = Number(d); m = Number(m); y = Number(y);
  if (y < 100) y += 2000;
  if (!(d >= 1 && d <= 31 && m >= 1 && m <= 12 && y >= 2000 && y <= 2100)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return todayIso(dt);
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Normalise a person's name for matching: letters/digits only, lower case.
export const normName = (s) =>
  String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');

export const nameTokens = (s) =>
  String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export const cnOk = (cn, prefix = '99') => /^\d{12}$/.test(cn) && cn.startsWith(prefix);

// Monday of the week that holds this date (Tanzania weeks run Monday to Sunday).
export function weekStart(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7;
  return addDays(iso, -dow);
}
export const dowIndex = (iso) => { const [y, m, d] = iso.split('-').map(Number); return (new Date(y, m - 1, d).getDay() + 6) % 7; };
