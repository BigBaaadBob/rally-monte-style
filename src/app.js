'use strict';
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtVM = v => v == null ? '' : v.toFixed(2);
const now = () => Date.now();
const LS_KEY = 'rallyMonteStyle.v1', LS_KEY_API = 'rallyMonteStyle.apikey';
// Keys of earlier versions are deleted unread (a stale API key must not stay in storage); there is no migration.
for (const k of ['rallyRT.v1', 'rallyRT.apikey']) { try { localStorage.removeItem(k); } catch (e) {} }
const APP_VERSION = (document.querySelector('meta[name="app-version"]') || {}).content || 'dev';
// Models for reading pages with your own API key. Costs are rough per-page estimates (Nov 2026 list prices).
const MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 (recommended, about 2¢/page)' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 (cheapest, about 0.1¢/page)' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5 (most careful, about 7¢/page)' },
];
const OPUS = 'claude-opus-5-5';
const SPEEDO_START = 35;            // default speedometer for a new rally (then saved with the rally)

// ---------------------------------------------------------------- storage
let lsOK = true;
let store = { rallies: {}, cur: null, prefs: { theme: 'day', fmt: 'hms', model: 'claude-sonnet-5-5' } };
try {
  const raw = localStorage.getItem(LS_KEY);
  if (raw) { const s = JSON.parse(raw); store = { ...store, ...s, prefs: { ...store.prefs, ...(s.prefs || {}) } }; }
} catch (e) { lsOK = false; }
for (const r of Object.values(store.rallies)) { if (typeof r.vehicle !== 'string') r.vehicle = ''; if (Array.isArray(r.rows)) Core.dropStaleImgCheck(r.rows); }   // a row with a band never has imgCheck

function newId() { return 'r' + now().toString(36) + Math.random().toString(36).slice(2, 7); }
function blankRally() {
  return { id: newId(), name: '', date: (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(new Date()),
    crew: { driver: '', navigator: '', passengers: [] }, vehicle: '', cn: '', ocf: 1, speedo: SPEEDO_START,
    rows: [], taEvents: [], created: now(), updated: now() };
}
const R = () => store.rallies[store.cur] || null;
const fmtOCF = Core.fmtOCF;   // OCF is always shown with four decimals

function save(rally) {
  if (rally) rally.updated = now();
  try { localStorage.setItem(LS_KEY, JSON.stringify(store)); lsOK = true; }
  catch (e) { lsOK = false; }
  renderStorageWarn();
}
function renderStorageWarn() {
  renderStorage();
  $('storageWarn').innerHTML = lsOK ? '' :
    '<div class="banner">This browser is not letting the page save on the device. Your data lasts only while the page stays open. Use Data → Export before closing.</div>';
}

function renderStorage() { $('storage').textContent = lsOK ? 'Saved on device' : 'Not saved!'; }

// ---------------------------------------------------------------- page copies (DESIGN § Reading pages → Page images)
// The image sent to the reader is kept in IndexedDB while a row's band refers to it. pageIndex (id -> bytes)
// mirrors what is stored, so flags and the Data line stay synchronous; pagesReady is true once it has loaded.
const IDB_NAME = 'rallyMonteStyle.pages', IDB_STORE = 'pages';
const pageIndex = new Map(), pendingPages = new Set(), cropCache = new Map();
let pagesReady = false, persistAsked = false, idbP = null;
function idb() {
  if (!idbP) idbP = new Promise((res, rej) => {
    try { const q = indexedDB.open(IDB_NAME, 1); q.onupgradeneeded = () => q.result.createObjectStore(IDB_STORE); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }
    catch (e) { rej(e); }
  });
  return idbP;
}
const idbReq = (mode, fn) => idb().then(db => new Promise((res, rej) => {
  const tx = db.transaction(IDB_STORE, mode), q = fn(tx.objectStore(IDB_STORE));
  tx.oncomplete = () => res(q && q.result); tx.onerror = tx.onabort = () => rej(tx.error);
}));
const pageGet = id => idbReq('readonly', s => s.get(id));
const pageDel = id => idbReq('readwrite', s => s.delete(id));
async function pagePut(id, blob) {
  await idbReq('readwrite', s => s.put(blob, id));
  pageIndex.set(id, blob.size);
  if (!persistAsked && navigator.storage && navigator.storage.persist) { persistAsked = true; try { navigator.storage.persist().catch(() => {}); } catch (e) {} }
}
async function loadPageIndex() {
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const q = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).openCursor();
      q.onsuccess = () => { const c = q.result; if (c) { pageIndex.set(c.key, c.value.size); c.continue(); } else res(); };
      q.onerror = () => rej(q.error);
    });
  } catch (e) {}
  pagesReady = true;
  if (lsOK) gcPages();
  const r = R(); if (r && r.rows.some(x => x.band || (x.signs && x.signs.length))) renderView();
}
// Frees every page copy that no row refers to (and that is not waiting for a read to merge).
async function gcPages() {
  if (!pagesReady || !lsOK) return;
  const used = new Set();
  for (const r of Object.values(store.rallies)) Core.pagesUsed(r.rows).forEach(p => used.add(p));
  for (const id of [...pageIndex.keys()]) {
    if (used.has(id) || pendingPages.has(id)) continue;
    pageIndex.delete(id);
    for (const [k, c] of [...cropCache]) if (k.startsWith(id + '|')) { URL.revokeObjectURL(c.url); cropCache.delete(k); }
    if (sgURL.has(id)) { URL.revokeObjectURL(sgURL.get(id)); sgURL.delete(id); }
    try { await pageDel(id); } catch (e) {}
  }
}
const bandKey = b => [b.page, b.top, b.bottom, b.left, b.right].join('|');
// Crop of a row's band from its page copy: {url, w, h}, cached; null when the copy is missing.
async function bandCrop(b) {
  const k = bandKey(b); if (cropCache.has(k)) return cropCache.get(k);
  let bmp;
  try {
    const blob = await pageGet(b.page); if (!blob) return null;
    bmp = await createImageBitmap(blob);
    const sx = Math.round(b.left * bmp.width), sy = Math.round(b.top * bmp.height), sw = Math.max(1, Math.round((b.right - b.left) * bmp.width)), sh = Math.max(1, Math.round((b.bottom - b.top) * bmp.height));
    const cv = document.createElement('canvas'); cv.width = sw; cv.height = sh;
    cv.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
    const out = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.85));
    if (!out) return null;
    const c = { url: URL.createObjectURL(out), w: sw, h: sh }; cropCache.set(k, c); return c;
  } catch (e) { return null; } finally { if (bmp) bmp.close(); }
}
// Page control (DESIGN § Sign images): a button that opens the row's whole band full screen. '' when the row has no band or its copy is missing.
function pageBtn(x) {
  const b = x.band; if (!b || !pagesReady || !pageIndex.has(b.page)) return '';
  return `<button class="pgbtn" data-pg="${esc(b.page)}" data-b="${b.top},${b.bottom},${b.left},${b.right}" aria-label="Show the page image for RI ${esc(x.ri)}">Page</button>`;
}
// The instruction with its sign images (rule 14): each [sign: …] is replaced by its image when the counts agree;
// a tag with no image is a muted placeholder box; otherwise the images follow the text.
const sgURL = new Map();                          // sign image id -> object URL
function signHtml(x, cls) {
  const ids = pagesReady ? (x.signs || []).filter(id => pageIndex.has(id)) : [];
  const sp = Core.signParts(x.instr, ids.length);
  const img = (i, alt) => { const id = ids[i], u = sgURL.get(id); return `<img class="sgimg ${cls || ''}" role="button" alt="${esc(alt)}" data-sg="${esc(id)}"${u ? ` src="${u}"` : ''}>`; };
  let h = sp.parts.map(p => p.t === 'text' ? esc(p.s) : p.img >= 0 ? img(p.img, p.s) : `<span class="sgph">${esc(p.s)}</span>`).join('');
  if (sp.after.length) h += `<div class="sgafter">${sp.after.map(i => img(i, 'Sign image ' + (i + 1))).join('')}</div>`;
  return h;
}
async function hydrateImages(root) {
  for (const im of root.querySelectorAll('img.sgimg:not([src])')) {
    const id = im.dataset.sg; let u = sgURL.get(id);
    if (!u) { try { const blob = await pageGet(id); if (blob) { u = URL.createObjectURL(blob); sgURL.set(id, u); } } catch (e) {} }
    if (u) im.src = u;
  }
}
// Tap a sign image to see it full screen, or the Page control to see the row's whole band; a tap anywhere closes it. It changes no run state.
function showFull(url) { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); $('imgFull').src = url; $('imgView').classList.add('on'); }
document.addEventListener('click', async e => {
  const t = e.target.closest && e.target.closest('img.sgimg, button.pgbtn');
  if (!t) return;
  if (t.tagName === 'IMG') { if (t.src) showFull(t.src); return; }
  const [top, bottom, left, right] = t.dataset.b.split(',').map(Number), c = await bandCrop({ page: t.dataset.pg, top, bottom, left, right });
  if (c) showFull(c.url);
});
$('imgView').onclick = () => { $('imgView').classList.remove('on'); $('imgFull').removeAttribute('src'); };

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
const fmtTA = s => Core.fmtTA(s) || '0:00';   // TA is always m:ss, whatever the Time format

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
  $('hdrTitle').innerHTML = r ? `${esc(r.name || 'Untitled rally')}<span class="sub">${esc(r.date || '')}${r.cn !== '' ? ' · Car ' + esc(r.cn) : ''}${r.cls ? ' · Class ' + esc(r.cls) : ''}</span>` : 'Rally: Monte Style';
  document.querySelectorAll('#tabs button').forEach(b => b.disabled = b.dataset.v !== 'rallies' && !r);
}
function applyTheme() { document.documentElement.dataset.theme = store.prefs.theme; }
function renderView() {
  renderHeader();
  ({ rallies: renderRallies, setup: renderSetup, route: renderRoute, run: renderRun, data: renderData }[view])();
}
function renderAll() { applyTheme(); renderStorageWarn(); renderView(); }

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
// ---------------------------------------------------------------- install (home-screen web app)
const isInstalled = () => { try { return matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true; } catch (e) { return false; } };
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const canInstall = () => /^https:$/.test(location.protocol) && !isInstalled();
let installEvt = null;                                   // Android/Chrome install prompt, when offered
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (view === 'rallies') renderRallies(); });
window.addEventListener('appinstalled', () => { installEvt = null; if (view === 'rallies') renderRallies(); });
function installHint() {
  if (!canInstall()) return '';
  const how = isIOS()
    ? 'In Safari, tap <b>Share</b> → <b>Add to Home Screen</b> → <b>Add</b>.'
    : installEvt ? 'Tap <b>Install</b>.' : 'In Chrome, open the <b>⋮</b> menu → <b>Install app</b> (or <b>Add to Home screen</b>).';
  return `<div class="card" id="installCard"><h2>Install this app</h2>
    <div class="small">${how} It then opens from its icon, full screen, and works with no internet.</div>
    ${isIOS() ? '<div class="small muted" style="margin-top:6px">The installed app keeps its own storage, separate from Safari: set up your rallies in the installed app.</div>' : ''}
    ${installEvt ? '<div class="row" style="margin-top:8px"><button class="primary" id="btnInstall">Install</button></div>' : ''}</div>`;
}

