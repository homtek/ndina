// Pools: used (in the report) / spare (kept aside) / trash / review (needs a look).
import { round2 } from './util.js';

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

// Pick the subset whose sum is closest to (and not above) target.
// amounts: numbers. Returns { indices, sum }.
export function bestSubset(amounts, target) {
  const cents = amounts.map((a) => Math.round(a * 100));
  const T = Math.floor(target * 100);
  if (T <= 0 || !cents.length) return { indices: [], sum: 0 };
  let g = 0;
  cents.forEach((c) => { if (c > 0) g = gcd(g, c); });
  g = g || 1;
  const units = cents.map((c) => c / g);
  const size = Math.floor(T / g);

  if (size <= 20_000_000) {
    const reach = new Int32Array(size + 1); // reach[s] = (item index + 1) that first reached sum s
    reach[0] = -1;
    units.forEach((u, i) => {
      if (u > size || u <= 0) return;
      for (let s = size; s >= u; s--) {
        if (reach[s] === 0 && reach[s - u] !== 0) reach[s] = i + 1;
      }
    });
    let best = size;
    while (best > 0 && reach[best] === 0) best--;
    const indices = [];
    for (let s = best; s > 0;) { const i = reach[s] - 1; indices.push(i); s -= units[i]; }
    return { indices: indices.sort((a, b) => a - b), sum: round2((best * g) / 100) };
  }
  // Fallback for very large targets: greedy, biggest first.
  let sum = 0; const indices = [];
  units.map((u, i) => [u, i]).sort((a, b) => b[0] - a[0]).forEach(([u, i]) => { if (sum + u <= size) { sum += u; indices.push(i); } });
  return { indices: indices.sort((a, b) => a - b), sum: round2((sum * g) / 100) };
}

// filter: { type: 'ALL'|'BL'|'SL', amounts: number[], target: number|0 }
// Mutates entries' pool for those in used/spare. Returns summary.
export function applyFilter(entries, filter) {
  const pool = entries.filter((e) => e.pool === 'used' || e.pool === 'spare');
  const typeOk = (e) => !filter.type || filter.type === 'ALL' || e.type === filter.type;
  const amtOk = (e) => !filter.amounts?.length || filter.amounts.some((a) => Math.abs(a - e.amt) < 0.005);
  const eligible = pool.filter((e) => typeOk(e) && amtOk(e));
  const keep = new Set();
  let best = null;
  if (filter.target > 0) {
    const paid = eligible.filter((e) => e.status === 'PAID');
    const res = bestSubset(paid.map((e) => e.amt), filter.target);
    res.indices.forEach((i) => keep.add(paid[i].id));
    eligible.filter((e) => e.status !== 'PAID').forEach((e) => keep.add(e.id));
    best = res.sum;
  } else eligible.forEach((e) => keep.add(e.id));
  pool.forEach((e) => { e.pool = keep.has(e.id) ? 'used' : 'spare'; });
  return { best, target: filter.target || 0, used: keep.size, spare: pool.length - keep.size };
}
