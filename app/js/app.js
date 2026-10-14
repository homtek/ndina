import { S, save, saveNow, replaceState, resetAll, reportDate, storageError, qClear } from './store.js';
import { CONFIG } from './config.js';
import { t, setLang, lang } from './i18n.js';
import { esc, fmtNum, isoToDmy, parseAmount, uid, cnOk, round2, todayIso } from './core/util.js';
import { applyFilter } from './core/pools.js';
import { memberReport, compiledReport, correctionsMessage, issueText } from './core/format.js';
import { parseReport, splitMessages, extractNames, matchMember } from './core/reportparse.js';
import { compile } from './core/compile.js';
import { verifyCode } from './core/license.js';
import * as OCR from './ocr.js';
import { copyText, shareWhatsApp, download } from './share.js';

// ---------- UI state (not saved) ----------
const ui = {
  tab: 'report', pool: 'used', openId: null, adding: false, filterOpen: false,
  failed: [], dupCount: 0, pending: 0,
  fType: 'ALL', fAmounts: '', fTarget: '', fResult: null,
  lTab: 'receive', paste: '', rosterPaste: '', code: '', codeErr: '', unlockedUntil: null,
  preview: false, showHelp: false, toastMsg: '', license: null, rosterImport: null, newName: '',
};

const $ = (s, r = document) => r.querySelector(s);
const main = () => $('#view');
const prefix = () => S.settings.prefix || CONFIG.controlPrefix;

// ---------- helpers ----------
let toastTimer;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
const sorted = (list) => [...list].sort((a, b) => a.added - b.added);
const poolOf = (p) => sorted(S.entries.filter((e) => e.pool === p));
const paidSum = (list, type) => round2(list.filter((e) => e.status === 'PAID' && (!type || e.type === type)).reduce((a, e) => a + e.amt, 0));
const dateMismatch = (e) => e.status === 'PAID' && e.pay && e.pay !== reportDate();

function session() {
  const d = reportDate();
  const L = S.leader;
  if (!L.sessions[d]) {
    L.sessions[d] = { reports: [], resolutions: {}, ack: false, force: {} };
    const keys = Object.keys(L.sessions).sort();
    while (keys.length > 10) delete L.sessions[keys.shift()];
  }
  return L.sessions[d];
}

function reclass() {
  const d = reportDate();
  S.entries.forEach((e) => {
    if (e.auto === 'date' && e.pay === d && e.pool === 'spare') { e.pool = 'used'; e.auto = null; }
    else if (!e.manual && e.pool === 'used' && dateMismatch(e)) { e.pool = 'spare'; e.auto = 'date'; }
  });
}

// ---------- OCR results -> entries ----------
function ingest(res, name) {
  if (!res.ok) { ui.failed.push({ name, reason: res.reason }); return; }
  const date = reportDate();
  const existing = S.entries.find((e) => e.cn === res.cn);
  if (existing && existing.amt === res.amount) { ui.dupCount++; return; }
  const flags = res.flags.filter((f) => f !== 'no-words');
  if (existing) flags.push('exists');
  const e = {
    id: uid(), cn: res.cn, amt: res.amount, type: res.type || '?', status: 'PAID', pay: res.pay, recv: res.recv,
    words: res.words ?? null, pool: 'used', flags, auto: null, manual: false, src: 'ocr', added: Date.now() + S.entries.length,
  };
  if (flags.length) e.pool = 'review';
  else if (res.pay !== date) { e.pool = 'spare'; e.auto = 'date'; }
  S.entries.push(e);
}

let renderTimer = null;
function renderSoon() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    const a = document.activeElement;
    if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && main().contains(a)) { updateQueueBar(); return; }
    render();
  }, 700);
}
function updateQueueBar() {
  const el = $('#qtext'); if (!el) return;
  el.textContent = t('reading', { done: OCR.progress.done, total: OCR.progress.total });
  const b = $('#qbar'); if (b) b.value = OCR.progress.total ? OCR.progress.done / OCR.progress.total : 0;
}

async function startOcr() {
  if (OCR.progress.running) return;
  ui.pending = await OCR.pendingCount();
  if (!ui.pending) return render();
  await OCR.run({
    prefix: prefix(),
    onItem: (res, name) => { ingest(res, name); save(); },
    onProgress: () => { renderSoon(); },
  });
  ui.pending = await OCR.pendingCount();
  saveNow(); render();
  if (OCR.progress.engineError) toast(t('engineError'));
}

// ---------- templates ----------
function header() {
  const d = reportDate();
  const custom = !!S.settings.dateOverride && S.settings.dateOverride !== todayIso();
  return `<header class="top">
    <div class="brand">Ndina</div>
    <label class="date ${custom ? 'custom' : ''}"><span>${isoToDmy(d)}</span><input type="date" id="dateInput" value="${d}" aria-label="${t('date')}"></label>
  </header>`;
}

const ICON = {
  report: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
  leader: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  more: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
};
function nav() {
  const items = [['report', t('navReport')], ['leader', t('navLeader')], ['more', t('navMore')]];
  return items.map(([k, label]) => `<button data-act="tab" data-v="${k}" class="${ui.tab === k ? 'on' : ''}"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg><span>${label}</span></button>`).join('');
}

