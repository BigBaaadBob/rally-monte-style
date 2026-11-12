'use strict';
// Snapshot of the page as delivered, for "Save offline copy" (taken before anything renders).
// Snapshot of the page for "Download app as HTML file". Anything the hosting viewer injected
// (security-policy meta tags, its runtime scripts) is removed so the copy can reach the API.
const SELF_HTML = (() => {
  const c = document.documentElement.cloneNode(true);
  c.querySelectorAll('script:not([data-rt]), meta[http-equiv], base, iframe, object, embed, link').forEach(n => n.remove());
  return '<!DOCTYPE html>\n' + c.outerHTML;
})();

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtVM = v => v == null ? '' : v.toFixed(2);
const now = () => Date.now();
const LS_KEY = 'rallyRT.v1', LS_KEY_API = 'rallyRT.apikey';
const SPEEDO_START = 35;            // default speedometer for a new rally (then saved with the rally)

// ---------------------------------------------------------------- storage
let lsOK = true;
let store = { rallies: {}, cur: null, prefs: { theme: 'day', fmt: 'hms' } };
try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) { const s = JSON.parse(raw); store = { ...store, ...s, prefs: { ...store.prefs, ...(s.prefs || {}) } }; }
} catch (e) { lsOK = false; }
for (const r of Object.values(store.rallies)) if (r.speedo === '' || r.speedo == null) r.speedo = SPEEDO_START;

function newId() { return 'r' + now().toString(36) + Math.random().toString(36).slice(2, 7); }
function blankRally() {
  return { id: newId(), name: '', date: (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(new Date()),
    crew: { driver: '', navigator: '', passengers: [] }, cn: '', ocf: 1, speedo: SPEEDO_START,
    rows: [], taEvents: [], created: now(), updated: now() };
}
const R = () => store.rallies[store.cur] || null;

function save(rally) {
  if (rally) { rally.updated = now(); Cloud.queue(rally.id); }
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); lsOK = true; }
  catch (e) { lsOK = false; }
  renderStorageWarn();
}
function renderStorageWarn() {
  $('storageWarn').innerHTML = lsOK ? '' :
    '<div class="banner">This browser is not letting the page save on the device. Your data lasts only while the page stays open. Use Data → Export before closing.</div>';
}

// ---------------------------------------------------------------- Claude capabilities (all optional)
const caps = { sample: null, db: null, user: null, downloads: null };
const hasClaude = typeof window.claude === 'object' && window.claude && typeof window.claude.use === 'function';
async function useCap(name) { if (!hasClaude) return null; try { return await window.claude.use(name); } catch (e) { return null; } }

// Cloud copy: one private document per rally under data/users/<id>/.
const Cloud = {
  col: null, state: 'off', last: null, pending: new Set(), busy: false, timer: null,
  async init() {
    caps.db = await useCap('db'); caps.user = await useCap('user');
    if (!caps.db || !caps.user) { this.set('off'); return; }
    let uid = null; try { uid = await caps.user.id(); } catch (e) {}
    if (!uid) { this.set('off'); return; }
    try { this.col = caps.db.collection('data/users/' + uid); } catch (e) { this.set('off'); return; }
    this.set('sync');
    try {
      const snap = await Promise.race([this.col.get(), new Promise((_, rj) => setTimeout(() => rj({ code: 'timeout' }), 10000))]);
      let pulled = 0;
      for (const d of snap.docs) {
        const v = d.data(); if (!v || !v.rally || !v.rally.id) continue;
        const loc = store.rallies[v.rally.id];
        // snapshot data is frozen: keep a mutable deep copy
        if (!loc || (v.rally.updated || 0) > (loc.updated || 0)) { store.rallies[v.rally.id] = JSON.parse(JSON.stringify(v.rally)); pulled++; }
        else if ((loc.updated || 0) > (v.rally.updated || 0)) this.pending.add(loc.id);
      }
      for (const id of Object.keys(store.rallies)) if (!snap.docs.some(d => d.id === id)) this.pending.add(id);
      try { localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) {}
      if (pulled) { toast(`Loaded ${pulled} rall${pulled > 1 ? 'ies' : 'y'} from your account.`); renderAll(); }
      this.set('ok'); this.flushSoon(500);
    } catch (e) { this.set(e && e.code === 'timeout' ? 'offline' : 'off'); }
  },
  set(s) { this.state = s; renderCloud(); },
  queue(id) { if (!this.col) return; this.pending.add(id); this.flushSoon(2500); },
  flushSoon(ms) { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), ms); },
  async flush() {
    if (!this.col || this.busy || !this.pending.size) return;
    this.busy = true; this.set('sync');
    try {
      for (const id of [...this.pending]) {
        this.pending.delete(id);
        const r = store.rallies[id];
        try {
          if (r) await this.col.doc(id).set({ rally: r, updated: r.updated, name: r.name || '', date: r.date || '' });
          else await this.col.doc(id).delete();
        } catch (e) {
          this.pending.add(id);
          if (e && (e.code === 'revoked' || e.code === 'not_granted' || e.code === 'invalid_argument')) { this.col = null; this.set('off'); return; }
          throw e;
        }
      }
      this.last = now(); this.set('ok');
    } catch (e) { this.set('offline'); this.flushSoon(30000); }
    finally { this.busy = false; if (this.pending.size && this.col) this.flushSoon(3000); }
  },
};
function renderCloud() {
  const m = { off: 'Saved on device', sync: 'Saving to account…', ok: 'Saved on device + account', offline: 'Saved on device (account copy waiting)' };
  $('cloud').textContent = lsOK ? m[Cloud.state] : 'Not saved!';
}

// ---------------------------------------------------------------- UI helpers
function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), ms); }
function confirmBox(title, bodyHtml, okLabel, onOk, cancelLabel = 'Cancel') {
  $('mTitle').textContent = title; $('mBody').innerHTML = bodyHtml;
  $('mOk').textContent = okLabel; $('mCancel').textContent = cancelLabel; $('mCancel').style.display = cancelLabel ? '' : 'none';
  $('modal').classList.add('on');
  const close = () => { $('modal').classList.remove('on'); $('mOk').onclick = $('mCancel').onclick = null; };
  const gen = ++confirmBox.gen;
  // onOk may return false to keep the dialog open, or open another dialog (which then stays open)
  $('mOk').onclick = () => { if (onOk && onOk() === false) return; if (confirmBox.gen === gen) close(); };
  $('mCancel').onclick = close;
  $('modal').onclick = e => { if (e.target === $('modal')) close(); };
}
const fmtT = t => Core.fmtTOD(t, store.prefs.fmt);
const fmtTA = s => Core.fmtRel(s, store.prefs.fmt === 'hmc' ? 'hmc' : 'ms') || '0:00';

