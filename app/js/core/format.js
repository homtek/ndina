// Text that goes into WhatsApp. Wording lives here so a group could swap it.
import { fmtNum, isoToDmy, dowIndex } from './util.js';

export const TEMPLATE = {
  memberDate: 'Tar',
  nameLabel: 'Jina',
  title: 'TAARIFA YA SIKU',
};

const line = (e) => `${e.cn}-${fmtNum(e.amt)} ${e.type} ${e.status}`;
const sumBy = (list, f) => Math.round(list.filter(f).reduce((a, e) => a + e.amt, 0) * 100) / 100;

// A member's own report. Totals count every line in it (BL + SL, paid and unpaid).
export function memberReport({ name, date, entries }) {
  const out = [`${TEMPLATE.memberDate} ${isoToDmy(date)}`];
  if (name) out.push(`${TEMPLATE.nameLabel}: ${name}`);
  entries.forEach((e) => out.push(line(e)));
  out.push(`Total C/N:${entries.length}`);
  out.push(`Total BL: ${fmtNum(sumBy(entries, (e) => e.type === 'BL'))}`);
  out.push(`Total SL: ${fmtNum(sumBy(entries, (e) => e.type === 'SL'))}`);
  out.push(`Total Amount: ${fmtNum(sumBy(entries, () => true))}`);
  return out.join('\n');
}

export const DAYS_SW = ['Jumatatu', 'Jumanne', 'Jumatano', 'Alhamisi', 'Ijumaa', 'Jumamosi', 'Jumapili'];

// Weekly report. days: [{date, entries}] (only days that are used), mode: 'sum' | 'full'
export function weeklyReport({ name, from, to, days, emptyDates = [], mode = 'sum' }) {
  const tot = (list, type) => sumBy(list, (e) => !type || e.type === type);
  const label = (d) => `${DAYS_SW[dowIndex(d)]} ${isoToDmy(d)}`;
  const out = ['TAARIFA YA WIKI', `Wiki: ${isoToDmy(from)} - ${isoToDmy(to)}`];
  if (name) out.push(`${TEMPLATE.nameLabel}: ${name}`);
  out.push('');
  const all = [];
  days.forEach(({ date, entries }) => {
    all.push(...entries);
    if (mode === 'full') {
      out.push(label(date));
      entries.forEach((e) => out.push(line(e)));
      out.push(`Jumla ya siku: ${fmtNum(tot(entries))} (${entries.length} C/N)`, '');
    } else {
      out.push(`${label(date)}: C/N ${entries.length} | BL ${fmtNum(tot(entries, 'BL'))} | SL ${fmtNum(tot(entries, 'SL'))} | Jumla ${fmtNum(tot(entries))}`);
    }
  });
  if (mode !== 'full') out.push('');
  if (emptyDates.length) out.push(`Hakuna ripoti: ${emptyDates.map((d) => DAYS_SW[dowIndex(d)]).join(', ')}`, '');
  out.push(`Total C/N:${all.length}`);
  out.push(`Total BL: ${fmtNum(tot(all, 'BL'))}`);
  out.push(`Total SL: ${fmtNum(tot(all, 'SL'))}`);
  out.push(`Total Amount: ${fmtNum(tot(all))}`);
  return out.join('\n');
}

function memberTotalLine(m) {
  const t = m.totals;
  const paidParts = [];
  if (t.blPaid > 0) paidParts.push(`BL-${fmtNum(t.blPaid)}`);
  if (t.slPaid > 0) paidParts.push(`SL-${fmtNum(t.slPaid)}`);
  if (t.blPaid > 0 && t.slPaid > 0) paidParts.push(`Jumla-${fmtNum(t.blPaid + t.slPaid)}`);
  let s = 'Total ' + (paidParts.length ? paidParts.join(' / ') : '0') + ` (${t.cn} CN)`;
  const up = [];
  if (t.blUnpaid > 0) up.push(`BL-${fmtNum(t.blUnpaid)}`);
  if (t.slUnpaid > 0) up.push(`SL-${fmtNum(t.slUnpaid)}`);
  if (up.length) s += ` / UNPAID ${up.join(' / ')}`;
  return s;
}

export function compiledReport({ title, date, result }) {
  const d = isoToDmy(date);
  const out = [`_🔲${title || TEMPLATE.title}_`, `_Tarehe: ${d}_`, ''];
  result.members.filter((m) => m.hasReport).forEach((m) => {
    out.push(`⭕️${m.member.name.toUpperCase()}`);
    out.push('_PAID:_');
    m.paid.forEach((e) => out.push(`${e.cn}-${fmtNum(e.amt)} ${e.type}`));
    if (m.unpaid.length) {
      out.push('_UNPAID:_');
      m.unpaid.forEach((e) => out.push(`${e.cn}-${fmtNum(e.amt)} ${e.type}`));
    } else out.push('_UNPAID:_ 0');
    out.push(memberTotalLine(m));
    out.push('');
  });
  const t = result.totals;
  const paid = t.blPaid + t.slPaid, unpaid = t.blUnpaid + t.slUnpaid;
  out.push(`_TOTAL PAID ${d}_`);
  out.push(`BL PAID: ${fmtNum(t.blPaid)}=/`);
  out.push(`SL PAID: ${fmtNum(t.slPaid)}=/`);
  out.push(`*JUMLA PAID: ${fmtNum(paid)}=/*`);
  out.push('');
  out.push(`_TOTAL UNPAID ${d}_`);
  out.push(`BL UNPAID: ${fmtNum(t.blUnpaid)}=/`);
  out.push(`SL UNPAID: ${fmtNum(t.slUnpaid)}=/`);
  out.push(`*JUMLA UNPAID: ${fmtNum(unpaid)}=/*`);
  out.push('');
  out.push(`_JUMLA KUU YA SIKU ${d} (PAID + UNPAID):_`);
  out.push(`BL: ${fmtNum(t.blPaid + t.blUnpaid)}/=`);
  out.push(`SL: ${fmtNum(t.slPaid + t.slUnpaid)}/=`);
  out.push(`*JUMLA KUU: ${fmtNum(paid + unpaid)}/=*`);
  if (result.missing.length) {
    out.push('');
    out.push(`_Hawajawasilisha: ${result.missing.map((m) => m.name).join(', ')}_`);
  }
  return out.join('\n');
}