function sumBlock(total, bl, sl, count, extra = '') {
  return `<section class="sum"><div class="eyebrow">${t('totalToday')}</div>
    <div class="figure"><small>TZS</small>${fmtNum(total)}</div>
    <div class="figmeta">${t('cn', { n: count })}</div>
    <div class="split"><div><span>BL</span><b>${fmtNum(bl)}</b></div><div><span>SL</span><b>${fmtNum(sl)}</b></div></div>${extra}</section>`;
}

const seg = (name, value, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button type="button" data-act="${name}" data-v="${v}" class="${value === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;

// ----- member report -----
function viewReport() {
  const used = poolOf('used'), spare = poolOf('spare'), trash = poolOf('trash'), review = poolOf('review');
  const paid = paidSum(used), bl = paidSum(used, 'BL'), sl = paidSum(used, 'SL');
  const unpaid = used.filter((e) => e.status === 'UNPAID');
  const mism = used.filter(dateMismatch).length;
  const text = used.length ? memberReport({ name: S.settings.name, date: reportDate(), entries: used }) : '';
  const list = ui.pool === 'used' ? used : ui.pool === 'spare' ? spare : trash;
  const running = OCR.progress.running;
  const pending = ui.pending;

  let h = '';
  if (!S.settings.name) {
    h += `<section class="card"><h2>${t('yourName')}</h2><p class="muted">${t('yourNameHint')}</p>
      <div class="row"><input id="nameInput" type="text" autocomplete="name" placeholder="AMOS KAPUNGU"><button class="btn primary" data-act="saveName">${t('save')}</button></div></section>`;
  }

  h += `<section class="card add">
    <label class="btn primary big" for="files">${t('pickShots')}</label>
    <input id="files" type="file" accept="image/*" multiple hidden>
    <button class="link" data-act="manual">${t('typeManually')}</button>
  </section>`;

  if (running || pending) {
    h += `<section class="card queue">
      <div class="row between"><b id="qtext">${running ? t('reading', { done: OCR.progress.done, total: OCR.progress.total }) : t('waiting', { n: pending })}</b>
      ${running ? `<button class="link" data-act="pause">${t('pause')}</button>` : `<button class="btn" data-act="resume">${t('resume')}</button>`}</div>
      ${running ? `<progress id="qbar" max="1" value="${OCR.progress.total ? OCR.progress.done / OCR.progress.total : 0}"></progress><p class="muted small">${t('keepOpen')}</p>` : ''}
    </section>`;
  }
  if (ui.dupCount) h += `<p class="note">${t('dupSkipped', { n: ui.dupCount })} <button class="link" data-act="clearDup">${t('close')}</button></p>`;
  if (ui.failed.length) {
    h += `<section class="card warn"><div class="row between"><b>${t('failedTitle', { n: ui.failed.length })}</b><button class="link" data-act="clearFailed">${t('close')}</button></div>
      <ul class="plain">${ui.failed.slice(0, 8).map((f) => `<li>${esc(f.name)} <span class="muted">${t('fail.' + f.reason)}</span></li>`).join('')}</ul>
      ${ui.failed.length > 8 ? `<p class="muted small">+${ui.failed.length - 8}</p>` : ''}<p class="muted small">${t('failedHint')}</p></section>`;
  }
  if (ui.adding) h += manualForm();

  if (review.length) {
    h += `<section class="card"><h2>${t('reviewTitle', { n: review.length })}</h2><p class="muted small">${t('reviewHint')}</p>
      ${review.map((e) => reviewCard(e)).join('')}</section>`;
  }

  h += sumBlock(paid, bl, sl, used.length, `${unpaid.length ? `<p class="note">${t('unpaid')}: <b>${fmtNum(unpaid.reduce((x, e) => x + e.amt, 0))}</b></p>` : ''}
    ${mism ? `<p class="note warnline">${t('dateMismatchNote', { n: mism })}</p>` : ''}
    ${storageError ? `<p class="note warnline">${t('storageFull')}</p>` : ''}`);

  h += `<details class="card filter" ${ui.filterOpen ? 'open' : ''}><summary data-act="toggleFilter">${t('filterTitle')}${S.filter ? ` <span class="tag on">${t('active')}</span>` : ''}</summary>
    <div class="stack">
      <div><span class="lbl">${t('fType')}</span>${seg('fType', ui.fType, [['ALL', t('both')], ['BL', 'BL'], ['SL', 'SL']])}</div>
      <label class="field"><span class="lbl">${t('fAmounts')}</span><input id="fAmounts" inputmode="numeric" placeholder="100000, 80000" value="${esc(ui.fAmounts)}"></label>
      <label class="field"><span class="lbl">${t('fTarget')}</span><input id="fTarget" inputmode="numeric" placeholder="1000000" value="${esc(ui.fTarget)}"></label>
      <p class="muted small">${t('filterHint')}</p>
      ${ui.fResult ? `<p class="note">${ui.fResult}</p>` : ''}
      <div class="row"><button class="btn primary" data-act="applyFilter">${t('apply')}</button><button class="btn" data-act="resetFilter">${t('resetAll')}</button></div>
    </div></details>`;

  h += `<div class="tabs">${[['used', t('poolUsed'), used.length], ['spare', t('poolSpare'), spare.length], ['trash', t('poolTrash'), trash.length]]
    .map(([k, l, n]) => `<button data-act="pool" data-v="${k}" class="${ui.pool === k ? 'on' : ''}">${l} <span>${n}</span></button>`).join('')}</div>`;
  if (ui.pool === 'spare' && spare.length) h += `<div class="row bulk"><button class="link" data-act="restoreSpare">${t('restoreAll')}</button></div>`;
  if (ui.pool === 'trash' && trash.length) h += `<div class="row bulk"><button class="link danger" data-act="emptyTrash">${t('emptyTrash')}</button></div>`;
  h += list.length ? `<ul class="entries">${list.map((e) => entryRow(e)).join('')}</ul>` : `<p class="empty">${t('empty.' + ui.pool)}</p>`;

  if (used.length) {
    h += `<details class="preview"><summary>${t('seeMessage')}</summary><pre>${esc(text)}</pre></details>`;
  }
  h += `<div class="actionbar"><button class="btn primary" data-act="shareMine" ${used.length ? '' : 'disabled'}>${t('sendWa')}</button><button class="btn" data-act="copyMine" ${used.length ? '' : 'disabled'}>${t('copy')}</button></div>`;
  return h;
}

function manualForm() {
  return `<section class="card"><h2>${t('manualTitle')}</h2><div class="stack">
    <label class="field"><span class="lbl">${t('control')}</span><input id="mCn" inputmode="numeric" maxlength="12" placeholder="992041400527"></label>
    <label class="field"><span class="lbl">${t('amount')}</span><input id="mAmt" inputmode="decimal" placeholder="80000"></label>
    <div><span class="lbl">${t('type')}</span><select id="mType"><option>BL</option><option>SL</option></select></div>
    <div><span class="lbl">${t('status')}</span><select id="mStatus"><option value="PAID">PAID</option><option value="UNPAID">UNPAID</option></select></div>
    <div class="row"><button class="btn primary" data-act="addManual">${t('add')}</button><button class="btn" data-act="manual">${t('cancel')}</button></div></div></section>`;
}

function entryForm(e, accept) {
  return `<div class="stack edit" data-id="${e.id}">
    <label class="field"><span class="lbl">${t('control')}</span><input data-f="cn" inputmode="numeric" maxlength="12" value="${esc(e.cn)}"></label>
    <label class="field"><span class="lbl">${t('amount')}</span><input data-f="amt" inputmode="decimal" value="${e.amt}"></label>
    <div class="row"><select data-f="type"><option ${e.type === 'BL' ? 'selected' : ''}>BL</option><option ${e.type === 'SL' ? 'selected' : ''}>SL</option><option value="?" ${e.type === '?' ? 'selected' : ''}>?</option></select>
    <select data-f="status"><option ${e.status === 'PAID' ? 'selected' : ''}>PAID</option><option ${e.status === 'UNPAID' ? 'selected' : ''}>UNPAID</option></select></div>
    <div class="row"><button class="btn primary" data-act="${accept ? 'accept' : 'saveEdit'}" data-id="${e.id}">${accept ? t('accept') : t('save')}</button>
    ${accept ? `<button class="btn" data-act="toTrash" data-id="${e.id}">${t('discard')}</button>` : `<button class="btn" data-act="edit" data-id="${e.id}">${t('cancel')}</button>`}</div></div>`;
}

function flagText(e, f) {
  if (f === 'amount-mismatch') return t('flag.amount-mismatch', { digits: fmtNum(e.amt), words: e.words != null ? fmtNum(e.words) : '?' });
  if (f === 'exists') return t('flag.exists', { amt: fmtNum(S.entries.find((x) => x.cn === e.cn && x.id !== e.id)?.amt ?? 0) });
  return t('flag.' + f);
}

function reviewCard(e) {
  return `<div class="review"><div class="flags">${e.flags.map((f) => `<span class="flagline">${esc(flagText(e, f))}</span>`).join('')}</div>${entryForm(e, true)}</div>`;
}

function entryRow(e) {
  const open = ui.openId === e.id;
  const sub = [];
  if (e.pay) sub.push(isoToDmy(e.pay));
  if (dateMismatch(e)) sub.push(`<b class="bad">${t('otherDate')}</b>`);
  if (e.status === 'UNPAID') sub.push(`<b class="bad">UNPAID</b>`);
  if (e.src === 'manual') sub.push(t('typed'));
  let acts = '';
  if (open) {
    if (ui.editing === e.id) acts = entryForm(e, false);
    else acts = `<div class="row acts">
      <button class="btn sm" data-act="edit" data-id="${e.id}">${t('edit')}</button>
      ${e.pool !== 'used' ? `<button class="btn sm" data-act="toUsed" data-id="${e.id}">${t('toReport')}</button>` : ''}
      ${e.pool === 'used' ? `<button class="btn sm" data-act="toSpare" data-id="${e.id}">${t('toSpare')}</button>` : ''}
      ${e.pool !== 'trash' ? `<button class="btn sm" data-act="toTrash" data-id="${e.id}">${t('discard')}</button>` : ''}</div>`;
  }
  return `<li class="entry ${open ? 'open' : ''}"><button class="entryhead" data-act="open" data-id="${e.id}">
    <span class="cn">${esc(e.cn)}<small>${sub.join(' · ')}</small></span>
    <span class="amt">${fmtNum(e.amt)}<small class="tag ${e.type}">${e.type}</small></span></button>${acts}</li>`;
}

// ----- leader -----
function viewLeader() {
  const lic = ui.license;
  if (!lic) {
    return `<section class="card"><h2>${t('leaderTitle')}</h2><p class="muted">${t('leaderLocked')}</p>
      <label class="field"><span class="lbl">${t('code')}</span><textarea id="codeInput" rows="3" placeholder="NDN1.…">${esc(ui.code)}</textarea></label>
      ${ui.codeErr ? `<p class="note warnline">${esc(ui.codeErr)}</p>` : ''}
      <button class="btn primary" data-act="unlock">${t('unlock')}</button></section>`;
  }
  const days = Math.ceil((new Date(lic.e + 'T23:59:59') - new Date()) / 86400000);
  let h = `<section class="leaderhead"><div><b>${esc(lic.g)}</b><div class="muted small">${esc(lic.t || '')}</div></div>
    <div class="muted small right">${t('validUntil', { d: isoToDmy(lic.e) })}${days <= 14 ? ` <b class="bad">(${t('daysLeft', { n: days })})</b>` : ''}</div></section>`;
  h += `<div class="tabs sub">${[['receive', t('lReceive')], ['issues', t('lIssues')], ['final', t('lFinal')], ['roster', t('lRoster')]]
    .map(([k, l]) => `<button data-act="ltab" data-v="${k}" class="${ui.lTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const roster = S.leader.roster;
  if (!roster.length && ui.lTab !== 'roster') {
    return h + `<section class="card"><p>${t('needRoster')}</p><button class="btn primary" data-act="ltab" data-v="roster">${t('lRoster')}</button></section>`;
  }
  const res = compile({ roster, session: session(), date: reportDate(), prefix: prefix() });
  if (ui.lTab === 'receive') h += leaderReceive(res);
  else if (ui.lTab === 'issues') h += leaderIssues(res);
  else if (ui.lTab === 'final') h += leaderFinal(res);
  else h += leaderRoster();
  return h;
}

function leaderReceive(res) {
  const s = session();
  let h = `<section class="card"><h2>${t('pasteTitle')}</h2><p class="muted small">${t('pasteHint')}</p>
    <textarea id="pasteBox" rows="6" placeholder="[10:41, ${isoToDmy(reportDate()).replaceAll('.', '/')}] AMOS: Tar ${isoToDmy(reportDate())}…">${esc(ui.paste)}</textarea>
    <button class="btn primary" data-act="readPaste">${t('readReports')}</button></section>`;
  if (res.unassigned.length) {
    h += `<section class="card"><h2>${t('whoseTitle')}</h2>${res.unassigned.map((r) => `<div class="unas">
      <div class="small"><b>${esc(r.parsed.name || r.sender || t('noSender'))}</b> · ${t('cn', { n: r.parsed.entries.length })} · ${fmtNum(round2(r.parsed.entries.filter((e) => e.status !== 'UNPAID' && !Number.isNaN(e.amt)).reduce((a, e) => a + e.amt, 0)))}</div>
      <div class="muted small mono">${esc(r.parsed.entries[0]?.cn || '')}…</div>
      <div class="chips">${S.leader.roster.map((m) => `<button class="chip" data-act="assign" data-r="${r.id}" data-m="${m.id}">${esc(m.name)}</button>`).join('')}
      <button class="chip danger" data-act="dropReport" data-r="${r.id}">${t('remove')}</button></div></div>`).join('')}</section>`;
  }
  h += `<section class="card"><h2>${t('statusTitle')}</h2><ul class="plain status">${res.members.map((m) => {
    const hist = s.reports.filter((r) => r.memberId === m.member.id).length;
    return `<li><span>${esc(m.member.name)}${m.filterNote ? `<small class="warnline">${esc(m.filterNote)}</small>` : ''}</span>
      ${m.hasReport ? `<span class="ok">${t('cn', { n: m.report.parsed.entries.filter((e) => !e.carry).length })}${hist > 1 ? ` · v${hist}` : ''}</span>` : `<span class="bad">${t('still')}</span>`}</li>`;
  }).join('')}</ul>
    <button class="link danger" data-act="newDay">${t('clearDay')}</button></section>`;
  return h;
}

function leaderIssues(res) {
  const nameOf = (id) => S.leader.roster.find((m) => m.id === id)?.name.toUpperCase() ?? '?';
  const conflicts = [...new Map(res.issues.filter((i) => i.kind === 'conflict').map((i) => [i.cn, i])).values()];
  let h = `<section class="card"><h2>${res.blocking ? t('needDecision', { n: res.blocking }) : t('noOpen')}</h2>`;
  conflicts.forEach((i) => {
    const d = i.data; const chosen = session().resolutions[i.cn];
    h += `<div class="conf"><div class="cn mono">${i.cn}</div>
      <div class="chips">${d.claims.map((c) => `<button class="chip ${chosen === c.memberId ? 'on' : ''}" data-act="resolve" data-cn="${i.cn}" data-m="${c.memberId}">${esc(nameOf(c.memberId))}: ${fmtNum(c.amt)} ${c.type}</button>`).join('')}
      <button class="chip ${chosen === 'none' ? 'on' : ''}" data-act="resolve" data-cn="${i.cn}" data-m="none">${t('leaveOut')}</button></div></div>`;
  });
  res.issues.filter((i) => i.kind === 'date').forEach((i) => {
    h += `<div class="conf"><div>${esc(nameOf(i.memberId))}: ${esc(issueText(i, nameOf, lang()))}</div>
      <div class="chips"><button class="chip ${session().force[i.data.reportId] ? 'on' : ''}" data-act="force" data-r="${i.data.reportId}">${t('useAnyway')}</button></div></div>`;
  });
  h += `</section>`;
  const others = res.issues.filter((i) => i.kind !== 'conflict' && i.kind !== 'date');
  if (others.length) {
    h += `<section class="card"><h2>${t('otherIssues')}</h2>` + res.members.map((m) => {
      const list = others.filter((i) => i.memberId === m.member.id);
      return list.length ? `<div class="grp"><b>${esc(m.member.name)}</b><ul class="plain">${list.map((i) => `<li class="${i.severity === 'error' ? 'bad' : ''}">${esc(issueText(i, nameOf, lang()))}</li>`).join('')}</ul></div>` : '';
    }).join('') + '</section>';
  }
  h += `<div class="actionbar"><button class="btn primary" data-act="shareFix">${t('sendFixes')}</button><button class="btn" data-act="copyFix">${t('copy')}</button></div>`;
  return h;
}

function leaderFinal(res) {
  const ok = res.blocking === 0;
  const lic = ui.license;
  let h = '';
  if (!ok) {
    h += `<section class="card warn"><b>${t('blocked', { n: res.blocking })}</b><p class="muted small">${t('blockedHint')}</p>
      <button class="btn" data-act="goIssues">${t('lIssues')}</button> <button class="btn" data-act="ack">${t('acceptRest')}</button></section>`;
    return h;
  }
  const tt = res.totals;
  const text = compiledReport({ title: lic.t, date: reportDate(), result: res });
  h += sumBlock(tt.blPaid + tt.slPaid + tt.blUnpaid + tt.slUnpaid, tt.blPaid + tt.blUnpaid, tt.slPaid + tt.slUnpaid, res.totals.cn,
    `${res.missing.length ? `<p class="note warnline">${t('missing')}: ${esc(res.missing.map((m) => m.name).join(', '))}</p>` : ''}
    ${session().ack ? `<p class="note warnline">${t('ackOn')} <button class="link" data-act="unack">${t('undo')}</button></p>` : ''}`) + `
    <details class="preview" open><summary>${t('seeMessage')}</summary><pre>${esc(text)}</pre></details>
    <div class="actionbar"><button class="btn primary" data-act="shareFinal">${t('sendWa')}</button><button class="btn" data-act="copyFinal">${t('copy')}</button></div>`;
  return h;
}

function leaderRoster() {
  const r = S.leader.roster;
  let h = `<section class="card"><h2>${t('lRoster')}</h2>`;
  if (!r.length) h += `<p class="muted">${t('rosterEmpty')}</p>`;
  h += `<ul class="roster">${r.map((m, i) => `<li data-m="${m.id}">
    <div class="row"><input data-rf="name" value="${esc(m.name)}" aria-label="${t('name')}">
    <button class="btn sm" data-act="mUp" data-m="${m.id}" ${i ? '' : 'disabled'}>↑</button><button class="btn sm" data-act="mDown" data-m="${m.id}" ${i < r.length - 1 ? '' : 'disabled'}>↓</button>
    <button class="btn sm" data-act="mDel" data-m="${m.id}">${t('remove')}</button></div>
    <input class="alias" data-rf="aliases" value="${esc((m.aliases || []).join(', '))}" placeholder="${t('aliases')}"></li>`).join('')}</ul>
    <div class="row"><input id="newName" placeholder="${t('addName')}" value="${esc(ui.newName)}"><button class="btn" data-act="mAdd">${t('add')}</button></div></section>`;
  h += `<section class="card"><h2>${t('rosterFromReport')}</h2><p class="muted small">${t('rosterFromReportHint')}</p>
    <textarea id="rosterPaste" rows="4">${esc(ui.rosterPaste)}</textarea>
    <button class="btn" data-act="rosterRead">${t('findNames')}</button>`;
  if (ui.rosterImport) {
    h += `<div class="stack"><p>${t('foundNames', { n: ui.rosterImport.length })}</p><div class="chips">${ui.rosterImport.map((n, i) => `<button class="chip on" data-act="dropFound" data-i="${i}">${esc(n)} ✕</button>`).join('')}</div>
      <button class="btn primary" data-act="rosterKeep">${t('keepNames')}</button></div>`;
  }
  return h + '</section>';
}

// ----- more -----
function viewMore() {
  const lic = ui.license;
  return `<section class="card"><h2>${t('settings')}</h2><div class="stack">
    <label class="field"><span class="lbl">${t('yourName')}</span><input id="setName" value="${esc(S.settings.name)}"></label>
    <div><span class="lbl">${t('language')}</span>${seg('lang', S.settings.lang, [['sw', 'Kiswahili'], ['en', 'English']])}</div>
    <label class="field"><span class="lbl">${t('prefixLabel')}</span><input id="setPrefix" inputmode="numeric" value="${esc(prefix())}"></label>
    <p class="muted small">${t('prefixHint')}</p></div></section>
  <section class="card"><h2>${t('backup')}</h2><p class="muted small">${t('backupHint')}</p>
    <div class="row"><button class="btn" data-act="export">${t('exportBtn')}</button><label class="btn" for="importFile">${t('importBtn')}</label><input id="importFile" type="file" accept=".json,application/json" hidden></div>
    <button class="link" data-act="persist">${t('persistBtn')}</button></section>
  <section class="card"><h2>${t('help')}</h2><ol class="steps">${[1, 2, 3, 4, 5].map((n) => `<li>${t('help' + n)}</li>`).join('')}</ol></section>
  <section class="card"><h2>${t('about')}</h2><p class="muted small">Ndina ${CONFIG.version} · ${t('aboutText')}</p>
    ${lic ? `<button class="link" data-act="lock">${t('lockLeader')}</button><br>` : ''}
    <button class="link danger" data-act="wipe">${t('wipe')}</button></section>`;
}

// ---------- render ----------
function render() {
  document.documentElement.lang = lang();
  $('#top').innerHTML = header();
  $('#nav').innerHTML = nav();
  main().innerHTML = ui.tab === 'report' ? viewReport() : ui.tab === 'leader' ? viewLeader() : viewMore();
}

// ---------- actions ----------
const byId = (id) => S.entries.find((e) => e.id === id);
const mById = (id) => S.leader.roster.find((m) => m.id === id);

function readForm(box) {
  const g = (f) => box.querySelector(`[data-f="${f}"]`).value.trim();
  return { cn: g('cn').replace(/\D/g, ''), amt: parseAmount(g('amt')), type: g('type'), status: g('status') };
}
function validEntry(v, selfId) {
  if (!cnOk(v.cn, '99')) { toast(t('badCn')); return false; }
  if (Number.isNaN(v.amt) || v.amt <= 0) { toast(t('badAmt')); return false; }
  if (v.type !== 'BL' && v.type !== 'SL') { toast(t('badType')); return false; }
  const other = S.entries.find((e) => e.cn === v.cn && e.id !== selfId && e.pool !== 'trash');
  if (other && other.amt === v.amt) { toast(t('alreadyHave')); return false; }
  return true;
}
function poolForDate(e) { return e.status === 'PAID' && e.pay && e.pay !== reportDate() ? 'spare' : 'used'; }

function mineText() {
  const used = poolOf('used');
  return memberReport({ name: S.settings.name, date: reportDate(), entries: used });
}
function fixText() {
  const res = compile({ roster: S.leader.roster, session: session(), date: reportDate(), prefix: prefix() });
  return correctionsMessage({ date: reportDate(), title: ui.license.t, result: res, lang: 'sw' });
}
function finalText() {
  const res = compile({ roster: S.leader.roster, session: session(), date: reportDate(), prefix: prefix() });
  return compiledReport({ title: ui.license.t, date: reportDate(), result: res });
}
async function doShare(text) {
  const r = await shareWhatsApp(text);
  if (r === 'long') toast(t('longShare'));
}
async function doCopy(text) { toast((await copyText(text)) ? t('copied') : t('copyFail')); }

function addPasted() {
  const roster = S.leader.roster; const s = session();
  let added = 0, ignored = 0, unknown = 0;
  splitMessages(ui.paste).forEach((m, i) => {
    const parsed = parseReport(m.text);
    if (!parsed.entries.length) { ignored++; return; }
    if (s.reports.some((r) => r.text === m.text && r.sender === m.sender && r.ts === m.ts)) return;
    const memberId = matchMember(roster, m.sender, parsed.name);
    if (!memberId) unknown++;
    s.reports.push({ id: uid(), memberId, sender: m.sender, ts: m.ts, addedAt: Date.now() + i, text: m.text, parsed });
    added++;
  });
  ui.paste = '';
  save();
  toast(t('pasteDone', { n: added, u: unknown }));
  if (!added && ignored) toast(t('pasteNone'));
}

const actions = {
  tab: (el) => { ui.tab = el.dataset.v; if (ui.tab === 'leader') refreshLicense(); },
  ltab: (el) => { ui.lTab = el.dataset.v; },
  pool: (el) => { ui.pool = el.dataset.v; ui.openId = null; },
  open: (el) => { ui.openId = ui.openId === el.dataset.id ? null : el.dataset.id; ui.editing = null; },
  edit: (el) => { ui.editing = ui.editing === el.dataset.id ? null : el.dataset.id; ui.openId = el.dataset.id; },
  saveName: () => { const v = $('#nameInput').value.trim(); if (v) { S.settings.name = v.toUpperCase(); save(); } },
  manual: () => { ui.adding = !ui.adding; },
  addManual: () => {
    const v = { cn: $('#mCn').value.replace(/\D/g, ''), amt: parseAmount($('#mAmt').value), type: $('#mType').value, status: $('#mStatus').value };
    if (!validEntry(v)) return false;
    const date = reportDate();
    S.entries.push({ id: uid(), ...v, pay: v.status === 'PAID' ? date : null, recv: null, pool: 'used', flags: [], auto: null, manual: true, src: 'manual', added: Date.now() });
    ui.adding = false; save();
  },
  accept: (el) => {
    const e = byId(el.dataset.id); const v = readForm(el.closest('.edit'));
    if (!validEntry(v, e.id)) return false;
    S.entries = S.entries.filter((x) => !(x.cn === v.cn && x.id !== e.id && x.pool !== 'review'));
    Object.assign(e, v, { flags: [], manual: false });
    e.pool = poolForDate(e); e.auto = e.pool === 'spare' ? 'date' : null; save();
  },
  saveEdit: (el) => {
    const e = byId(el.dataset.id); const v = readForm(el.closest('.edit'));
    if (!validEntry(v, e.id)) return false;
    Object.assign(e, v); ui.editing = null; save();
  },
  toUsed: (el) => { const e = byId(el.dataset.id); e.pool = 'used'; e.manual = true; e.auto = null; ui.openId = null; save(); },
  toSpare: (el) => { const e = byId(el.dataset.id); e.pool = 'spare'; e.manual = true; ui.openId = null; save(); },
  toTrash: (el) => { const e = byId(el.dataset.id); e.pool = 'trash'; e.manual = true; ui.openId = null; save(); toast(t('discarded')); },
  restoreSpare: () => { poolOf('spare').forEach((e) => { e.pool = 'used'; e.manual = true; }); S.filter = null; ui.fResult = null; save(); },
  emptyTrash: () => { if (confirm(t('confirmTrash'))) { S.entries = S.entries.filter((e) => e.pool !== 'trash'); save(); } },
  fType: (el) => { ui.fType = el.dataset.v; },
  applyFilter: () => {
    const amounts = $('#fAmounts').value.split(/[,\s;]+/).map(parseAmount).filter((n) => !Number.isNaN(n) && n > 0);
    const target = parseAmount($('#fTarget').value) || 0;
    ui.fAmounts = $('#fAmounts').value; ui.fTarget = $('#fTarget').value;
    const f = { type: ui.fType, amounts, target };
    const r = applyFilter(S.entries, f);
    S.entries.forEach((e) => { if (e.pool === 'used' || e.pool === 'spare') { e.manual = true; e.auto = null; } });
    S.filter = (f.type !== 'ALL' || amounts.length || target) ? f : null;
    ui.fResult = target ? t('targetResult', { target: fmtNum(target), best: fmtNum(r.best), diff: fmtNum(round2(target - r.best)) }) : t('filterResult', { used: r.used, spare: r.spare });
    save();
  },
  resetFilter: () => {
    S.entries.forEach((e) => { if (e.pool === 'spare') { e.pool = 'used'; e.manual = true; } });
    S.filter = null; ui.fType = 'ALL'; ui.fAmounts = ''; ui.fTarget = ''; ui.fResult = null; save();
  },
  pause: () => { OCR.progress.stop = true; },
  resume: () => { startOcr(); return false; },
  clearDup: () => { ui.dupCount = 0; },
  clearFailed: () => { ui.failed = []; },
  shareMine: () => { doShare(mineText()); return false; },
  copyMine: () => { doCopy(mineText()); return false; },

  // leader
  unlock: async () => {
    const code = ($('#codeInput').value || '').trim(); ui.code = code;
    const r = await verifyCode(code, CONFIG.publicKey, todayIso());
    if (!r.ok) { ui.codeErr = t('codeErr.' + r.reason); return; }
    S.license = { code }; ui.license = r.payload; ui.codeErr = ''; ui.code = ''; save();
    toast(t('unlocked'));
  },
  lock: () => { if (confirm(t('confirmLock'))) { S.license = null; ui.license = null; ui.tab = 'more'; save(); } },
  readPaste: () => { ui.paste = $('#pasteBox').value; addPasted(); },
  assign: (el) => {
    const s = session(); const r = s.reports.find((x) => x.id === el.dataset.r); const m = mById(el.dataset.m);
    r.memberId = m.id;
    if (r.sender && !(m.aliases || []).includes(r.sender)) m.aliases = [...(m.aliases || []), r.sender];
    save();
  },
  dropReport: (el) => { const s = session(); s.reports = s.reports.filter((r) => r.id !== el.dataset.r); save(); },
  newDay: () => { if (confirm(t('confirmNewDay'))) { delete S.leader.sessions[reportDate()]; save(); } },
  resolve: (el) => {
    const s = session(); const cur = s.resolutions[el.dataset.cn];
    if (cur === el.dataset.m) delete s.resolutions[el.dataset.cn]; else s.resolutions[el.dataset.cn] = el.dataset.m;
    save();
  },
  force: (el) => { const s = session(); s.force[el.dataset.r] = !s.force[el.dataset.r]; save(); },
  ack: () => { session().ack = true; save(); },
  unack: () => { session().ack = false; save(); },
  goIssues: () => { ui.lTab = 'issues'; },
  shareFix: () => { doShare(fixText()); return false; },
  copyFix: () => { doCopy(fixText()); return false; },
  shareFinal: () => { doShare(finalText()); return false; },
  copyFinal: () => { doCopy(finalText()); return false; },
  mAdd: () => {
    const v = ($('#newName').value || '').trim(); if (!v) return false;
    S.leader.roster.push({ id: uid(), name: v.toUpperCase(), aliases: [] }); ui.newName = ''; save();
  },
  mDel: (el) => { if (confirm(t('confirmRemove'))) { S.leader.roster = S.leader.roster.filter((m) => m.id !== el.dataset.m); save(); } },
  mUp: (el) => { const r = S.leader.roster; const i = r.findIndex((m) => m.id === el.dataset.m); if (i > 0) [r[i - 1], r[i]] = [r[i], r[i - 1]]; save(); },
  mDown: (el) => { const r = S.leader.roster; const i = r.findIndex((m) => m.id === el.dataset.m); if (i < r.length - 1) [r[i + 1], r[i]] = [r[i], r[i + 1]]; save(); },
  rosterRead: () => {
    ui.rosterPaste = $('#rosterPaste').value;
    const names = extractNames(ui.rosterPaste);
    if (!names.length) { toast(t('noNames')); return false; }
    ui.rosterImport = names;
  },
  dropFound: (el) => { ui.rosterImport.splice(Number(el.dataset.i), 1); },
  rosterKeep: () => {
    const have = new Set(S.leader.roster.map((m) => m.name.toUpperCase()));
    ui.rosterImport.forEach((n) => { if (!have.has(n.toUpperCase())) S.leader.roster.push({ id: uid(), name: n.toUpperCase(), aliases: [] }); });
    ui.rosterImport = null; ui.rosterPaste = ''; save(); toast(t('namesSaved'));
  },

  // more
  lang: (el) => { setLang(el.dataset.v); S.settings.lang = el.dataset.v; save(); },
  export: () => { download(`ndina-backup-${todayIso()}.json`, JSON.stringify(S)); return false; },
  persist: async () => { const ok = await navigator.storage?.persist?.(); toast(ok ? t('persistOk') : t('persistNo')); return false; },
  wipe: async () => {
    if (!confirm(t('confirmWipe'))) return false;
    resetAll(); await qClear(); ui.license = null; ui.failed = []; ui.pending = 0; setLang('sw'); toast(t('wiped'));
  },
};

document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]'); if (!el) return;
  if (el.tagName === 'SUMMARY') { ui.filterOpen = !el.parentElement.open; return; }
  const fn = actions[el.dataset.act]; if (!fn) return;
  const r = await fn(el);
  if (r !== false) render();
});