function renderRallies() {
  const list = Object.values(store.rallies).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updated - a.updated);
  $('installSlot').innerHTML = installHint();
  if ($('btnInstall')) $('btnInstall').onclick = async () => { const e = installEvt; installEvt = null; try { e.prompt(); await e.userChoice; } catch (err) {} renderRallies(); };
  $('rallyList').innerHTML = list.length ? list.map(r => {
    const done = r.rows.filter(x => x.done).length;
    return `<div class="card rally-item ${r.id === store.cur ? 'cur' : ''}">
      <div class="grow"><div class="name">${esc(r.name || 'Untitled rally')}</div>
      <div class="small muted">${esc(r.date || '')}${r.cn !== '' ? ' · Car ' + esc(r.cn) : ''} · ${r.rows.length} Route Instructions${r.rows.length ? ` · ${done} complete` : ''}</div></div>
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
  Object.assign(r, JSON.parse(JSON.stringify(SAMPLE.rally)));
  r.rows = Core.mergeRows([], SAMPLE.rows).rows;
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
      <div><label for="fOCF">OCF (VM = OM × OCF)</label><input id="fOCF" inputmode="decimal" value="${esc(fmtOCF(r.ocf))}"></div>
      <div><label for="fCls">Class</label><select id="fCls"><option value="">—</option>${['A', 'B', 'C', 'D'].map(k => `<option ${r.cls === k ? 'selected' : ''}>${k}</option>`).join('')}</select></div>
    </div>
    <div class="small muted" id="ocfHelp"></div>
    <label for="fClose">Highlight adjacent Route Instructions this close or closer (vehicle miles)</label>
    <input id="fClose" inputmode="decimal" value="${esc(r.closeMi ?? 0.5)}" style="max-width:160px">
  </div>
  <div class="card"><h2>Crew and vehicle</h2>
    <div class="grid2">
      <div><label for="fDrv">Driver</label><input id="fDrv" value="${esc(c.driver)}" autocomplete="off"></div>
      <div><label for="fNav">Navigator</label><input id="fNav" value="${esc(c.navigator)}" autocomplete="off"></div>
    </div>
    <label>Passengers</label>
    <div id="paxList">${(c.passengers || []).map((p, i) => `<div class="row" style="margin-bottom:6px"><input data-pax="${i}" value="${esc(p)}" style="flex:1"><button data-paxdel="${i}" class="danger">Remove</button></div>`).join('')}</div>
    <button id="btnPax">Add passenger</button>
    <label for="fVeh">Vehicle</label><input id="fVeh" value="${esc(r.vehicle || '')}" autocomplete="off">
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
    <li>Route: add photos of the Route Instruction pages and check the Route Instructions (needs internet).</li>
    <li>Run: complete each RI as you reach it. No internet needed.</li></ol>
    <div class="row" style="margin-top:8px"><button class="primary" id="goRoute">Go to Route</button></div></div>`;
  const ocfHelp = () => { const v = +r.ocf; $('ocfHelp').textContent = v === 1 ? 'OCF 1.0000: VM equals OM.' : `Your odometer reads ${((v - 1) * 100).toFixed(2)}% ${v > 1 ? 'more' : 'less'} than official.`; };
  ocfHelp();
  const bind = (id, fn) => $(id).addEventListener('input', e => { fn(e.target.value); save(r); renderHeader(); });
  bind('fName', v => r.name = v);
  bind('fDate', v => r.date = v);
  // CN, OCF, and the close limit are checked when committed (change event); a bad entry shows its message and reverts.
  const checked = (id, parse, msg, apply, show) => $(id).addEventListener('change', e => {
    const v = parse(e.target.value);
    if (v === undefined) { toast(msg); e.target.value = show(); return; }
    apply(v); e.target.value = show(); save(r); renderHeader();
  });
  checked('fCN', v => { const s = v.trim(); return s === '' ? '' : /^\d{1,3}$/.test(s) ? +s : undefined; },
    'Car number must be a whole number from 0 to 999', v => { r.cn = v; }, () => String(r.cn ?? ''));
  checked('fOCF', v => { const s = v.trim(); return s !== '' && Number.isFinite(+s) && +s > 0 ? +s : undefined; },
    'OCF must be a positive number.', v => { r.ocf = v; ocfHelp(); }, () => fmtOCF(r.ocf));
  checked('fClose', v => { const s = v.trim(); return s === '' ? Core.CLOSE_MI : Number.isFinite(+s) && +s >= 0 && +s <= 5 ? +s : undefined; },
    'Close RI limit must be between 0 and 5.0 miles', v => { r.closeMi = v; }, () => String(r.closeMi ?? Core.CLOSE_MI));
  $('fCls').onchange = e => { r.cls = e.target.value; save(r); renderHeader(); };
  bind('fDrv', v => c.driver = v);
  bind('fNav', v => c.navigator = v);
  bind('fVeh', v => r.vehicle = v);
  $('paxList').querySelectorAll('[data-pax]').forEach(el => el.addEventListener('input', () => { c.passengers[+el.dataset.pax] = el.value; save(r); }));
  $('paxList').querySelectorAll('[data-paxdel]').forEach(el => el.onclick = () => { c.passengers.splice(+el.dataset.paxdel, 1); save(r); renderSetup(); });
  $('btnPax').onclick = () => { c.passengers.push(''); save(r); renderSetup(); const ins = $('paxList').querySelectorAll('input'); ins[ins.length - 1].focus(); };
  $('fFmt').onchange = e => { store.prefs.fmt = e.target.value; save(); };
  $('fTheme').onchange = e => { store.prefs.theme = e.target.value; save(); applyTheme(); };
  $('goRoute').onclick = () => show('route');
}

// ---------------------------------------------------------------- ROUTE (prep)
// Per rally, in memory only (DESIGN § Reading pages → Page photos).
const newByRally = {};          // rally id -> Set of RI numbers touched by the last import (highlighted)
const pagesByRally = {};        // rally id -> [{file, url, state:'' | 'busy' | 'ok' | 'bad', msg}]
const readingBy = new Set();    // ids of rallies with a read running
const newOf = id => newByRally[id] || (newByRally[id] = new Set());
const pagesOf = id => pagesByRally[id] || (pagesByRally[id] = []);
function dropPages(id) { (pagesByRally[id] || []).forEach(p => URL.revokeObjectURL(p.url)); delete pagesByRally[id]; }
function addPhotos(id, files) { for (const f of files) pagesOf(id).push({ file: f, url: URL.createObjectURL(f), state: '', msg: '' }); }
const OCR_PROMPT = `You are reading ONE photographed page of SCCA RoadRally (TDS, Monte Carlo style) Route Instructions. The page holds a table of numbered Route Instructions; each one is an RI.
Return ONLY a JSON object, no prose and no code fence: {"rotation": 0, "rows": [ one object per RI row, in page order ]}.
"rotation": the clockwise degrees the image must be turned for its text to read upright: 0 if it already does, 180 if it is upside down (90 or 270 only if the text runs sideways).
Each row object:
{"ri": RI number as printed (number, or string like "12A"),
 "om": the official mileage (OM) column EXACTLY as printed, as a string, e.g. "2.29"; a restart is printed with a slash, e.g. "13.27/0.00" or "/0.00", and you must keep the slash part,
 "czt": the checkpoint zero time (CZT) as printed ("HH:MM:SS" or "HH:MM.cc"), or null if blank,
 "cp": checkpoint number if the row names one (e.g. "CP 65" -> 65), else null,
 "instr": the instruction text exactly as printed (keep quotes, brackets, abbreviations, and exclamation marks); where the row shows a sign graphic or photo, write [sign: …] in its place, giving the words on the sign exactly, or a short description if it has no words, e.g. "CHECKPOINT at [sign: deer crossing]" or "RESTART at [sign: SPEED LIMIT 35]",
 "info": any additional-information or notes text for that row, else "",
 "row": the row's position in the table, counting the ruled rows below the column headings from 1 (a continued part at the top of the page counts as a row),
 "y": the row's vertical centre as a fraction of the image height measured on the image exactly as you were sent it (before any turn), 0 at the top edge and 1 at the bottom, to two decimals,
 "note": include ONLY if something in the row is illegible or uncertain, saying what}
Include every row, including rows with no CZT. If the page begins with the continuation of an RI from the previous page (a row with no RI number), do not return it, but still count it for "row". Never invent or infer values: use null for blank cells. If the page has no route instruction table, return {"rotation": 0, "rows": []}.`;

// Under a Route row: the instruction with its sign images in place (only when it has any sign tag or image) and the Page control.
function routeMedia(x) {
  const hasSigns = (x.signs && x.signs.length) || /\[sign:/i.test(x.instr || ''), pb = pageBtn(x);
  if (!hasSigns && !pb) return '';
  return `<tr class="pgrow"><td colspan="5"></td><td colspan="2">${hasSigns ? `<div class="rt-sign">${signHtml(x, 'rt-img')}</div>` : ''}${pb}</td><td></td></tr>`;
}
function renderRoute() {
  const r = R(), C = Core.compute(r);
  const pages = pagesOf(r.id), newSet = newOf(r.id);
  const flags = routeFlags(r, C), noSign = new Set(Core.noSignRows(r.rows));   // tagged rows with no sign image highlight (Core.noSignRows)
  const canOCR = !!getApiKey();
  $('routeBody').innerHTML = `
  <div class="card narrow" style="max-width:none">
    <h2>Read Route Instruction pages</h2>
    <div class="small muted">${getApiKey() ? 'Photos are sent to the Anthropic API with the key saved on this device. Internet is needed only for reading.'
      : 'To read photos, enter your Anthropic API key below (kept only on this device).'}</div>
    <div class="reader">
      <div><label for="fKey">Anthropic API key</label><input id="fKey" type="password" autocomplete="off" placeholder="${getApiKey() ? '•••••••• saved — type to replace' : 'sk-ant-…'}"></div>
      <button id="bKey">${getApiKey() ? 'Replace' : 'Save'}</button>
      <div style="grid-column:1/-1"><label for="fModel">Model for reading</label><select id="fModel">${MODELS.map(m => `<option value="${m.id}" ${store.prefs.model === m.id ? 'selected' : ''}>${m.label}</option>`).join('')}</select></div>
    </div>
    <div class="row" style="margin-top:8px">
      <span class="filebtn primary">Add page photos<input type="file" id="fPages" accept="image/*" multiple aria-label="Add page photos"></span>
      <button id="btnRead" ${pages.some(p => p.state !== 'ok') ? '' : 'disabled'}>Read ${pages.filter(p => p.state !== 'ok').length || ''} page(s)</button>
      ${pages.length ? '<button id="btnClearPages">Clear photos</button>' : ''}
    </div>
    <div class="thumbs">${pages.map((p, i) => `<figure class="${p.state}"><img src="${p.url}" alt="page ${i + 1}"><figcaption>${esc(p.msg || p.file.name)}</figcaption>
      ${(p.state === 'ok' || p.state === 'bad') && canOCR ? `<button data-reread="${i}" title="Read this page again with the selected model">Re-read</button>` : ''}
      <button class="x" data-rmphoto="${i}" title="Remove this photo" aria-label="Remove photo ${i + 1}">✕</button></figure>`).join('')}</div>
  </div>
  <div class="row" style="margin-bottom:8px">
    <strong>${r.rows.length} Route Instructions</strong>
    <button id="btnAdd">Add row</button><button id="btnSort">Sort by RI</button>
    <button id="btnPaste">Paste rows</button>
    <button id="btnClearRI" class="danger" ${r.rows.length ? '' : 'disabled'}>Clear Route Instructions</button>
  </div>
  ${newSet.size ? `<div class="banner">Highlighted rows came from the last read. Check them against the paper.</div>` : ''}
  ${flags.length ? `<div class="flags">${flags.slice(0, 8).map(esc).join('<br>')}${flags.length > 8 ? `<br>…and ${flags.length - 8} more` : ''}</div>` : ''}
  <div class="tablewrap"><table id="rtEdit"><thead><tr>
    <th>RI</th><th>OM</th><th title="Restart (OM /0.00)">Rst</th><th>CZT</th><th>CP</th><th>Instruction</th><th>Info</th><th></th></tr></thead>
  <tbody>${r.rows.map((x, i) => `<tr class="${newSet.has(String(x.ri)) ? 'new' : ''} ${C[i].restart ? 'rs' : ''} ${flags.some(f => f.startsWith('RI ' + x.ri + ':')) || (x.band && x.band.pageCheck) || (!x.band && x.imgCheck) || noSign.has(i) ? 'flag' : ''}">
    <td class="c-ri"><input data-i="${i}" data-k="ri" value="${esc(x.ri)}" inputmode="numeric"></td>
    <td class="c-om"><input data-i="${i}" data-k="om" value="${x.om == null ? '' : x.om.toFixed(2)}" inputmode="decimal"></td>
    <td><input type="checkbox" data-i="${i}" data-k="restart" ${C[i].restart ? 'checked' : ''} style="width:22px;min-height:22px"></td>
    <td class="c-czt"><input data-i="${i}" data-k="czt" value="${esc(Core.fmtTOD(x.czt, store.prefs.fmt))}" placeholder="—" inputmode="text"></td>
    <td class="c-cp"><input data-i="${i}" data-k="cp" value="${esc(x.cp ?? '')}"></td>
    <td class="c-instr"><input data-i="${i}" data-k="instr" value="${esc(x.instr)}"></td>
    <td class="c-info"><input data-i="${i}" data-k="info" value="${esc(x.info)}"></td>
    <td><button class="x" data-del="${i}" title="Delete row">✕</button></td></tr>${routeMedia(x)}`).join('')}</tbody></table></div>
  <p class="small muted">OM is the official mileage; a checked Rst box means the OM column shows “/0.00” (odometer restarts at that RI). Times may be typed as HH:MM:SS or HH:MM.cc. When the Route Instructions are right, go to Run.</p>`;

  hydrateImages($('routeBody'));
  $('fPages').onchange = e => {
    addPhotos(r.id, e.target.files);
    e.target.value = ''; renderRoute();
  };
  if ($('btnClearPages')) $('btnClearPages').onclick = () => confirmBox('Clear photos', (pages.length === 1
    ? `Clear the 1 page photo from “${esc(r.name || 'this rally')}”? Route Instructions already read from it stay.`
    : `Clear all ${pages.length} page photos from “${esc(r.name || 'this rally')}”? Route Instructions already read from them stay.`), 'Clear', () => {
    dropPages(r.id); renderRoute();
  });
  document.querySelectorAll('#routeBody [data-rmphoto]').forEach(b => b.onclick = () => {
    const p = pages[+b.dataset.rmphoto];
    confirmBox('Remove photo', 'Remove this page photo? Route Instructions already read from it stay.', 'Remove', () => {
      const k = pages.indexOf(p); if (k < 0) return;
      URL.revokeObjectURL(p.url); pages.splice(k, 1); renderRoute();
    });
  });
  if ($('btnRead')) $('btnRead').onclick = () => canOCR ? readPages() : confirmBox('No photo reader here',
    `Reading photos needs your Anthropic API key: enter it in the box above. It stays on this device.`,
    'OK', null, '');
  if ($('bKey')) $('bKey').onclick = () => {
    const k = $('fKey').value.trim();
    if (!k) { toast(getApiKey() ? 'Type a new key to replace the saved one' : 'Paste your API key first'); return; }
    if (!/^sk-ant-/.test(k)) { toast('That does not look like an Anthropic API key (sk-ant-…)'); return; }
    try { localStorage.setItem(LS_KEY_API, k); toast('Key saved on this device'); } catch (e) { toast('Could not save the key on this device'); }
    renderRoute();
  };
  if ($('fModel')) $('fModel').onchange = e => { store.prefs.model = e.target.value; save(); };
  document.querySelectorAll('#routeBody [data-reread]').forEach(b => b.onclick = () => readPages([+b.dataset.reread]));
  $('btnAdd').onclick = () => {
    const last = r.rows[r.rows.length - 1];
    const ri = last ? (typeof last.ri === 'number' ? last.ri + 1 : String(last.ri) + '+') : 1;
    r.rows.push(Core.normRow({ ri, om: last && !Core.compute(r)[r.rows.length - 1].restart ? last.om : (last ? 0 : '/0.00'), restart: !last }));
    save(r); renderRoute();
    const w = document.querySelector('#v-route'); w.scrollTop = w.scrollHeight;
  };
  $('btnSort').onclick = () => { r.rows.sort((a, b) => Core.cmpRI(a.ri, b.ri)); save(r); renderRoute(); };
  $('btnClearRI').onclick = () => confirmBox('Clear Route Instructions', (r.rows.length === 1
    ? `Clear the 1 Route Instruction and its run data from “${esc(r.name || 'this rally')}”? This cannot be undone.`
    : `Clear all ${r.rows.length} Route Instructions and their run data from “${esc(r.name || 'this rally')}”? This cannot be undone.`), 'Clear', () => {
    r.rows = []; r.taEvents = []; newOf(r.id).clear(); save(r); gcPages(); renderRoute();
  });
  $('btnPaste').onclick = pasteRows;
  const tb = document.querySelector('#rtEdit tbody');
  tb.addEventListener('change', e => {
    const el = e.target, i = +el.dataset.i, k = el.dataset.k; if (k == null) return;
    const row = r.rows[i];
    if (k === 'restart') row.restart = el.checked;
    else if (k === 'om') { const v = el.value.replace(/\s/g, '');
      if (v === '') row.om = null;
      else if (/^(\d*\.?\d+)?\/0*\.?0+$/.test(v)) { const n = Core.normRow({ om: v }); row.om = n.om; row.restart = true; }
      else if (/^\d*\.?\d+$/.test(v)) row.om = +v;
      else { toast('OM format: x.xx, x.xx/0.00, or /0.00'); renderRoute(); return; } }
    else if (k === 'czt') { const v = el.value.trim(); const t = Core.parseTOD(v); if (v && t == null) { toast('CZT format: HH:MM:SS or HH:MM.cc'); renderRoute(); return; } row.czt = t; }
    else if (k === 'ri') { const res = Core.renameRI(r, i, el.value);
      if (!res.ok) { toast(res.reason); renderRoute(); return; }
      row.ri = res.ri; r.taEvents = res.taEvents; }
    else if (k === 'cp') row.cp = el.value.trim() || null;
    else row[k] = el.value;
    newOf(r.id).delete(String(row.ri));
    save(r); renderRoute();
  });
  tb.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const i = +b.dataset.del, x = r.rows[i];
    confirmBox('Delete row', `Delete RI ${esc(x.ri)}${x.instr ? ' (“' + esc(x.instr) + '”)' : ''}?`, 'Delete', () => {
      r.taEvents = (r.taEvents || []).filter(e => !Core.sameRI(e.ri, x.ri));
      r.rows.splice(i, 1); save(r); gcPages(); renderRoute();
    });
  });
}