// One sentence per issue, from the point of view of the member it is about.
export function issueText(issue, nameOf, lang = 'sw') {
  const d = issue.data || {};
  const sw = lang === 'sw';
  const who = (id) => nameOf(id);
  switch (issue.kind) {
    case 'dup': {
      const others = d.claims.filter((c) => c.memberId !== issue.memberId).map((c) => who(c.memberId));
      const amt = fmtNum(d.claims[0].amt);
      if (d.winner === issue.memberId) return sw ? `${issue.cn} (${amt}) imeripotiwa pia na ${others.join(', ')}. Imehesabiwa kwako.` : `${issue.cn} (${amt}) was also reported by ${others.join(', ')}. Counted for you.`;
      return sw ? `${issue.cn} (${amt}) imeripotiwa pia na ${others.join(', ')}. Imehesabiwa kwa ${d.winner ? who(d.winner) : 'hakuna'}, imeondolewa kwako.` : `${issue.cn} (${amt}) was also reported by ${others.join(', ')}. Counted for ${d.winner ? who(d.winner) : 'nobody'}, removed from yours.`;
    }
    case 'conflict': {
      const parts = d.claims.map((c) => `${who(c.memberId)} ${fmtNum(c.amt)} ${c.type} ${c.status}`).join(' / ');
      return sw ? `${issue.cn} imeripotiwa tofauti: ${parts}. Hakikisheni kwenye screenshot.` : `${issue.cn} reported differently: ${parts}. Check the screenshot.`;
    }
    case 'within': return sw ? `${issue.cn} imeandikwa zaidi ya mara moja kwenye ripoti yako. Imehesabiwa mara moja.` : `${issue.cn} appears more than once in your report. Counted once.`;
    case 'cnformat': return sw ? `${issue.cn} si control number sahihi (tarakimu 12). Imeondolewa.` : `${issue.cn} is not a valid control number (12 digits). Left out.`;
    case 'noamount': return sw ? `${issue.cn} haina kiasi. Imeondolewa.` : `${issue.cn} has no amount. Left out.`;
    case 'inferred': return sw ? `Mistari ${d.n} haina aina. Imechukuliwa kuwa ${d.type} kutoka kwenye jumla. Andika ${d.type} kwenye kila mstari.` : `${d.n} lines had no type. Taken as ${d.type} from your totals. Write ${d.type} on each line.`;
    case 'type': return sw ? `${issue.cn} haina aina (BL au SL). Imeondolewa.` : `${issue.cn} has no type (BL or SL). Left out.`;
    case 'count': return sw ? `Umeandika Total C/N:${d.declared} lakini mistari ni ${d.actual}.` : `You wrote Total C/N:${d.declared} but there are ${d.actual} lines.`;
    case 'sum': { const w = issue.what === 'TOTAL' ? 'Amount' : issue.what === 'PAID' ? 'Paid' : issue.what === 'UNPAID' ? 'Unpaid' : issue.what; return sw ? `Total ${w} uliyoandika ni ${fmtNum(d.declared)}, mistari inajumlisha ${fmtNum(d.actual)}.` : `Your Total ${w} says ${fmtNum(d.declared)} but the lines add up to ${fmtNum(d.actual)}.`; }
    case 'date': return sw ? `Ripoti ni ya tarehe ${isoToDmy(d.date)}, si ya siku hii.` : `Report is dated ${isoToDmy(d.date)}, not this day.`;
    case 'carry': return sw ? `Mistari ${d.n} za jana zimeondolewa (${d.cns.slice(0, 3).join(', ')}${d.n > 3 ? '…' : ''}).` : `${d.n} yesterday lines were left out (${d.cns.slice(0, 3).join(', ')}${d.n > 3 ? '…' : ''}).`;
    default: return issue.kind;
  }
}

export function correctionsMessage({ date, title, result, lang = 'sw' }) {
  const nameOf = (id) => result.members.find((m) => m.member.id === id)?.member.name.toUpperCase() ?? '?';
  const open = result.issues;
  const out = [`_🔲MAREKEBISHO – ${title || TEMPLATE.title}_`, `_Tarehe: ${isoToDmy(date)}_`, ''];
  out.push('Tafadhali hakikisheni kwenye screenshot zenu, kisha mtume ripoti iliyosahihishwa.', '');
  let any = false;
  result.members.forEach((m) => {
    const list = open.filter((i) => i.memberId === m.member.id);
    if (!list.length) return;
    any = true;
    out.push(`⭕️${m.member.name.toUpperCase()}`);
    list.forEach((i) => out.push(`• ${issueText(i, nameOf, lang)}`));
    out.push('');
  });
  if (result.missing.length) { any = true; out.push(`_Bado kuwasilisha: ${result.missing.map((m) => m.name).join(', ')}_`); }
  if (!any) out.push('Hakuna makosa. ✅');
  return out.join('\n').trim();
}