document.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (el.id === 'dateInput') {
    S.settings.dateOverride = el.value && el.value !== todayIso() ? el.value : null;
    reclass(); save(); render();
  } else if (el.id === 'files') {
    const files = [...el.files]; if (!files.length) return;
    await OCR.enqueue(files); ui.pending = await OCR.pendingCount(); el.value = ''; render(); startOcr();
  } else if (el.id === 'setName') { S.settings.name = el.value.trim().toUpperCase(); save(); }
  else if (el.id === 'setPrefix') { const v = el.value.replace(/\D/g, ''); S.settings.prefix = v || CONFIG.controlPrefix; save(); render(); }
  else if (el.id === 'importFile') {
    const f = el.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!data || !Array.isArray(data.entries)) throw new Error('bad');
      if (!confirm(t('confirmImport'))) return;
      replaceState(data); setLang(S.settings.lang); await refreshLicense(); toast(t('imported')); render();
    } catch { toast(t('importBad')); }
  } else if (el.dataset.rf) {
    const li = el.closest('li'); const m = mById(li.dataset.m); if (!m) return;
    if (el.dataset.rf === 'name') m.name = el.value.trim().toUpperCase() || m.name;
    else m.aliases = el.value.split(',').map((x) => x.trim()).filter(Boolean);
    save();
  }
});
document.addEventListener('input', (ev) => {
  const el = ev.target;
  if (el.id === 'pasteBox') ui.paste = el.value;
  else if (el.id === 'rosterPaste') ui.rosterPaste = el.value;
  else if (el.id === 'codeInput') ui.code = el.value;
  else if (el.id === 'newName') ui.newName = el.value;
  else if (el.id === 'fAmounts') ui.fAmounts = el.value;
  else if (el.id === 'fTarget') ui.fTarget = el.value;
});