function routeFlags(r, C) {
  const f = [], imgF = Core.imageFlags(r.rows, pagesReady ? id => pageIndex.has(id) : null);
  let prevOM = null, prevT = null;
  r.rows.forEach((x, i) => {
    if (C[i].restart) { prevOM = 0; prevT = null; }
    if (x.om == null && !C[i].restart) f.push(`RI ${x.ri}: no OM`);
    else if (!C[i].restart && prevOM != null && x.om < prevOM) f.push(`RI ${x.ri}: OM ${x.om.toFixed(2)} is less than the RI before it (missed restart?)`);
    if (!C[i].restart && x.om != null) prevOM = x.om;
    if (x.czt != null) { if (prevT != null && x.czt < prevT) f.push(`RI ${x.ri}: CZT earlier than the previous CZT`); prevT = x.czt; }
    if (i > 0 && Core.cmpRI(r.rows[i - 1].ri, x.ri) >= 0) f.push(`RI ${x.ri}: out of order (tap Sort by RI)`);
    f.push(...imgF[i]);                                               // image flags (Core.imageFlags): one page flag per page whose headings were moved
  });
  return f;
}

// Merges into the rally with id rid (default: the open one); null when that rally no longer exists.
function mergeIntoRally(rows, label, rid) {
  const r = store.rallies[rid || store.cur];
  if (!r) return null;
  const m = Core.mergeRows(r.rows, rows);
  r.rows = m.rows;
  rows.forEach(x => { const n = Core.normRow(x); if (n.ri != null) newOf(r.id).add(String(n.ri)); });
  save(r);
  return `${label}: ${m.added} added, ${m.replaced} replaced`;
}