let view = 'rallies';
function show(v) {
  if (v !== 'rallies' && !R()) v = 'rallies';
  view = v;
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  document.querySelectorAll('.view').forEach(s => s.classList.toggle('on', s.id === 'v-' + v));
  try { history.replaceState(null, '', v === 'rallies' ? location.pathname + location.search : '#' + v); } catch (e) {}
  renderView();
  if (v === 'run') wake(true); else wake(false);
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => show(b.dataset.v));

function renderHeader() {
  const r = R();
  $('hdrTitle').innerHTML = r ? `${esc(r.name || 'Untitled rally')}<span class="sub">${esc(r.date || '')}${r.cn !== '' ? ' · Car ' + esc(r.cn) : ''}${r.cls ? ' · Class ' + esc(r.cls) : ''}</span>` : 'Rally Route Table';
  document.querySelectorAll('#tabs button').forEach(b => b.disabled = b.dataset.v !== 'rallies' && !r);
}
function applyTheme() { document.documentElement.dataset.theme = store.prefs.theme; }
function renderView() {
  renderHeader();
  ({ rallies: renderRallies, setup: renderSetup, route: renderRoute, run: renderRun, data: renderData }[view])();
}
function renderAll() { applyTheme(); renderCloud(); renderStorageWarn(); renderView(); }

// screen wake lock while on Run (ignored where not allowed)
let wl = null;
async function wake(on) {
  try {
    if (on && !wl && navigator.wakeLock) { wl = await navigator.wakeLock.request('screen'); wl.addEventListener('release', () => wl = null); }
    if (!on && wl) { await wl.release(); wl = null; }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && view === 'run') wake(true); });

// ---------------------------------------------------------------- RALLIES
function renderRallies() {
  const list = Object.values(store.rallies).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updated - a.updated);
  $('rallyList').innerHTML = list.length ? list.map(r => {
    const done = r.rows.filter(x => x.done).length;
    return `<div class="card rally-item ${r.id === store.cur ? 'cur' : ''}">
      <div class="grow"><div class="name">${esc(r.name || 'Untitled rally')}</div>
      <div class="small muted">${esc(r.date || '')}${r.cn !== '' ? ' · Car ' + esc(r.cn) : ''} · ${r.rows.length} RIs${r.rows.length ? ` · ${done} complete` : ''}</div></div>
      <button data-open="${r.id}" class="primary">Open</button></div>`;
  }).join('') : '<p class="muted">No rallies yet. Start a new one, or try the invented sample rally.</p>';
  $('rallyList').querySelectorAll('[data-open]').forEach(b => b.onclick = () => {
    store.cur = b.dataset.open; save(); const r = R();
    show(r.rows.length && r.name ? 'run' : 'setup');
  });
}
$('btnNew').onclick = () => { const r = blankRally(); store.rallies[r.id] = r; store.cur = r.id; save(r); show('setup'); };
$('btnNewSample').onclick = () => {
  const r = blankRally();
  Object.assign(r, { name: 'Desert Loop (sample)', cn: 12, ocf: 1.0200, speedo: SPEEDO_START,
    crew: { driver: 'Bob Withrow', navigator: '', passengers: [] } });
  r.rows = Core.mergeRows([], SAMPLE_ROWS).rows;
  store.rallies[r.id] = r; store.cur = r.id; save(r); show('setup');
};