async function refreshLicense() {
  if (!S.license?.code) { ui.license = null; return; }
  const r = await verifyCode(S.license.code, CONFIG.publicKey, todayIso());
  ui.license = r.ok ? r.payload : null;
  if (!r.ok) ui.codeErr = t('codeErr.' + r.reason);
}

// Download the reading engine once, so Ndina also works with no data later.
async function warmCache() {
  try {
    if (localStorage.getItem('ndina.warm') === '1' || !navigator.onLine) return;
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((r) => { navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }); setTimeout(r, 4000); });
    }
    if (!navigator.serviceWorker.controller) return; // next visit
    const simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
    const base = './vendor/tesseract/';
    const urls = ['tesseract.min.js', 'worker.min.js', simd ? 'core/tesseract-core-simd-lstm.wasm.js' : 'core/tesseract-core-lstm.wasm.js', 'lang/eng.traineddata.gz'];
    for (const u of urls) { const r = await fetch(base + u); if (!r.ok) return; await r.arrayBuffer(); }
    localStorage.setItem('ndina.warm', '1');
  } catch { /* try again next visit */ }
}

// ---------- start ----------
(async function init() {
  setLang(S.settings.lang);
  await refreshLicense();
  reclass();
  render();
  ui.pending = await OCR.pendingCount();
  if (ui.pending) { render(); startOcr(); }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then(warmCache).catch(() => {});
  }
  navigator.storage?.persist?.().catch(() => {});
})();