// A page photo as the app reads it: the full-resolution bitmap (EXIF turn applied) for sign crops, and the pixels at up to 2,000 px
// (DESIGN § Reading pages). Close the bitmap when done.
// The one place the original photo is read (DESIGN § Sign images): the browser's own decode with the EXIF orientation applied. The page copy,
// the pre-pass, and every sign crop come from this bitmap, so they all share one oriented image. Nothing here switches on orientation values.
const decodeOriented = file => createImageBitmap(file, { imageOrientation: 'from-image' });
async function loadPage(file) {
  const bmp = await decodeOriented(file);
  const s = Math.min(1, 2000 / Math.max(bmp.width, bmp.height)), w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h);
  return { bmp, s, img: { data: d.data, w, h } };
}
async function jpegOf(img) {                       // RGBA {data, w, h} -> JPEG blob at quality 0.85
  const cv = document.createElement('canvas'); cv.width = img.w; cv.height = img.h;
  cv.getContext('2d').putImageData(new ImageData(img.data, img.w, img.h), 0, 0);
  return new Promise(res => cv.toBlob(res, 'image/jpeg', 0.85));
}
// Rule 13: each graphic is cut from the original photo at full resolution through the same correction as the page copy, at most 800 px
// on the long side. boxes are fractions of the copy; Mfull takes original pixels to copy pixels. Returns JPEG blobs.
async function signCrops(bmp, Mfull, copy, boxes) {
  const inv = Vision.invH(Mfull), out = [];
  for (const b of boxes) {
    try {
      const bx = b.left * copy.w, by = b.top * copy.h, bw = (b.right - b.left) * copy.w, bh = (b.bottom - b.top) * copy.h;
      const pad = 3, X0 = bx - pad, Y0 = by - pad, W = bw + 2 * pad, Hh = bh + 2 * pad;
      const cs = [[X0, Y0], [X0 + W, Y0], [X0 + W, Y0 + Hh], [X0, Y0 + Hh]].map(p => Vision.applyH(inv, p[0], p[1]));
      const rx = Math.max(0, Math.floor(Math.min(...cs.map(c => c[0])) - 2)), ry = Math.max(0, Math.floor(Math.min(...cs.map(c => c[1])) - 2));
      const rx1 = Math.min(bmp.width, Math.ceil(Math.max(...cs.map(c => c[0])) + 2)), ry1 = Math.min(bmp.height, Math.ceil(Math.max(...cs.map(c => c[1])) + 2));
      if (rx1 - rx < 2 || ry1 - ry < 2) continue;
      const rc = document.createElement('canvas'); rc.width = rx1 - rx; rc.height = ry1 - ry;
      const rcx = rc.getContext('2d', { willReadFrequently: true }); rcx.drawImage(bmp, rx, ry, rc.width, rc.height, 0, 0, rc.width, rc.height);
      const rd = rcx.getImageData(0, 0, rc.width, rc.height);
      const o0 = Vision.applyH(inv, X0, Y0), o1 = Vision.applyH(inv, X0 + 1, Y0);
      const gg = Math.min(Math.hypot(o1[0] - o0[0], o1[1] - o0[1]) || 1, 800 / Math.max(W, Hh));   // output pixels per copy pixel: the original's resolution, at most 800 px
      const ow = Math.max(1, Math.round(W * gg)), oh = Math.max(1, Math.round(Hh * gg));
      const M = Vision.mulH([1, 0, -rx, 0, 1, -ry, 0, 0, 1], Vision.mulH(inv, Vision.mulH([1, 0, X0, 0, 1, Y0, 0, 0, 1], [1 / gg, 0, 0, 0, 1 / gg, 0, 0, 0, 1])));
      const img = Vision.warp({ data: rd.data, w: rc.width, h: rc.height }, M, ow, oh);
      const blob = await jpegOf(img); if (blob) out.push(blob);
    } catch (e) { /* this graphic gets no image */ }
  }
  return out;
}
const blobToB64 = b => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(b); });

