// Leader side: combine every member's latest report, find mistakes, count what is left.
import { parseReport } from './reportparse.js';
import { cnOk, round2 } from './util.js';

const stamp = (r) => (r.ts ?? r.addedAt ?? 0);

// Latest report per member (corrected reports replace older ones).
export function currentReports(roster, reports) {
  const byMember = new Map();
  for (const r of reports) {
    if (!r.memberId) continue;
    const prev = byMember.get(r.memberId);
    if (!prev || stamp(r) >= stamp(prev)) byMember.set(r.memberId, r);
  }
  return byMember;
}

const sameClaim = (a, b) => a.amt === b.amt && a.type === b.type && a.status === b.status;

/**
 * session: { reports[], resolutions{cn:memberId|'none'}, ack:boolean, force{reportId:true} }
 * returns { members[], issues[], totals, blocking, missing[], unassigned[] }
 */
export function compile({ roster, session, date, prefix = '99' }) {
  const reports = (session.reports || []).map((r) => ({ ...r, parsed: r.parsed || parseReport(r.text) }));
  const current = currentReports(roster, reports);
  const unassigned = reports.filter((r) => !r.memberId);
  const issues = [];
  const addIssue = (i) => { issues.push({ resolved: false, severity: 'warn', ...i, id: `${i.kind}:${i.memberId}:${i.cn || ''}:${i.what || ''}` }); };

  const rosterIdx = new Map(roster.map((m, i) => [m.id, i]));
  const claims = new Map(); // cn -> [{memberId, entry, order}]
  const perMember = new Map();

  for (const m of roster) {
    const rep = current.get(m.id);
    if (!rep) { perMember.set(m.id, { member: m, report: null, entries: [] }); continue; }
    const p = rep.parsed;
    const entries = [];
    let excluded = false;

    if (p.date && p.date !== date && !session.force?.[rep.id]) {
      excluded = true;
      addIssue({ kind: 'date', memberId: m.id, severity: 'error', data: { date: p.date, reportId: rep.id } });
    }

    const carry = p.entries.filter((e) => e.carry);
    if (carry.length) addIssue({ kind: 'carry', memberId: m.id, data: { n: carry.length, cns: carry.map((e) => e.cn) } });

    const seen = new Set();
    const live = p.entries.filter((e) => !e.carry);
    for (const e of live) {
      if (!cnOk(e.cn, prefix) || Number.isNaN(e.amt)) {
        addIssue({ kind: 'cnformat', memberId: m.id, severity: 'error', cn: e.cn, data: { amt: e.amt } });
        continue;
      }
      if (e.type !== 'BL' && e.type !== 'SL') {
        addIssue({ kind: 'type', memberId: m.id, severity: 'error', cn: e.cn });
        continue;
      }
      if (seen.has(e.cn)) { addIssue({ kind: 'within', memberId: m.id, cn: e.cn }); continue; }
      seen.add(e.cn);
      entries.push(e);
    }

    // Declared totals versus the lines.
    const d = p.declared || {};
    const sum = (list, f) => round2(list.filter(f).reduce((a, e) => a + e.amt, 0));
    const paid = entries.filter((e) => e.status === 'PAID');
    if (d.count != null && d.count !== live.length) addIssue({ kind: 'count', memberId: m.id, data: { declared: d.count, actual: live.length } });
    const chk = (what, declared, f) => {
      if (declared == null) return;
      const a = sum(paid, f), b = sum(entries, f);
      if (Math.abs(declared - a) > 0.5 && Math.abs(declared - b) > 0.5) addIssue({ kind: 'sum', memberId: m.id, what, data: { declared, actual: a } });
    };
    chk('BL', d.bl, (e) => e.type === 'BL');
    chk('SL', d.sl, (e) => e.type === 'SL');
    chk('TOTAL', d.total, () => true);

    perMember.set(m.id, { member: m, report: rep, entries, excluded });
    if (!excluded) entries.forEach((e) => {
      if (!claims.has(e.cn)) claims.set(e.cn, []);
      claims.get(e.cn).push({ memberId: m.id, entry: e, t: stamp(rep), order: rosterIdx.get(m.id) });
    });
  }

  // Same control number reported by more than one member.
  const keep = new Map(); // `${memberId}|${cn}` -> true when kept
  for (const [cn, list] of claims) {
    const members = [...new Set(list.map((c) => c.memberId))];
    const sorted = [...list].sort((a, b) => a.t - b.t || a.order - b.order);
    if (members.length === 1) { keep.set(`${members[0]}|${cn}`, true); continue; }
    const first = sorted[0];
    const differs = list.some((c) => !sameClaim(c.entry, first.entry));
    const res = session.resolutions?.[cn];
    let winner = null;
    if (res && res !== 'none' && members.includes(res)) winner = res;
    else if (res === 'none') winner = null;
    else if (!differs) winner = first.memberId;
    else if (session.ack) winner = first.memberId;
    const resolved = !!res || !differs || !!session.ack;
    list.forEach((c) => { if (c.memberId === winner && !keep.has(`${c.memberId}|${cn}`)) keep.set(`${c.memberId}|${cn}`, true); });
    const data = { cn, winner, claims: list.map((c) => ({ memberId: c.memberId, amt: c.entry.amt, type: c.entry.type, status: c.entry.status })) };
    for (const mid of members) {
      addIssue({ kind: differs ? 'conflict' : 'dup', memberId: mid, cn, severity: differs && !resolved ? 'error' : 'warn', resolved, data });
    }
  }

  // Final lists + totals
  const totals = { blPaid: 0, slPaid: 0, blUnpaid: 0, slUnpaid: 0, cn: 0 };
  const members = roster.map((m) => {
    const pm = perMember.get(m.id);
    const kept = pm.entries.filter((e) => keep.get(`${m.id}|${e.cn}`));
    const paid = kept.filter((e) => e.status === 'PAID');
    const unpaid = kept.filter((e) => e.status === 'UNPAID');
    const s = (l, t) => round2(l.filter((e) => e.type === t).reduce((a, e) => a + e.amt, 0));
    const t = { blPaid: s(paid, 'BL'), slPaid: s(paid, 'SL'), blUnpaid: s(unpaid, 'BL'), slUnpaid: s(unpaid, 'SL'), cn: kept.length };
    totals.blPaid += t.blPaid; totals.slPaid += t.slPaid; totals.blUnpaid += t.blUnpaid; totals.slUnpaid += t.slUnpaid; totals.cn += t.cn;
    return { member: m, report: pm.report, hasReport: !!pm.report, paid, unpaid, totals: t, filterNote: pm.report?.parsed?.filterNote || null };
  });
  Object.keys(totals).forEach((k) => { totals[k] = round2(totals[k]); });

  // A conflict is one decision even when it touches two members.
  const blocking = new Set(issues.filter((i) => i.severity === 'error' && !i.resolved && !session.ack)
    .map((i) => (i.kind === 'conflict' ? `conflict:${i.cn}` : i.id))).size;
  return {
    members, issues, totals, blocking, unassigned,
    missing: members.filter((m) => !m.hasReport).map((m) => m.member),
  };
}