// ---------------------------------------------------------------- SETUP
function renderSetup() {
  const r = R(); const c = r.crew;
  $('setupBody').innerHTML = `
  <div class="card"><h2>Rally</h2>
    <label for="fName">Rally name</label><input id="fName" value="${esc(r.name)}" autocomplete="off">
    <div class="grid2">
      <div><label for="fDate">Rally date</label><input id="fDate" type="date" value="${esc(r.date)}"></div>
      <div><label for="fCN">Car number (CN, minutes added to CZT)</label><input id="fCN" inputmode="numeric" value="${esc(r.cn)}"></div>
    </div>
    <div class="grid2" style="grid-template-columns:minmax(0,1fr) 110px">
      <div><label for="fOCF">OCF (VM = OM × OCF)</label><input id="fOCF" inputmode="decimal" value="${esc(r.ocf)}"></div>
      <div><label for="fCls">Class</label><select id="fCls"><option value="">—</option>${['A', 'B', 'C', 'D'].map(k => `<option ${r.cls === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
    </div>
    <div class="small muted" id="ocfHelp"></div>
    <label for="fClose">Highlight adjacent RIs this close or closer (vehicle miles)</label>
    <input id="fClose" inputmode="decimal" value="${esc(r.closeMi ?? 0.5)}" style="max-width:160px">
  </div>
  <div class="card"><h2>Crew</h2>
    <div class="grid2">
      <div><label for="fDrv">Driver</label><input id="fDrv" value="${esc(c.driver)}" autocomplete="off"></div>
      <div><label for="fNav">Navigator</label><input id="fNav" value="${esc(c.navigator)}" autocomplete="off"></div>
    </div>
    <label>Passengers</label>
    <div id="paxList">${(c.passengers || []).map((p, i) => `<div class="row" style="margin-bottom:6px"><input data-pax="${i}" value="${esc(p)}" style="flex:1"><button data-paxdel="${i}" class="danger">Remove</button></div>`).join('')}</div>
    <button id="btnPax">Add passenger</button>
  </div>
  <div class="card"><h2>Display</h2>
    <div class="grid2">
      <div><label for="fFmt">Time format</label><select id="fFmt">
        <option value="hms" ${store.prefs.fmt === 'hms' ? 'selected' : ''}>HH:MM:SS</option>
        <option value="hmc" ${store.prefs.fmt === 'hmc' ? 'selected' : ''}>HH:MM.cc (hundredths of a minute)</option></select></div>
      <div><label for="fTheme">Theme</label><select id="fTheme">
        <option value="day" ${store.prefs.theme === 'day' ? 'selected' : ''}>Day</option>
        <option value="night" ${store.prefs.theme === 'night' ? 'selected' : ''}>Night</option></select></div>
    </div>
  </div>
  <div class="card"><h2>Next</h2><ol class="steps">
    <li>Route: add photos of the Route Instruction pages and check the table (needs internet).</li>
    <li>Run: complete each RI as you reach it. No internet needed.</li></ol>
    <div class="row" style="margin-top:8px"><button class="primary" id="goRoute">Go to Route</button></div></div>`;
  const ocfHelp = () => { const v = +r.ocf; $('ocfHelp').textContent = v > 0 ? (v === 1 ? 'OCF 1.0000: VM equals OM.' : `Your odometer reads ${((v - 1) * 100).toFixed(2)}% ${v > 1 ? 'more' : 'less'} than official.`) : 'OCF must be a positive number.'; };
  ocfHelp();
  const bind = (id, fn) => $(id).addEventListener('input', e => { fn(e.target.value); save(r); renderHeader(); });
  bind('fName', v => r.name = v);
  bind('fDate', v => r.date = v);
  bind('fCN', v => { r.cn = v.trim() === '' ? '' : (isNaN(+v) ? r.cn : +v); });
  bind('fOCF', v => { if (+v > 0) r.ocf = +v; ocfHelp(); });
  bind('fClose', v => { const s = v.trim(); if (s === '' || +s >= 0) r.closeMi = s === '' ? '' : +s; });
  $('fCls').onchange = e => { r.cls = e.target.value; save(r); renderHeader(); };
  bind('fDrv', v => c.driver = v);
  bind('fNav', v => c.navigator = v);
  $('paxList').querySelectorAll('[data-pax]').forEach(el => el.addEventListener('input', () => { c.passengers[+el.dataset.pax] = el.value; save(r); }));
  $('paxList').querySelectorAll('[data-paxdel]').forEach(el => el.onclick = () => { c.passengers.splice(+el.dataset.paxdel, 1); save(r); renderSetup(); });
  $('btnPax').onclick = () => { c.passengers.push(''); save(r); renderSetup(); const ins = $('paxList').querySelectorAll('input'); ins[ins.length - 1].focus(); };
  $('fFmt').onchange = e => { store.prefs.fmt = e.target.value; save(); };
  $('fTheme').onchange = e => { store.prefs.theme = e.target.value; save(); applyTheme(); };
  $('goRoute').onclick = () => show('route');
}

// ---------------------------------------------------------------- ROUTE (prep)
let newSet = new Set();         // RIs touched by the last import (highlighted)
let pages = [];                 // {file, url, state:'' | 'busy' | 'ok' | 'bad', msg}
const OCR_PROMPT = `You are reading ONE photographed page of SCCA RoadRally (TDS, Monte Carlo style) Route Instructions. The page holds a table of numbered route instructions (RIs).
Return ONLY a JSON array, no prose and no code fence. One object per RI row, in page order:
{"ri": RI number as printed (number, or string like "12A"),
 "om": the official mileage (OM) column EXACTLY as printed, as a string, e.g. "2.29"; a restart is printed with a slash, e.g. "13.27/0.00" or "/0.00", and you must keep the slash part,
 "czt": the checkpoint zero time (CZT) as printed ("HH:MM:SS" or "HH:MM.cc"), or null if blank,
 "cp": checkpoint number if the row names one (e.g. "CP 65" -> 65), else null,
 "instr": the instruction text exactly as printed (keep quotes, brackets, abbreviations, and exclamation marks),
 "info": any additional-information or notes text for that row, else "",
 "note": include ONLY if something in the row is illegible or uncertain, saying what}
Include every row, including rows with no CZT. Never invent or infer values: use null for blank cells. If the page has no route instruction table, return [].`;

function renderRoute() {
  const r = R(), C = Core.compute(r);
  const flags = routeFlags(r, C);
  const canOCR = !!caps.sample || !!getApiKey();
  $('routeBody').innerHTML = `
  <div class="card narrow" style="max-width:none">
    <h2>Read Route Instruction pages</h2>
    <div class="small muted">${caps.sample ? 'Claude reads each photo (internet required). The first time, Claude asks your permission.'
      : getApiKey() ? 'Standalone copy: photos are sent to the Anthropic API with the key saved on this device (Data tab).'
      : 'This copy has no photo reader: add an Anthropic API key on the Data tab, or use “Read in a Claude chat…”.'}
      If “Add page photos” does nothing (the Claude Android app), use “Read in a Claude chat…”.</div>
    <div class="row" style="margin-top:8px">
      <span class="filebtn primary">Add page photos<input type="file" id="fPages" accept="image/*" multiple aria-label="Add page photos"></span>
      <button id="btnRead" ${pages.some(p => p.state !== 'ok') ? '' : 'disabled'}>Read ${pages.filter(p => p.state !== 'ok').length || ''} page(s)</button>
      <button id="btnChat">Read in a Claude chat…</button>
      ${pages.length ? '<button id="btnClearPages">Clear photos</button>' : ''}
    </div>
    <div class="thumbs">${pages.map((p, i) => `<figure class="${p.state}"><img src="${p.url}" alt="page ${i + 1}"><figcaption>${esc(p.msg || p.file.name)}</figcaption></figure>`).join('')}</div>
  </div>
  <div class="row" style="margin-bottom:8px">
    <strong>${r.rows.length} RIs</strong>
    <button id="btnAdd">Add row</button><button id="btnSort">Sort by RI</button>
    <button id="btnPaste">Paste rows</button>
    <button id="btnClearRT" class="danger" ${r.rows.length ? '' : 'disabled'}>Clear table</button>
  </div>
  ${newSet.size ? `<div class="banner">Highlighted rows came from the last read. Check them against the paper.</div>` : ''}
  ${flags.length ? `<div class="flags">${flags.slice(0, 8).map(esc).join('<br>')}${flags.length > 8 ? `<br>…and ${flags.length - 8} more` : ''}</div>` : ''}
  <div class="tablewrap"><table id="rtEdit"><thead><tr>
    <th>RI</th><th>OM</th><th title="Restart (OM /0.00)">Rst</th><th>CZT</th><th>CP</th><th>Instruction</th><th>Info</th><th></th></tr></thead>
  <tbody>${r.rows.map((x, i) => `<tr class="${newSet.has(String(x.ri)) ? 'new' : ''} ${C[i].restart ? 'rs' : ''} ${flags.some(f => f.startsWith('RI ' + x.ri + ':')) ? 'flag' : ''}">
    <td class="c-ri"><input data-i="${i}" data-k="ri" value="${esc(x.ri)}" inputmode="numeric"></td>
    <td class="c-om"><input data-i="${i}" data-k="om" value="${x.om == null ? '' : x.om.toFixed(2)}" inputmode="decimal"></td>
    <td><input type="checkbox" data-i="${i}" data-k="restart" ${C[i].restart ? 'checked' : ''} style="width:22px;min-height:22px"></td>
    <td class="c-czt"><input data-i="${i}" data-k="czt" value="${esc(Core.fmtTOD(x.czt, store.prefs.fmt))}" placeholder="—" inputmode="text"></td>
    <td class="c-cp"><input data-i="${i}" data-k="cp" value="${esc(x.cp ?? '')}"></td>
    <td class="c-instr"><input data-i="${i}" data-k="instr" value="${esc(x.instr)}"></td>
    <td class="c-info"><input data-i="${i}" data-k="info" value="${esc(x.info)}"></td>
    <td><button class="x" data-del="${i}" title="Delete row">✕</button></td></tr>`).join('')}</tbody></table></div>
  <p class="small muted">OM is the official mileage; a checked Rst box means the OM column shows “/0.00” (odometer restarts at that RI). Times may be typed as HH:MM:SS or HH:MM.cc. When the table is right, go to Run.</p>`;

  $('fPages').onchange = e => {
    for (const f of e.target.files) pages.push({ file: f, url: URL.createObjectURL(f), state: '', msg: '' });
    e.target.value = ''; renderRoute();
  };
  if ($('btnClearPages')) $('btnClearPages').onclick = () => { pages.forEach(p => URL.revokeObjectURL(p.url)); pages = []; renderRoute(); };
  if ($('btnRead')) $('btnRead').onclick = () => canOCR ? readPages() : confirmBox('No photo reader here',
    `This copy of the app is not running inside Claude, so it needs an Anthropic API key to read photos (Data tab → Anthropic API key).<br><br>
     Without a key, use <b>Read in a Claude chat…</b>: Claude reads the photos in a chat and you paste the result here.`,
    'Read in a Claude chat…', () => { chatRead(); }, 'Close');
  $('btnChat').onclick = chatRead;
  $('btnAdd').onclick = () => {
    const last = r.rows[r.rows.length - 1];
    const ri = last ? (typeof last.ri === 'number' ? last.ri + 1 : String(last.ri) + '+') : 1;
    r.rows.push(Core.normRow({ ri, om: last && !Core.compute(r)[r.rows.length - 1].restart ? last.om : (last ? 0 : '/0.00'), restart: !last }));
    save(r); renderRoute();
    const w = document.querySelector('#v-route'); w.scrollTop = w.scrollHeight;
  };
  $('btnSort').onclick = () => { r.rows.sort((a, b) => Core.cmpRI(a.ri, b.ri)); save(r); renderRoute(); };
  $('btnClearRT').onclick = () => confirmBox('Clear route table', `Remove all ${r.rows.length} RIs from “${esc(r.name || 'this rally')}”? Completion marks and time adjustments go too.`, 'Clear', () => {
    r.rows = []; r.taEvents = []; newSet.clear(); save(r); renderRoute();
  });
  $('btnPaste').onclick = pasteRows;
  const tb = document.querySelector('#rtEdit tbody');
  tb.addEventListener('change', e => {
    const el = e.target, i = +el.dataset.i, k = el.dataset.k; if (k == null) return;
    const row = r.rows[i];
    if (k === 'restart') row.restart = el.checked;
    else if (k === 'om') { const v = el.value.trim(); if (/\//.test(v)) { const n = Core.normRow({ om: v }); row.om = n.om; row.restart = true; } else row.om = v === '' || isNaN(+v) ? null : +v; }
    else if (k === 'czt') { const v = el.value.trim(); const t = Core.parseTOD(v); if (v && t == null) { toast('CZT format: HH:MM:SS or HH:MM.cc'); renderRoute(); return; } row.czt = t; }
    else if (k === 'ri') { const v = el.value.trim(); if (!v) { toast('RI cannot be blank'); renderRoute(); return; }
      if (r.rows.some((o, j) => j !== i && Core.sameRI(o.ri, v))) { toast(`RI ${v} already exists`); renderRoute(); return; }
      row.ri = /^\d+$/.test(v) ? +v : v; }
    else if (k === 'cp') row.cp = el.value.trim() || null;
    else row[k] = el.value;
    newSet.delete(String(row.ri));
    save(r); renderRoute();
  });
  tb.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const i = +b.dataset.del, x = r.rows[i];
    confirmBox('Delete row', `Delete RI ${esc(x.ri)}${x.instr ? ' (“' + esc(x.instr) + '”)' : ''}?`, 'Delete', () => {
      r.taEvents = (r.taEvents || []).filter(e => !Core.sameRI(e.ri, x.ri));
      r.rows.splice(i, 1); save(r); renderRoute();
    });
  });
}

function routeFlags(r, C) {
  const f = [];
  let prevOM = null, prevT = null;
  r.rows.forEach((x, i) => {
    if (C[i].restart) { prevOM = 0; prevT = null; }
    if (x.om == null && !C[i].restart) f.push(`RI ${x.ri}: no OM`);
    else if (!C[i].restart && prevOM != null && x.om < prevOM) f.push(`RI ${x.ri}: OM ${x.om.toFixed(2)} is less than the RI before it (missed restart?)`);
    if (!C[i].restart && x.om != null) prevOM = x.om;
    if (x.czt != null) { if (prevT != null && x.czt < prevT) f.push(`RI ${x.ri}: CZT earlier than the previous CZT`); prevT = x.czt; }
    if (i > 0 && Core.cmpRI(r.rows[i - 1].ri, x.ri) >= 0) f.push(`RI ${x.ri}: out of order (tap Sort by RI)`);
  });
  return f;
}

function mergeIntoRally(rows, label) {
  const r = R();
  const m = Core.mergeRows(r.rows, rows);
  r.rows = m.rows;
  rows.forEach(x => { const n = Core.normRow(x); if (n.ri != null) newSet.add(String(n.ri)); });
  save(r);
  return `${label}: ${m.added} added, ${m.replaced} replaced`;
}

async function prepImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
    const max = 2000, s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * s); cv.height = Math.round(img.naturalHeight * s);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    return await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.88));
  } finally { URL.revokeObjectURL(url); }
}
const blobToB64 = b => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(b); });

async function ocrOne(blob) {
  if (caps.sample) {
    const out = await caps.sample(OCR_PROMPT, { images: [blob], modelTier: 'complex', cache: false });
    return Core.parseOCR(out.text);
  }
  const key = getApiKey(); if (!key) throw new Error('No photo reader available');
  let resp;
  try { resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model: 'claude-opus-5-5', max_tokens: 8000, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToB64(blob) } },
      { type: 'text', text: OCR_PROMPT }] }] }),
  }); } catch (e) { throw new Error('Could not reach the Anthropic API (' + (e.message || 'network error') + '). Check the internet connection.'); }
  if (!resp.ok) throw new Error(resp.status === 401 ? 'The API key was rejected (401). Check it on the Data tab.' : 'API ' + resp.status + ': ' + (await resp.text()).slice(0, 160));
  const j = await resp.json();
  return Core.parseOCR((j.content || []).filter(c => c.type === 'text').map(c => c.text).join(''));
}

let reading = false;
async function readPages() {
  if (reading) return; reading = true; newSet.clear();
  const msgs = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]; if (p.state === 'ok') continue;
    p.state = 'busy'; p.msg = 'Reading…'; renderRoute();
    try {
      const rows = await ocrOne(await prepImage(p.file));
      if (!rows.length) { p.state = 'bad'; p.msg = 'No RIs found'; }
      else { const s = mergeIntoRally(rows, `Page ${i + 1}`); p.state = 'ok'; p.msg = `${rows.length} RIs`; msgs.push(s); }
    } catch (e) {
      p.state = 'bad'; p.msg = e && e.code === 'not_granted' ? 'Not allowed' : 'Failed';
      msgs.push(`Page ${i + 1}: ${e && (e.message || e.code) || 'failed'}`);
      if (e && (e.code === 'not_granted' || e.code === 'rate_limited')) break;
    }
    renderRoute();
  }
  reading = false; renderRoute();
  if (msgs.length) confirmBox('Pages read', msgs.map(esc).join('<br>') + '<br><br>Rows are merged by RI and sorted. Highlighted rows need checking.', 'OK', null, '');
}

const CHAT_PROMPT = `I'm attaching photos of SCCA RoadRally Route Instruction pages. Transcribe every route instruction (RI) row from all pages into ONE JSON array, in RI order, inside a single \`\`\`json code block, with nothing else after it.
Each element: {"ri": RI number as printed, "om": the OM column EXACTLY as printed as a string (keep a restart's slash, e.g. "13.27/0.00"), "czt": CZT as printed ("HH:MM:SS" or "HH:MM.cc") or null, "cp": checkpoint number or null, "instr": instruction text exactly as printed, "info": any notes text or "", "note": only if something is illegible or uncertain}.
Include rows with no CZT. Never guess: use null for blank cells.`;
// Read the pages in an ordinary Claude chat (works where this page cannot open the photo picker).
function chatRead() {
  confirmBox('Read pages in a Claude chat', `<ol class="steps">
      <li>Tap <b>Copy instructions</b>.</li>
      <li>Open a new Claude chat, attach the page photos, paste the instructions, and send.</li>
      <li>Copy Claude's whole reply, come back here, and tap <b>Paste rows</b>.</li></ol>
    <div class="small muted">Rows are merged by RI, so you can do this a few pages at a time.</div>`,
    'Paste rows', () => { pasteRows(); }, 'Close');
  const b = document.createElement('button'); b.textContent = 'Copy instructions'; b.className = 'primary'; b.style.marginTop = '8px'; b.style.width = '100%';
  b.onclick = async () => { try { await navigator.clipboard.writeText(CHAT_PROMPT); b.textContent = 'Copied ✓'; }
    catch (e) { const ta = document.createElement('textarea'); ta.rows = 6; ta.readOnly = true; ta.value = CHAT_PROMPT; ta.style.fontSize = '12px'; ta.style.marginTop = '6px';
      b.replaceWith(ta); ta.focus(); ta.select(); toast('Select all and copy this text'); } };
  $('mBody').appendChild(b);
}
// A copied photo can be pasted on the Route tab (Ctrl/Cmd-V, or long-press → Paste where the device allows).
document.addEventListener('paste', e => {
  if (view !== 'route' || $('modal').classList.contains('on')) return;
  const files = [...(e.clipboardData && e.clipboardData.files || [])].filter(f => /^image\//.test(f.type));
  if (!files.length) return;
  e.preventDefault();
  for (const f of files) pages.push({ file: f, url: URL.createObjectURL(f), state: '', msg: '' });
  toast(`${files.length} pasted photo(s) added`); renderRoute();
});

function pasteRows() {
  confirmBox('Paste rows', `<div class="small muted">Paste Claude's reply (its JSON is found automatically), a JSON array of rows, or CSV lines: RI,OM,CZT,CP,Instruction,Info.</div>
    <textarea id="pasteBox" rows="10" style="margin-top:8px;font-size:13px"></textarea>`, 'Merge', () => {
    const t = $('pasteBox').value.trim(); if (!t) return;
    let rows = [];
    try { rows = Core.parseOCR(t); } catch (e) { rows = []; }
    if (!rows.length && /^[^\n]*,[^\n]*,/.test(t)) { try { rows = parseCSVRows(t); } catch (e) { rows = []; } }
    if (!rows.length) { toast('No rows found in that text'); return false; }
    toast(mergeIntoRally(rows, 'Pasted')); renderRoute();
  });
}
function parseCSVRows(t) {
  const out = [];
  for (const line of t.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = []; let cur = '', q = false;
    for (let k = 0; k < line.length; k++) {
      const ch = line[k];
      if (q) { if (ch === '"' && line[k + 1] === '"') { cur += '"'; k++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur);
    if (/^\s*ri\s*$/i.test(cells[0])) continue;
    out.push({ ri: cells[0], om: cells[1], czt: cells[2] || null, cp: cells[3] || null, instr: cells[4] || '', info: cells[5] || '' });
  }
  return out;
}

// ---------------------------------------------------------------- RUN (operation)
// The Run list keeps whatever position the user scrolled to across re-renders.
const runPos = { list: 0, top: 0 };
function renderRun() {
  const r = R(), v = $('v-run');
  const oldW = $('runWrap'), oldT = v.querySelector('.runtop');
  if (oldW) runPos.list = oldW.scrollTop;
  if (oldT) runPos.top = oldT.scrollTop;
  if (!r.rows.length) { v.innerHTML = '<div class="narrow"><p class="muted">No route table yet.</p><button class="primary" id="goR">Build it on Route</button></div>'; $('goR').onclick = () => show('route'); return; }
  const C = Core.compute(r), a = Core.activeIndex(r), done = r.rows.filter(x => x.done).length;
  let card;
  if (a < 0) {
    card = `<div class="active-card"><div class="ac-ri">All ${r.rows.length} RIs complete</div>
      <div class="ac-btns" style="grid-template-columns:1fr"><button id="btnUndo">Undo last complete</button></div></div>`;
  } else {
    const x = r.rows[a], c = C[a], nx = r.rows[a + 1], cn = C[a + 1];
    const ttHtml = c.tt != null ? `<div class="big num">${fmtT(c.tt)}</div>`
      : (c.est != null ? `<div class="big num est">≈${fmtT(c.est)}</div>
          <div class="small muted">est. at ${esc(r.speedo)} mph from RI ${esc(c.estAnchor)}</div>`
      : `<div class="big num muted">—</div><div class="small muted">${r.speedo ? 'no earlier TT in this leg' : 'set speedometer for an estimate'}</div>`);
    card = `<div class="active-card">
      <div class="ac-head"><span class="ac-ri">RI ${esc(x.ri)}</span>
        ${c.restart ? '<span class="badge rs">RESTART · zero trip odo</span>' : ''}
        ${x.cp ? `<span class="badge cp">CP ${esc(x.cp)}</span>` : ''}
        ${c.ta ? `<span class="badge ta">TA ${fmtTA(c.ta)}</span>` : ''}
        ${c.gapNext != null && c.gapNext <= Core.closeMi(r) + 1e-9 ? `<span class="badge close">NEXT IN ${c.gapNext.toFixed(2)}</span>` : ''}
        <span class="progress" style="margin-left:auto">${done}/${r.rows.length} complete</span></div>
      <div class="ac-nums">
        <div><div class="lbl">VM</div><div class="big num">${c.restart && c.vmPrevEnd != null ? `<span style="font-size:.55em">${fmtVM(c.vmPrevEnd)}/</span>` : ''}${fmtVM(c.vm) || '—'}</div></div>
        <div><div class="lbl">TT</div>${ttHtml}</div>
      </div>
      <div class="ac-instr">${esc(x.instr) || '<span class="muted">(no instruction text)</span>'}</div>
      ${x.info ? `<div class="ac-info">${esc(x.info)}</div>` : ''}
      ${nx ? `<div class="ac-next num">Next: RI ${esc(nx.ri)}${cn.restart ? ' (restart)' : ''} · VM ${fmtVM(cn.vm) || '—'}${cn.tt != null ? ' · TT ' + fmtT(cn.tt) : cn.est != null ? ' · TT ≈' + fmtT(cn.est) : ''} · ${esc(nx.instr)}</div>` : ''}
      <div class="ac-btns"><button id="btnUndo" ${done ? '' : 'disabled'}>Undo</button><button class="primary" id="btnDone">Complete RI ${esc(x.ri)} ✓</button></div>
    </div>
    <div class="ctl">
      <div class="grp ta"><div class="lbl">Time adj.</div>
        <button id="btnTA" class="num ${c.ta ? 'ta-on' : ''}" aria-label="Time adjustment">${fmtTA(c.ta)}</button></div>
      <div class="grp sp"><div class="lbl">Speedometer mph</div>
        <div class="stepper"><button data-sp="-5">−5</button><button data-sp="-1">−1</button><input id="fSpeedo" class="num" value="${esc(r.speedo)}" inputmode="decimal" enterkeyhint="done" aria-label="Speedometer mph"><button data-sp="1">+1</button><button data-sp="5">+5</button><button class="set" data-set="fSpeedo">Set</button></div></div>
    </div>`;
  }
  v.innerHTML = `<div class="runtop">${card}</div>
  <div class="runtable tablewrap" id="runWrap"><table id="runTbl"><thead><tr>
    <th></th><th>RI</th><th class="n">VM</th><th class="n">TT</th><th class="col-wide">CP</th><th>Instruction</th></tr></thead>
  <tbody>${r.rows.map((x, i) => {
    const c = C[i];
    const tt = c.tt != null ? fmtT(c.tt) + (c.taSet ? '<span class="tamark" title="TA entered here">TA</span>' : '')
      : (c.est != null ? `<span class="est">≈${fmtT(c.est)}</span>` : '');
    return `<tr data-i="${i}" class="${x.done ? 'done' : ''} ${i === a ? 'active' : ''} ${c.restart && i > 0 ? 'rs' : ''} ${c.close ? 'close' : ''}">
      <td class="chk"><span data-chk="${i}">${x.done ? '✓' : ''}</span></td>
      <td class="num">${esc(x.ri)}${c.restart ? '<span class="badge rs" style="font-size:10px;margin-left:3px;padding:0 4px">R</span>' : ''}</td>
      <td class="n num vm">${c.restart && c.vmPrevEnd != null ? fmtVM(c.vmPrevEnd) + '/' : ''}${fmtVM(c.vm)}</td>
      <td class="n num tt">${tt}</td>
      <td class="col-wide num">${esc(x.cp ?? '')}</td>
      <td class="instr">${esc(x.instr)}${x.info ? `<div class="info">${esc(x.info)}</div>` : ''}</td></tr>`;
  }).join('')}</tbody></table></div>`;

  const w = $('runWrap'), t = v.querySelector('.runtop');
  if (w) { w.scrollTop = runPos.list; w.addEventListener('scroll', () => { runPos.list = w.scrollTop; }, { passive: true }); }
  if (t) { t.scrollTop = runPos.top; t.addEventListener('scroll', () => { runPos.top = t.scrollTop; }, { passive: true }); }
  if ($('btnDone')) $('btnDone').onclick = () => {
    r.rows = Core.completeActive(r, now()); save(r); renderRun(); scrollActive();   // the one programmatic scroll
  };
  $('btnUndo').onclick = () => {
    const k = Core.lastCompleted(r); if (k < 0) return;
    r.rows = Core.uncomplete(r, k); save(r); renderRun(); toast(`RI ${r.rows[k].ri} marked not complete`);
  };
  if ($('btnTA')) $('btnTA').onclick = () => taDialog(a);
  v.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => setSpeedo((+r.speedo || 0) + +b.dataset.sp));
  if ($('fSpeedo')) editField($('fSpeedo'), val => {
    const s = val.trim();
    if (s !== '' && !(+s > 0 && +s <= SPEEDO_MAX)) { toast(`Speedometer must be between 1 and ${SPEEDO_MAX} mph`); return false; }
    setSpeedo(s === '' ? '' : +s);
  });
  $('runTbl').addEventListener('click', e => {
    const chk = e.target.closest('[data-chk]');
    if (!chk) return;
    const i = +chk.dataset.chk, x = r.rows[i];
    if (!x.done) return;
    confirmBox('Mark not complete?', `RI ${esc(x.ri)} will be marked not complete${i < a || a < 0 ? ' and becomes the active RI' : ''}.`, 'Mark not complete', () => {
      r.rows = Core.uncomplete(r, i); save(r); renderRun();
    });
  });
}
// Tapping a field selects its whole value, so typing replaces it.
function selectOnTap(inp) {
  let fresh = false, timers = [];
  const selNow = () => { if (fresh) try { inp.setSelectionRange(0, inp.value.length); } catch (e) { inp.select(); } };
  const stop = () => { timers.forEach(clearTimeout); timers = []; };
  const selectAll = () => { selNow(); stop(); timers = [setTimeout(selNow, 0), setTimeout(selNow, 60)]; };
  inp.addEventListener('focus', () => { fresh = true; selectAll(); });
  inp.addEventListener('keydown', () => { fresh = false; stop(); });
  // the tap that focused the field would otherwise drop the caret and undo the selection
  const keepSel = e => { if (fresh) { e.preventDefault(); selectAll(); } };
  inp.addEventListener('mouseup', keepSel);
  inp.addEventListener('touchend', keepSel);
  inp.addEventListener('click', () => { if (fresh) { selectAll(); setTimeout(() => { fresh = false; }, 80); } });
  inp.addEventListener('input', () => { fresh = false; stop(); });
  inp.addEventListener('blur', () => { fresh = false; stop(); });
}
// Direct entry: tapping selects the current value; Enter or Set commits; leaving the field
// (or Esc) restores the previous value. commit(value) returns false to reject.
function editField(inp, commit) {
  let orig = inp.value, done = false;
  selectOnTap(inp);
  const finish = () => {
    if (done) return; done = true;
    const val = inp.value;
    if (val === orig) { inp.blur(); return; }
    if (commit(val) === false) { inp.value = orig; done = false; inp.blur(); }
  };
  inp.addEventListener('focus', () => { orig = inp.value; done = false; });
  inp.addEventListener('blur', () => { if (!done) inp.value = orig; });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); finish(); }
    else if (e.key === 'Escape') { inp.value = orig; inp.blur(); }
  });
  const set = inp.parentElement.querySelector(`[data-set="${inp.id}"]`);
  if (set) {
    const go = e => { e.preventDefault(); finish(); };
    set.addEventListener('pointerdown', go);
    set.addEventListener('mousedown', e => e.preventDefault());
  }
}
const TA_MAX = 90 * 60, SPEEDO_MAX = 100;
// TA dialog: steps and typing change a pending value; Set applies it, Cancel or tapping outside leaves TA as it was.
function taDialog(a) {
  const r = R(), C = Core.compute(r), x = r.rows[a];
  let pend = C[a].ta || 0;
  const steps = [-60, -15, -5, 5, 15, 60];
  confirmBox(`Time adjustment`, `<div class="small muted">Applies from RI ${esc(x.ri)} through the RI before the next restart.
      Currently ${fmtTA(C[a].ta)}.</div>
    <input id="taIn" class="num" inputmode="text" enterkeyhint="done" value="${fmtTA(pend)}" style="font-size:28px;text-align:center;margin:10px 0;min-height:56px">
    <div class="tagrid">${steps.map(s => `<button data-st="${s}">${s < 0 ? '−' : '+'}${Math.abs(s)}</button>`).join('')}</div>
    <div class="row" style="margin-top:8px"><button id="taZero" style="flex:1">Zero</button></div>
    <div class="small muted" style="margin-top:6px">Type seconds (−12), m:ss (+1:05), or minutes (.50m). Limit ±90:00.</div>`, 'Set', () => {
      const s = Core.parseRel($('taIn').value);
      if (s == null) { toast('TA: seconds (−12), m:ss (+1:05), or minutes (.50m)'); return false; }
      if (Math.abs(s) > TA_MAX) { toast('TA is limited to ±90:00'); return false; }
      setTA(a, s);
    });
  const inp = $('taIn');
  const show = () => { inp.value = fmtTA(pend); };
  const readTyped = () => { const s = Core.parseRel(inp.value); if (s != null) pend = s; };
  document.querySelectorAll('#mBody [data-st]').forEach(b => b.onclick = () => {
    readTyped(); pend = Math.max(-TA_MAX, Math.min(TA_MAX, pend + +b.dataset.st)); show(); });
  $('taZero').onclick = () => { pend = 0; show(); };
  selectOnTap(inp);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('mOk').click(); } });
}

// Full screen: ask the browser where allowed, and always hide the app's own header and tabs.
const fsEl = document.documentElement;
const fsNative = () => document.fullscreenElement || document.webkitFullscreenElement;
async function setFull(on) {
  document.body.classList.toggle('focus', on);
  try {
    if (on && !fsNative()) await (fsEl.requestFullscreen ? fsEl.requestFullscreen({ navigationUI: 'hide' }) : fsEl.webkitRequestFullscreen && fsEl.webkitRequestFullscreen());
    if (!on && fsNative()) await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen && document.webkitExitFullscreen());
  } catch (e) {}
}
$('btnFS').onclick = () => setFull(true);
$('btnFSx').onclick = () => setFull(false);
const fsChange = () => { if (!fsNative() && document.body.classList.contains('focus') && setFull._wasNative) setFull(false); setFull._wasNative = !!fsNative(); };
document.addEventListener('fullscreenchange', fsChange);
document.addEventListener('webkitfullscreenchange', fsChange);

function setTA(a, sec) {
  const r = R(); sec = Math.max(-TA_MAX, Math.min(TA_MAX, Math.round(sec * 100) / 100));
  r.taEvents = Core.setTA(r, a, sec, now()); save(r); renderRun();
}
function setSpeedo(v) { const r = R(); r.speedo = v === '' ? '' : Math.min(SPEEDO_MAX, Math.max(1, Math.round(v * 10) / 10)); save(r); renderRun(); }
function scrollActive(behavior = 'smooth') {
  requestAnimationFrame(() => {
    const w = $('runWrap'), tr = w && w.querySelector('tr.active');
    if (!w || !tr) return;
    const head = w.querySelector('thead').offsetHeight;
    const prev = tr.previousElementSibling;
    const top = Math.max(0, (prev ? prev.offsetTop : tr.offsetTop) - head);
    runPos.list = top;
    try { w.scrollTo({ top, behavior }); } catch (e) { w.scrollTop = top; }
  });
}

// ---------------------------------------------------------------- DATA
function getApiKey() { try { return localStorage.getItem(LS_KEY_API) || ''; } catch (e) { return ''; } }
const fileBase = r => ((r.date || '') + ' ' + (r.name || 'rally')).trim().replace(/[^\w.-]+/g, '_');
async function offerFile(filename, data, mime) {
  if (!caps.downloads) caps.downloads = await useCap('downloads');
  if (caps.downloads) {
    try { await caps.downloads.save({ filename, data }); return; }
    catch (e) { if (e && e.code && !/unavail|not_granted|disabled|removed/.test(e.code)) { toast('Download not saved'); return; } }
  }
  if (!hasClaude) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: mime })); a.download = filename;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); return;
  }
  toast('Downloads are not available here. Use Copy instead.');
}
async function copyText(t, what) {
  try { await navigator.clipboard.writeText(t); toast(what + ' copied'); }
  catch (e) { confirmBox('Copy ' + what, `<textarea rows="10" readonly style="font-size:12px">${esc(t)}</textarea>`, 'Close', null, ''); }
}
function renderData() {
  const r = R();
  const done = r.rows.filter(x => x.done).length;
  const tas = (r.taEvents || []).slice().sort((x, y) => Core.cmpRI(x.ri, y.ri));
  $('dataBody').innerHTML = `
  <div class="card"><h2>${esc(r.name || 'Untitled rally')}</h2>
    <div class="small">${esc(r.date)} · Car ${esc(r.cn)} · Class ${esc(r.cls || '—')} · OCF ${esc(r.ocf)} · Driver ${esc(r.crew.driver || '—')} · Navigator ${esc(r.crew.navigator || '—')}${r.crew.passengers.filter(Boolean).length ? ' · Passengers ' + esc(r.crew.passengers.filter(Boolean).join(', ')) : ''}</div>
    <div class="small muted" style="margin-top:4px">${r.rows.length} RIs · ${done} complete · TAs entered: ${tas.length ? tas.map(t => `RI ${esc(t.ri)} ${fmtTA(t.ta)}`).join(', ') : 'none'}</div>
    <div class="small muted" style="margin-top:4px">Storage: ${lsOK ? 'saved on this device' : 'NOT saved on this device'}${Cloud.col ? `; private copy in your Claude account${Cloud.last ? ' (last saved ' + new Date(Cloud.last).toLocaleTimeString() + ')' : ''}` : ''}.</div>
  </div>
  <div class="card"><h3>Export</h3>
    <div class="row"><button id="xCSV">Download CSV</button><button id="xJSON">Download JSON</button>
      <button id="cCSV">Copy CSV</button><button id="cJSON">Copy JSON</button></div>
    <div class="small muted" style="margin-top:6px">CSV holds the augmented route table (OM, VM, CZT, TA, TT, estimates, completion times). JSON is the full rally record and can be imported back.</div>
  </div>
  <div class="card"><h3>Import</h3>
    <span class="filebtn">Import rally JSON<input type="file" id="fImport" accept=".json,application/json,text/plain" aria-label="Import rally JSON"></span>
    <div class="small muted" style="margin-top:6px">Adds the rally as a new entry; nothing existing is overwritten.</div>
  </div>
  <div class="card"><h3>Offline copy</h3>
    <div class="row"><button id="xApp">Download app as HTML file</button></div>
    <div class="small muted" style="margin-top:6px">Inside Claude, open this page before you lose signal and keep it open; it needs no internet once loaded. The HTML file is a standalone copy for a phone or laptop browser; its saved rallies stay in that browser.</div>
    ${!caps.sample ? `<label for="fKey">Anthropic API key (standalone copy only, for reading photos; kept on this device, never exported)</label>
      <div class="row"><input id="fKey" type="password" value="${esc(getApiKey())}" autocomplete="off" style="flex:1"><button id="bKey">Save key</button></div>` : ''}
  </div>
  <div class="card"><h3>Reset or delete</h3>
    <div class="row"><button id="bResetRun" ${done || tas.length ? '' : 'disabled'}>Clear completion marks and TAs</button>
      <button id="bDup">Duplicate rally</button>
      <button id="bDel" class="danger">Delete rally</button></div>
  </div>`;
  const csv = () => Core.toCSV(r, store.prefs.fmt), json = () => JSON.stringify({ app: 'rally-route-table', version: 1, rally: r }, null, 1);
  $('xCSV').onclick = () => offerFile(fileBase(r) + '.csv', csv(), 'text/csv');
  $('xJSON').onclick = () => offerFile(fileBase(r) + '.json', json(), 'application/json');
  $('cCSV').onclick = () => copyText(csv(), 'CSV');
  $('cJSON').onclick = () => copyText(json(), 'JSON');
  $('xApp').onclick = () => offerFile('rally-route-table.html', SELF_HTML, 'text/html');
  $('fImport').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const j = JSON.parse(await f.text()); const src = j.rally || j;
      if (!Array.isArray(src.rows)) throw new Error('no rows');
      const nr = { ...blankRally(), ...src, id: newId(), updated: now() };
      nr.rows = nr.rows.map(Core.normRow); nr.crew = { driver: '', navigator: '', passengers: [], ...(src.crew || {}) };
      if (store.rallies[src.id]) nr.name = (nr.name || 'Rally') + ' (imported)';
      store.rallies[nr.id] = nr; store.cur = nr.id; save(nr); toast('Imported ' + (nr.name || 'rally')); renderAll();
    } catch (err) { toast('That file is not a rally JSON export'); }
  };
  if ($('bKey')) $('bKey').onclick = () => { try { localStorage.setItem(LS_KEY_API, $('fKey').value.trim()); toast('Key saved on this device'); } catch (e) { toast('Could not save the key'); } };
  $('bResetRun').onclick = () => confirmBox('Clear run data', 'Clear all completion marks, time adjustments, and estimate toggles? The route table stays.', 'Clear', () => {
    r.rows = r.rows.map(x => ({ ...x, done: false, ttDone: null, doneAt: null, estLock: null, estLockBy: null })); r.taEvents = []; save(r); renderData();
  });
  $('bDup').onclick = () => {
    const nr = JSON.parse(JSON.stringify(r)); nr.id = newId(); nr.name = (r.name || 'Rally') + ' (copy)'; nr.created = nr.updated = now();
    store.rallies[nr.id] = nr; store.cur = nr.id; save(nr); toast('Duplicated'); renderAll();
  };
  $('bDel').onclick = () => confirmBox('Delete rally', `Delete “${esc(r.name || 'Untitled rally')}” and its route table from this device${Cloud.col ? ' and your account' : ''}? Export it first if you want a record.`, 'Delete', () => {
    delete store.rallies[r.id]; store.cur = null; Cloud.queue(r.id); save(); show('rallies');
  });
}

// ---------------------------------------------------------------- boot
applyTheme();
(function boot() {
  const h = (location.hash || '').slice(1);
  if (store.cur && !store.rallies[store.cur]) store.cur = null;
  show(['setup', 'route', 'run', 'data'].includes(h) && R() ? h : (R() && R().rows.length ? 'run' : 'rallies'));
  renderCloud(); renderStorageWarn();
})();
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== view && ['rallies', 'setup', 'route', 'run', 'data'].includes(h)) show(h); });
(async () => {
  caps.sample = await useCap('sample');
  if (caps.sample) { try { const lim = await caps.sample.limits(); if (!lim || !lim.images) caps.sample = null; } catch (e) {} }
  if (view === 'route' || view === 'data') renderView();
  Cloud.init();
})();

confirmBox.gen = 0;