async function ocrOne(blob, model) {
  const key = getApiKey(); if (!key) throw new Error('No photo reader available');
  let resp;
  try { resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    body: JSON.stringify({ model, max_tokens: model === OPUS ? 16000 : 8000, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await blobToB64(blob) } },
      { type: 'text', text: OCR_PROMPT }] }] }),
  }); } catch (e) { throw new Error('Could not reach the Anthropic API (' + (e.message || 'network error') + '). Check the internet connection.'); }
  if (!resp.ok) throw new Error(resp.status === 401 ? 'The API key was rejected (401). Check it on the Route tab.' : resp.status === 402 || resp.status === 403 ? 'The API refused the request (' + resp.status + '). Check the account has credit and the key is allowed to use ' + model + '.' : 'API ' + resp.status + ': ' + (await resp.text()).slice(0, 160));
  const j = await resp.json();
  if (j.stop_reason === 'max_tokens') throw new Error('The reply was cut off (page too long). Select Opus 5.5 and tap Re-read, or split the photo.');
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  return { rows: Core.parseOCR(text), rotation: Core.parseRotation(text) };
}

const modelName = id => ({ 'claude-sonnet-5-5': 'Sonnet', 'claude-haiku-5-5': 'Haiku', 'claude-opus-5-5': 'Opus' }[id] || id);
// Read the given pages (default: every page not yet read) of the open rally with the chosen model.
// The owning rally is fixed when the read starts; rows merge into it even if another rally is open later.
async function readPages(only, model) {
  const rid = store.cur;
  if (!rid || readingBy.has(rid)) return; readingBy.add(rid); newOf(rid).clear();
  model = model || store.prefs.model || MODELS[0].id;
  const list = pagesOf(rid), msgs = [];
  const targets = list.map((p, i) => [p, i]).filter(([p, i]) => only ? only.includes(i) : p.state !== 'ok');
  const redraw = () => { if (store.cur === rid && store.rallies[rid]) renderRoute(); };
  for (const [p, i] of targets) {
    if (!store.rallies[rid]) break;       // rally deleted while reading: discard
    p.state = 'busy'; p.msg = `Reading (${modelName(model)})…`; redraw();
    const pend = [];                      // stored images (page copy, sign images) waiting for this read to merge
    try {
      const pg = await loadPage(p.file);
      let rows;
      try {
        const t = Vision.needsTurn(pg.img), sent = Vision.rotateImg(pg.img, t);          // rule 1: a page shot sideways is turned before it is sent
        const reply = await ocrOne(await jpegOf(sent), model);
        rows = reply.rows;
        if (!store.rallies[rid]) break;
        p.model = model;
        if (rows.length) {                            // page copy, bands, and sign images; a failure never fails the read
          const pid = 'pg' + newId().slice(1); pend.push(pid); pendingPages.add(pid);
          let res = null;
          try { res = Vision.analyzePage(sent, rows.map(x => ({ row: x.row, y: x.y, tags: (String(x.instr || '').match(/\[sign:/gi) || []).length })), { rotation: reply.rotation }); } catch (e) {}
          let saved = false;
          if (res) try { await pagePut(pid, await jpegOf(res.image)); saved = true; } catch (e) {}
          if (!saved) msgs.push('Page images could not be saved on this device; rows from this page have no image.');
          else {
            // original pixels -> copy pixels: scale to the sent size, the pre-pass turn, the reader's turn, then the table correction
            const A = Vision.mulH(Vision.rotMatrix(sent.w, sent.h, res.turns), Vision.mulH(Vision.rotMatrix(pg.img.w, pg.img.h, t), [pg.s, 0, 0.5 * pg.s - 0.5, 0, pg.s, 0.5 * pg.s - 0.5, 0, 0, 1]));
            const Mfull = res.H ? Vision.mulH(res.H, A) : A, next = [];
            for (let k = 0; k < rows.length; k++) {
              const rr = res.rows[k]; let x = rows[k];
              if (rr.band) {
                const ids = [];
                for (const blob of rr.boxes.length ? await signCrops(pg.bmp, Mfull, res.image, rr.boxes) : []) {
                  const sid = 'sg' + newId().slice(1); pend.push(sid); pendingPages.add(sid);
                  try { await pagePut(sid, blob); ids.push(sid); } catch (e) {}
                }
                x = { ...x, band: { page: pid, ...rr.band }, signs: ids };
              } else x = { ...x, imgCheck: pid };                   // read from this page but no band: flagged, and inside the page flag's range
              next.push(x);
            }
            rows = next;
          }
        }
      } finally { pg.bmp.close(); }
      const by = ` · ${modelName(model)}`;
      if (!rows.length) { p.state = 'bad'; p.msg = 'No Route Instructions found' + by; }
      else { const s = mergeIntoRally(rows, `Page ${i + 1}${by}`, rid); p.state = 'ok'; p.msg = `${rows.length} Route Instructions${by}`; msgs.push(s); }
    } catch (e) {
      p.state = 'bad'; p.msg = 'Failed';
      msgs.push(`Page ${i + 1}: ${e && e.message || 'failed'}`);
    }
    pend.forEach(id => pendingPages.delete(id)); gcPages();
    redraw();
  }
  readingBy.delete(rid); redraw();
  const owner = store.rallies[rid];
  if (owner && msgs.length) confirmBox('Pages read', (store.cur === rid ? '' : `“${esc(owner.name || 'Untitled rally')}”:<br>`) + msgs.map(esc).join('<br>') + '<br><br>Rows are merged by RI and sorted. Highlighted rows need checking.', 'OK', null, '');
}

// A copied photo can be pasted on the Route tab (Ctrl/Cmd-V, or long-press → Paste where the device allows).
document.addEventListener('paste', e => {
  if (view !== 'route' || $('modal').classList.contains('on')) return;
  const files = [...(e.clipboardData && e.clipboardData.files || [])].filter(f => /^image\//.test(f.type));
  if (!files.length) return;
  e.preventDefault();
  addPhotos(store.cur, files);
  toast(`${files.length} pasted photo(s) added`); renderRoute();
});

function pasteRows() {
  confirmBox('Paste rows', `<div class="small muted">Paste CSV with a header line: RI,OM,CZT,CP,Instruction,Info. An exported rally CSV works as is.</div>
    <textarea id="pasteBox" rows="10" style="margin-top:8px;font-size:13px"></textarea>`, 'Merge', () => {
    const t = $('pasteBox').value.trim(); if (!t) return;
    let rows = [];
    try { rows = Core.parseCSV(t); } catch (e) { rows = []; }
    if (!rows.length) { toast('No rows found in that text'); return false; }
    toast(mergeIntoRally(rows, 'Pasted')); renderRoute();
  });
}
// ---------------------------------------------------------------- RUN (operation)
// The Run list keeps whatever position the user scrolled to across re-renders.
// Per rally, in memory only. runDomId is the rally whose list is currently in the DOM.
const runPos = {};
let runDomId = null;
function renderRun() {
  const r = R(), v = $('v-run');
  const oldW = $('runWrap'), oldT = v.querySelector('.runtop');
  if (runDomId && runPos[runDomId]) {
    if (oldW && runDomId === r.id) runPos[r.id].list = oldW.scrollTop;
    if (oldT && runDomId === r.id) runPos[r.id].top = oldT.scrollTop;
  }
  runDomId = r.id;
  if (!r.rows.length) { v.innerHTML = '<div class="narrow"><p class="muted">No Route Instructions yet.</p><button class="primary" id="goR">Build it on Route</button></div>'; $('goR').onclick = () => show('route'); return; }
  const C = Core.compute(r), a = Core.activeIndex(r), done = r.rows.filter(x => x.done).length;
  let card;
  if (a < 0) {
    card = `<div class="active-card"><div class="ac-ri">All ${r.rows.length} Route Instructions complete</div>
      <div class="ac-btns" style="grid-template-columns:1fr"><button id="btnUndo">Undo last complete</button></div></div>`;
  } else {
    const x = r.rows[a], c = C[a], nx = r.rows[a + 1], cn = C[a + 1];
    const ttHtml = c.tt != null ? `<div class="big num">${fmtT(c.tt)}</div>`
      : (c.est != null ? `<div class="big num est">≈${fmtT(c.est)}</div>
          <div class="small muted">est. at ${esc(r.speedo)} mph from RI ${esc(c.estAnchor)}</div>`
      : `<div class="big num muted">—</div><div class="small muted">${x.om == null ? 'no OM, so no VM or estimate' : r.speedo ? 'no earlier TT in this leg' : 'set speedometer for an estimate'}</div>`);
    const pb = pageBtn(x);
    card = `<div class="active-card">
      <div class="ac-main"><div class="ac-lead">
      <div class="ac-head"><span class="ac-ri">RI ${esc(x.ri)}</span>
        ${c.restart ? '<span class="badge rs">RESTART · zero trip odo</span>' : ''}
        ${x.cp ? `<span class="badge cp">CP ${esc(x.cp)}</span>` : ''}
        ${c.ta ? `<span class="badge ta">TA ${fmtTA(c.ta)}</span>` : ''}
        ${c.gapNext != null && c.gapNext <= Core.closeMi(r) + 1e-9 ? `<span class="badge close">NEXT IN ${c.gapNext.toFixed(2)}</span>` : ''}
        ${pb}<span class="progress" style="margin-left:auto">${done}/${r.rows.length} complete</span></div>
      <div class="ac-nums">
        <div><div class="lbl">VM</div><div class="big num">${c.restart && c.vmPrevEnd != null ? `<span style="font-size:.55em">${fmtVM(c.vmPrevEnd)}/</span>` : ''}${fmtVM(c.vm) || '—'}</div></div>
        <div><div class="lbl">TT</div>${ttHtml}</div>
      </div>
      <div class="ac-text"><div class="ac-instr">${signHtml(x, 'ac-img') || '<span class="muted">(no instruction text)</span>'}</div>
      ${x.info ? `<div class="ac-info">${esc(x.info)}</div>` : ''}</div></div></div>
      ${nx ? `<div class="ac-next num">Next: RI ${esc(nx.ri)}${cn.restart ? ' (restart)' : ''} · VM ${fmtVM(cn.vm) || '—'}${cn.tt != null ? ' · TT ' + fmtT(cn.tt) : cn.est != null ? ' · TT ≈' + fmtT(cn.est) : ''} · ${esc(nx.instr)}</div>` : ''}
      <div class="ac-btns"><button id="btnUndo" ${done ? '' : 'disabled'}>Undo</button><button class="primary" id="btnDone">Complete RI ${esc(x.ri)} ✓</button></div>
    </div>
    <div class="ctl">
      <div class="grp ta">
        <button id="btnTA" class="num ${c.ta ? 'ta-on' : ''}" aria-label="Time Allowance">TA ${fmtTA(c.ta)}</button></div>
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
      <td class="instr">${signHtml(x, 'ls-img')}${x.info ? `<div class="info">${esc(x.info)}</div>` : ''}</td></tr>`;
  }).join('')}</tbody></table></div>`;

  hydrateImages(v);
  const w = $('runWrap'), t = v.querySelector('.runtop');
  const first = !runPos[r.id];                       // first time this rally's list is shown this session
  const pos = runPos[r.id] || (runPos[r.id] = { list: 0, top: 0 });
  if (w) { w.scrollTop = pos.list; w.addEventListener('scroll', () => { pos.list = w.scrollTop; }, { passive: true }); }
  if (t) { t.scrollTop = pos.top; t.addEventListener('scroll', () => { pos.top = t.scrollTop; }, { passive: true }); }
  if (first && a >= 0) scrollActive('auto');         // same placement as Complete
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
    if (s === '' || !(+s >= 1 && +s <= SPEEDO_MAX)) { toast(`Speedometer must be between 1 and ${SPEEDO_MAX} mph`); return false; }
    setSpeedo(+s);
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
const TA_MAX = Core.TA_MAX, SPEEDO_MAX = 100;
// TA dialog: steps and typing change a pending value; Set applies it, Cancel or tapping outside leaves TA as it was.
function taDialog(a) {
  const r = R(), C = Core.compute(r), x = r.rows[a];
  let pend = C[a].ta || 0;
  const steps = [-60, -15, -5, 5, 15, 60];
  confirmBox(`Time Allowance`, `<div class="small muted">Applies from RI ${esc(x.ri)} through the RI before the next restart.
      Currently ${fmtTA(C[a].ta)}.</div>
    <input id="taIn" class="num" inputmode="text" enterkeyhint="done" value="${fmtTA(pend)}" style="font-size:28px;text-align:center;margin:10px 0;min-height:56px">
    <div class="tagrid">${steps.map(s => `<button data-st="${s}">${s < 0 ? '−' : '+'}${Math.abs(s)}</button>`).join('')}</div>
    <div class="row" style="margin-top:8px"><button id="taZero" style="flex:1">Zero</button></div>
    <div class="small muted" style="margin-top:6px">Type seconds (90) or m:ss (1:05). Limit 90:00.</div>`, 'Set', () => {
      const txt = $('taIn').value, s = Core.parseTA(txt);
      if (/^\s*[-−–]/.test(txt)) { toast('TA cannot be negative'); return false; }
      if (s == null) { toast('TA: seconds (90) or m:ss (1:05)'); return false; }
      if (s > TA_MAX) { toast('TA is limited to 90:00'); return false; }
      setTA(a, s);
    });
  const inp = $('taIn');
  const show = () => { inp.value = fmtTA(pend); };
  const readTyped = () => { const s = Core.parseTA(inp.value); if (s != null) pend = s; };
  document.querySelectorAll('#mBody [data-st]').forEach(b => b.onclick = () => {
    readTyped(); pend = Math.max(0, Math.min(TA_MAX, pend + +b.dataset.st)); show(); });
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
  const r = R(); sec = Math.max(0, Math.min(TA_MAX, Math.round(sec)));
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
    const cur = R(); if (cur && runPos[cur.id]) runPos[cur.id].list = top;
    try { w.scrollTo({ top, behavior }); } catch (e) { w.scrollTop = top; }
  });
}

// ---------------------------------------------------------------- DATA
function getApiKey() { try { return localStorage.getItem(LS_KEY_API) || ''; } catch (e) { return ''; } }
const fileBase = r => ((r.date || '') + ' ' + (r.name || 'rally')).trim().replace(/[^\w.-]+/g, '_');
function offerFile(filename, data, mime) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: mime })); a.download = filename;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function copyText(t, what) {
  try { await navigator.clipboard.writeText(t); toast(what + ' copied'); }
  catch (e) { confirmBox('Copy ' + what, `<textarea rows="10" readonly style="font-size:12px">${esc(t)}</textarea>`, 'Close', null, ''); }
}
function pageImagesLine(r) {
  const ids = Core.pagesUsed(r.rows).filter(p => pageIndex.has(p));
  if (!ids.length) return 'Page images: none';
  const mb = ids.reduce((n, p) => n + pageIndex.get(p), 0) / 1048576, pages = ids.filter(p => !p.startsWith('sg')).length;   // the size includes the sign images
  return `Page images: ${pages} ${pages === 1 ? 'page' : 'pages'}, ${mb.toFixed(1)} MB on this device`;
}
function renderData() {
  const r = R();
  const done = r.rows.filter(x => x.done).length;
  const tas = (r.taEvents || []).slice().sort((x, y) => Core.cmpRI(x.ri, y.ri));
  $('dataBody').innerHTML = `
  <div class="card"><h2>${esc(r.name || 'Untitled rally')}</h2>
    <div class="small">${esc(r.date)} · Car ${esc(r.cn)} · Class ${esc(r.cls || '—')} · OCF ${esc(fmtOCF(r.ocf))} · Driver ${esc(r.crew.driver || '—')} · Navigator ${esc(r.crew.navigator || '—')}${r.crew.passengers.filter(Boolean).length ? ' · Passengers ' + esc(r.crew.passengers.filter(Boolean).join(', ')) : ''}</div>
    <div class="small muted" style="margin-top:4px">${r.rows.length} Route Instructions · ${done} complete · TAs entered: ${tas.length ? tas.map(t => `RI ${esc(t.ri)} ${fmtTA(t.ta)}`).join(', ') : 'none'}</div>
    <div class="small muted" style="margin-top:4px">${pageImagesLine(r)}</div>
    <div class="small muted" style="margin-top:4px">Storage: ${lsOK ? 'saved on this device' : 'NOT saved on this device'}.</div>
  </div>
  <div class="card"><h3>Export</h3>
    <div class="row"><button id="xCSV">Download CSV</button><button id="xJSON">Download JSON</button>
      <button id="cCSV">Copy CSV</button><button id="cJSON">Copy JSON</button></div>
    <div class="small muted" style="margin-top:6px">CSV holds the augmented Route Instructions (OM, VM, CZT, TA, TT, estimates, completion times). JSON is the full rally record and can be imported back.</div>
  </div>
  <div class="card"><h3>Import</h3>
    <span class="filebtn">Import rally JSON<input type="file" id="fImport" accept=".json,application/json,text/plain" aria-label="Import rally JSON"></span>
    <div class="small muted" style="margin-top:6px">Adds the rally as a new entry; nothing existing is overwritten.</div>
  </div>
  <div class="card"><h3>App</h3>
    <div class="small muted">${isInstalled() ? 'Installed: this app opens and runs with no internet.' : 'Install this app to your home screen (see the Rallies tab) so it opens with no internet.'}</div>
    ${getApiKey() ? `<div class="row" style="margin-top:8px"><button id="bKeyDel" class="danger">Remove saved API key from this device</button></div>` : ''}
    <div class="small muted" style="margin-top:8px">App version ${esc(APP_VERSION)}</div>
  </div>
  <div class="card"><h3>Reset or delete</h3>
    <div class="row"><button id="bResetRun" ${done || tas.length ? '' : 'disabled'}>Clear run data</button>
      <button id="bDup">Duplicate rally</button>
      <button id="bDel" class="danger">Delete rally</button></div>
  </div>`;
  const csv = () => Core.toCSV(r, store.prefs.fmt), json = () => JSON.stringify({ app: 'rally-monte-style', version: 1, rally: r }, null, 1);
  $('xCSV').onclick = () => offerFile(fileBase(r) + '.csv', csv(), 'text/csv');
  $('xJSON').onclick = () => offerFile(fileBase(r) + '.json', json(), 'application/json');
  $('cCSV').onclick = () => copyText(csv(), 'CSV');
  $('cJSON').onclick = () => copyText(json(), 'JSON');
  $('fImport').onchange = async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const j = JSON.parse(await f.text()); const src = j.rally || j;
      if (!Array.isArray(src.rows)) throw new Error('no rows');
      const nr = { ...blankRally(), ...src, id: newId(), updated: now() };
      nr.rows = nr.rows.map(x => ({ ...Core.normRow(x), band: null, signs: [], imgCheck: null }));   // bands and sign images are dropped: no page copy comes with the file
      nr.crew = { driver: '', navigator: '', passengers: [], ...(src.crew || {}) };
      if (typeof nr.vehicle !== 'string') nr.vehicle = '';
      if (store.rallies[src.id]) nr.name = (nr.name || 'Rally') + ' (imported)';
      store.rallies[nr.id] = nr; store.cur = nr.id; save(nr); toast('Imported ' + (nr.name || 'rally')); renderAll();
    } catch (err) { toast('That file is not a rally JSON export'); }
  };
  if ($('bKeyDel')) $('bKeyDel').onclick = () => confirmBox('Remove API key', 'Remove the saved Anthropic API key from this device?', 'Remove', () => { try { localStorage.removeItem(LS_KEY_API); } catch (e) {} renderData(); });
  $('bResetRun').onclick = () => confirmBox('Clear run data', `Clear the run data for “${esc(r.name || 'this rally')}”? The Route Instructions stay. This cannot be undone.`, 'Clear', () => {
    r.rows = r.rows.map(x => ({ ...x, done: false, ttDone: null, doneAt: null, estLock: null })); r.taEvents = []; save(r); renderData();
  });
  $('bDup').onclick = () => {
    const nr = JSON.parse(JSON.stringify(r)); nr.id = newId(); nr.name = (r.name || 'Rally') + ' (copy)'; nr.created = nr.updated = now(); nr.rows.forEach(x => { x.band = null; x.signs = []; x.imgCheck = null; });
    store.rallies[nr.id] = nr; store.cur = nr.id; save(nr); toast('Duplicated'); renderAll();
  };
  $('bDel').onclick = () => confirmBox('Delete rally', `Delete “${esc(r.name || 'Untitled rally')}” and all its data from this device? This cannot be undone. Export it first if you want a record.`, 'Delete', () => {
    delete store.rallies[r.id]; delete runPos[r.id]; dropPages(r.id); delete newByRally[r.id]; store.cur = null; save(); gcPages(); show('rallies');
  });
}

// ---------------------------------------------------------------- boot
applyTheme();
(function boot() {
  const h = (location.hash || '').slice(1);
  if (store.cur && !store.rallies[store.cur]) store.cur = null;
  show(['setup', 'route', 'run', 'data'].includes(h) && R() ? h : (R() && R().rows.length ? 'run' : 'rallies'));
  renderStorageWarn();
  loadPageIndex();
})();
window.addEventListener('hashchange', () => { const h = location.hash.slice(1); if (h && h !== view && ['rallies', 'setup', 'route', 'run', 'data'].includes(h)) show(h); });
// ---------------------------------------------------------------- offline cache (hosted app only)
(function registerSW() {
  if (!('serviceWorker' in navigator) || !/^https:$|^http:$/.test(location.protocol)) return;
  if (location.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;
  // Reload only when the user asked for the new version (a first install also changes the controller).
  let wantReload = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (wantReload) { wantReload = false; location.reload(); } });
  const offer = w => {
    $('updBar').classList.add('on');
    $('btnUpd').onclick = () => { $('updBar').classList.remove('on'); wantReload = true; w.postMessage('skipWaiting'); };
  };
  navigator.serviceWorker.register('sw.js').then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
    // look for a new version when the app comes back to the foreground (never forces a reload)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  }).catch(() => {});
})();

confirmBox.gen = 0;
