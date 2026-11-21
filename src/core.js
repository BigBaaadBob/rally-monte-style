// Rally core: pure functions, no DOM, no clock.
(function (root) {
  'use strict';

  // ---------- time parsing / formatting (seconds since midnight) ----------
  function parseTOD(s) {
    if (s == null) return null;
    if (typeof s === 'number') return isFinite(s) ? s : null;
    s = String(s).trim();
    if (!s) return null;
    let m = s.match(/^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/);           // H:MM:SS(.s)
    if (m) return chk(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2}):(\d{2})\.(\d{1,2})$/);                        // H:MM.cc (hundredths of a minute)
    if (m) { const c = m[3].length === 1 ? +m[3] * 10 : +m[3]; return chk(+m[1], +m[2], c * 0.6); }
    m = s.match(/^(\d{1,2}):(\d{2})$/);                                   // H:MM
    if (m) return chk(+m[1], +m[2], 0);
    return null;
    function chk(h, mi, se) { return (h < 48 && mi < 60 && se < 60) ? h * 3600 + mi * 60 + se : null; }
  }
  const p2 = n => String(n).padStart(2, '0');
  function fmtTOD(t, mode) {
    if (t == null || !isFinite(t)) return '';
    t = ((t % 86400) + 86400) % 86400;
    if (mode === 'hmc') {
      let cm = Math.round(t / 0.6);                 // hundredths of a minute
      const h = Math.floor(cm / 6000) % 24; cm %= 6000;
      return `${p2(h)}:${p2(Math.floor(cm / 100))}.${p2(cm % 100)}`;
    }
    let s = Math.round(t);
    const h = Math.floor(s / 3600) % 24; s %= 3600;
    return `${p2(h)}:${p2(Math.floor(s / 60))}:${p2(s % 60)}`;
  }
  // Time Allowance (TA), whole seconds, never negative: "90" or "1:05" (m:ss, seconds 0-59), optional "+".
  // Returns null for anything else (negative, decimal, seconds >= 60); a blank entry is 0.
  function parseTA(s) {
    if (s == null) return null;
    s = String(s).trim().replace(/\s+/g, '');
    if (!s) return 0;
    let m = s.match(/^\+?(\d+):(\d{2})$/);
    if (m) return +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
    m = s.match(/^\+?(\d+)$/);
    return m ? +m[1] : null;
  }
  const TA_MAX = 90 * 60;
  function fmtTA(sec) {
    if (sec == null || !isFinite(sec)) return '';
    const r = Math.round(Math.abs(sec));
    return `${Math.floor(r / 60)}:${p2(r % 60)}`;
  }

  // ---------- RI ordering ----------
  function riKey(ri) {
    const m = String(ri).match(/^(\d+(?:\.\d+)?)(.*)$/);
    return m ? [parseFloat(m[1]), m[2].trim().toUpperCase()] : [Infinity, String(ri)];
  }
  function cmpRI(a, b) {
    const x = riKey(a), y = riKey(b);
    return x[0] - y[0] || (x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0);
  }
  const sameRI = (a, b) => cmpRI(a, b) === 0;

  // ---------- normalise a row (from OCR, import, or hand entry) ----------
  function normRow(x) {
    const num = v => (v == null || v === '' || isNaN(+v)) ? null : +v;
    let om = x.om, restart = !!x.restart;
    if (typeof om === 'string') {
      const m = om.replace(/\s/g, '').match(/^(\d*\.?\d+)?\/0?\.?0+$/);   // "13.27/0.00" or "/0.00"
      if (m) { restart = true; om = m[1] != null ? +m[1] : 0; } else om = num(om);
    } else om = num(om);
    let ri = x.ri;
    if (typeof ri === 'string') { ri = ri.trim(); if (/^\d+$/.test(ri)) ri = +ri; }
    if (ri === '' || ri == null) ri = null;
    const czt = typeof x.czt === 'number' ? x.czt : parseTOD(x.czt);
    return {
      ri, om, restart, czt,
      cp: x.cp == null || x.cp === '' ? null : String(x.cp).trim(),
      instr: (x.instr || '').trim(),
      info: ((x.info || '') + (x.note ? ` [OCR: ${x.note}]` : '')).trim(),
      done: !!x.done, ttDone: x.ttDone ?? null, doneAt: x.doneAt ?? null,
      estLock: x.estLock ?? null,
      band: normBand(x.band),
      signs: normSigns(x.signs),
      imgCheck: typeof x.imgCheck === 'string' && x.imgCheck ? x.imgCheck : null,
    };
  }

  // ---------- page images (DESIGN § Reading pages → Page images, Sign images) ----------
  // A band is {page, top, bottom, left, right, src, check?, pageCheck?}: a page copy id and fractions (0-1) of that copy.
  // src says how it was found (rules, y, fallback, row); bands read before src existed have none.
  // check:true marks a band to look at (flagged on Route); pageCheck:true marks the rows of a page whose headings were moved.
  const SRC = ['rules', 'y', 'fallback', 'row'];
  function normBand(b) {
    if (!b || typeof b !== 'object' || typeof b.page !== 'string' || !b.page) return null;
    const f = v => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1;
    if (![b.top, b.bottom, b.left, b.right].every(f) || !(b.top < b.bottom) || !(b.left < b.right)) return null;
    const out = { page: b.page, top: b.top, bottom: b.bottom, left: b.left, right: b.right };
    if (SRC.includes(b.src)) out.src = b.src;
    if (b.check) out.check = true;
    if (b.pageCheck) out.pageCheck = true;
    return out;
  }
  // The ordered ids of a row's sign images (page copies' sibling records in IndexedDB).
  const normSigns = a => Array.isArray(a) ? a.filter(v => typeof v === 'string' && v) : [];
  // Every stored image id the rows refer to: page copies and sign images.
  const pagesUsed = rows => [...new Set(rows.flatMap(x => [x.band && x.band.page, ...(x.signs || [])]).filter(Boolean))];

  // Image flags for the Route screen (DESIGN § Flags). A row read from a page but left with no band carries imgCheck: that page copy's id.
  // pageOk(id) says whether a page copy is stored (null/undefined: not known yet). Returns one array of flag texts per row.
  // The page flag (RI a–b: check page images) runs from the first to the last row read from a page whose headings were moved,
  // rows with no band included.
  // Tagged rows that got no sign image (DESIGN § Flags). Groups of row indexes, one per page copy: a group is two or more rows with a band and
  // [sign: …] tags, none of which has a sign image. Worked out from the rows each time, never stored. Rows with no band are not counted.
  function noSignGroups(rows) {
    const byPage = new Map();
    rows.forEach((x, i) => { if (x.band && /\[sign:/i.test(String(x.instr == null ? '' : x.instr))) { if (!byPage.has(x.band.page)) byPage.set(x.band.page, []); byPage.get(x.band.page).push(i); } });
    return [...byPage.values()].filter(g => g.length >= 2 && g.every(i => !(rows[i].signs && rows[i].signs.length)));
  }
  // The indexes of the rows that highlight for that flag, in order.
  const noSignRows = rows => noSignGroups(rows).flat().sort((a, b) => a - b);

  function imageFlags(rows, pageOk) {
    const pageOf = x => x.band ? x.band.page : x.imgCheck || null;
    const noSign = new Map(noSignGroups(rows).map(g => [g[0], `RI ${rows[g[0]].ri}–${rows[g[g.length - 1]].ri}: no sign images found`]));
    const moved = new Set(rows.filter(x => x.band && x.band.pageCheck).map(x => x.band.page));
    const inRange = (x, p) => pageOf(x) === p && (x.band ? !!x.band.pageCheck : true);
    const seen = new Set();
    return rows.map((x, i) => {
      const f = [], p = pageOf(x);
      if (x.band && pageOk && pageOk(x.band.page) === false) f.push(`RI ${x.ri}: page image missing`);
      else if (x.band ? x.band.check && !x.band.pageCheck : x.imgCheck && !moved.has(x.imgCheck)) f.push(`RI ${x.ri}: check page image`);
      if (p && moved.has(p) && inRange(x, p) && !seen.has(p)) {
        seen.add(p);
        const mine = rows.filter(y => inRange(y, p));
        f.push(`RI ${mine.length > 1 ? mine[0].ri + '–' + mine[mine.length - 1].ri : mine[0].ri}: check page images`);
      }
      if (noSign.has(i)) f.push(noSign.get(i));
      return f;
    });
  }

  // Rule 14: how an instruction and its sign images are laid out. Returns {parts, after}. parts are {t:'text', s} and
  // {t:'tag', s: the tag's words, img: index of its image or -1}; after lists the image indexes shown after the text.
  // If the images are as many as the [sign: …] tags, each tag takes its image in order; otherwise no tag is replaced.
  function signParts(instr, nImgs) {
    const re = /\[sign:\s*([^\]]*)\]/gi, text = String(instr == null ? '' : instr), tags = [];
    for (let m; (m = re.exec(text));) tags.push({ at: m.index, end: re.lastIndex, s: m[1].trim() });
    const swap = nImgs > 0 && nImgs === tags.length, parts = [];
    let pos = 0;
    tags.forEach((g, i) => {
      if (g.at > pos) parts.push({ t: 'text', s: text.slice(pos, g.at) });
      parts.push({ t: 'tag', s: g.s, img: swap ? i : -1 }); pos = g.end;
    });
    if (pos < text.length) parts.push({ t: 'text', s: text.slice(pos) });
    return { parts, after: swap ? [] : Array.from({ length: nImgs }, (_, i) => i) };
  }

  // Merge by RI (new data replaces old text; completion state is kept), then sort.
  function mergeRows(existing, incoming) {
    const out = existing.slice();
    let added = 0, replaced = 0;
    for (const raw of incoming) {
      const r = normRow(raw);
      if (r.ri == null) continue;
      const i = out.findIndex(o => sameRI(o.ri, r.ri));
      if (i >= 0) {
        const o = out[i];
        out[i] = { ...r, done: o.done, ttDone: o.ttDone, doneAt: o.doneAt, estLock: o.estLock, band: r.band || o.band, signs: r.band ? r.signs : o.signs };   // Re-read: a new band brings its own images (even none); an old band keeps its images
        replaced++;
      } else { out.push(r); added++; }
    }
    out.sort((a, b) => cmpRI(a.ri, b.ri));
    return { rows: out, added, replaced };
  }

  // ---------- computation ----------
  // Returns one entry per row:
  //  leg (restart RI key), restart, vm, vmPrevEnd (restart rows: VM at end of previous frame),
  //  ta (effective), taSet (a TA was entered at this row), tt,
  //  est (locked value if locked, else live), estLive, estLocked, estAnchor,
  //  gapNext (VM to the next row, vehicle miles), close (within rally.closeMi, default 0.5, of a neighbour)
  // The first row starts the first leg (key = its RI), restart or not; there is no unnamed leg.
  // Rows before the first restart have VM = OM x OCF in whatever frame the OM is printed.
  // A row with no OM has no vm, tt-estimate, or close flag.
  // TA model: rally.taEvents = [{ri, ta, at}]. A TA entered at row R applies from R through
  // the row before the next restart; a later TA in the same leg replaces it from its row on.
  // A restart starts at TA 0.
  // Estimate lock: completing a no-TT row stores its estimate in row.estLock; while the row
  // stays completed that value no longer follows the speedometer or TA.
  // (v6: tap-to-lock removed; a lock only counts on a completed row.)
  const CLOSE_MI = 0.5;
  const closeMi = rally => (rally.closeMi === '' || rally.closeMi == null || !(+rally.closeMi >= 0)) ? CLOSE_MI : +rally.closeMi;
  function compute(rally) {
    const rows = rally.rows || [];
    const ocf = +rally.ocf > 0 ? +rally.ocf : 1;
    const cnSec = (+rally.cn || 0) * 60;
    const events = rally.taEvents || [];
    const speedo = +rally.speedo > 0 ? +rally.speedo : null;
    const out = [];
    let leg = rows.length ? String(rows[0].ri) : null, legRows = [], ta = 0;
    rows.forEach((r, i) => {
      const restart = !!r.restart;
      if (restart) { leg = String(r.ri); legRows = []; ta = 0; }
      const ev = events.find(e => sameRI(e.ri, r.ri));
      if (ev) ta = +ev.ta || 0;
      const vm = restart ? 0 : (r.om == null ? null : r.om * ocf);
      const vmPrevEnd = restart && i > 0 && r.om != null ? r.om * ocf : null;   // no previous frame before the first row
      const tt = r.czt == null ? null : r.czt + cnSec + ta;
      let estLive = null, estAnchor = null;
      if (tt == null && vm != null && speedo) {
        for (let k = legRows.length - 1; k >= 0; k--) {
          const a = out[legRows[k]];
          if (a.tt != null && a.vm != null) {
            estLive = a.tt + Math.max(0, vm - a.vm) / speedo * 3600;
            estAnchor = rows[legRows[k]].ri;
            break;
          }
        }
      }
      const estLocked = tt == null && !!r.done && r.estLock != null;
      const est = estLocked ? r.estLock : estLive;
      out.push({ i, ri: r.ri, leg, ta, taSet: !!ev, restart, vm, vmPrevEnd, tt, est, estLive, estLocked,
        estAnchor, gapNext: null, close: false });
      legRows.push(i);
    });
    // distance to the next row: within a frame, or up to a restart's previous-frame end
    const lim = closeMi(rally);
    for (let i = 0; i + 1 < out.length; i++) {
      const a = out[i], b = out[i + 1];
      const bEnd = b.restart ? b.vmPrevEnd : b.vm;
      if (a.vm == null || bEnd == null) continue;
      const g = bEnd - a.vm;
      if (g < -1e-9) continue;                       // inconsistent OMs: no claim
      a.gapNext = g;
      if (g <= lim + 1e-9) { a.close = true; b.close = true; }
    }
    return out;
  }

  const activeIndex = rally => (rally.rows || []).findIndex(r => !r.done);

  function legOf(rally, idx) {
    const rows = rally.rows || [];
    let leg = idx >= 0 && rows.length ? String(rows[0].ri) : null;
    rows.forEach((r, i) => { if (i <= idx && r.restart) leg = String(r.ri); });
    return leg;
  }

  // Set the TA at row idx (replaces a TA already entered at that row). Returns new events array.
  function setTA(rally, idx, sec, now) {
    const ri = rally.rows[idx].ri;
    const ev = (rally.taEvents || []).filter(e => !sameRI(e.ri, ri));
    ev.push({ ri, ta: Math.max(0, Math.min(TA_MAX, Math.round(+sec || 0))), at: now ?? null });
    return ev;
  }

  // Rename the RI of row idx. Rejects a blank or duplicate RI (taEvents unchanged);
  // otherwise moves the row's TA events to the new RI. Does not mutate the rally.
  function renameRI(rally, idx, text) {
    const v = String(text ?? '').trim(), events = rally.taEvents || [];
    if (!v) return { ok: false, reason: 'RI cannot be blank', taEvents: events };
    if (rally.rows.some((o, j) => j !== idx && sameRI(o.ri, v))) return { ok: false, reason: `RI ${v} already exists`, taEvents: events };
    const old = rally.rows[idx].ri, ri = /^\d+$/.test(v) ? +v : v;
    return { ok: true, ri, taEvents: events.map(e => sameRI(e.ri, old) ? { ...e, ri } : e) };
  }

  // Mark the active row complete; records the TT it had and locks any estimate.
  function completeActive(rally, now) {
    const a = activeIndex(rally);
    if (a < 0) return rally.rows;
    const c = compute(rally)[a];
    return rally.rows.map((r, i) => {
      if (i !== a) return r;
      const x = { ...r, done: true, ttDone: c.tt, doneAt: now ?? null };
      if (c.tt == null) Object.assign(x, { estLock: c.estLive });
      return x;
    });
  }
  // Un-complete a row; its locked estimate is released.
  function uncomplete(rally, idx) {
    return rally.rows.map((r, i) => i === idx ? { ...r, done: false, ttDone: null, doneAt: null, estLock: null } : r);
  }
  // Index of the completed row that comes last in RI order (never by completion time; ties -> highest index).
  function lastCompleted(rally) {
    let best = -1;
    (rally.rows || []).forEach((r, i) => {
      if (!r.done) return;
      if (best < 0 || cmpRI(r.ri, rally.rows[best].ri) >= 0) best = i;
    });
    return best;
  }

  // ---------- export ----------
  // OCF is always written with four decimals (e.g. 1.0100); a blank or non-positive value is left as entered.
  const fmtOCF = v => +v > 0 ? (+v).toFixed(4) : String(v ?? '');
  function csvEsc(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
  function toCSV(rally, mode) {
    const C = compute(rally);
    const crew = rally.crew || {};
    const head = [
      ['Rally', rally.name], ['Date', rally.date], ['Driver', crew.driver], ['Navigator', crew.navigator],
      ['Passengers', (crew.passengers || []).join('; ')], ['Vehicle', rally.vehicle], ['Car number', rally.cn], ['Class', rally.cls], ['OCF', fmtOCF(rally.ocf)],
      ['Close RI limit (mi)', closeMi(rally)],
      ['Speedometer (est.)', rally.speedo],
    ].map(r => r.map(csvEsc).join(','));
    const cols = ['RI', 'Restart', 'OM', 'VM', 'CZT', 'TA (s)', 'TA entered here', 'TT', 'Est TT', 'Est locked', 'Done', 'Done at', 'CP', 'Instruction', 'Info'];
    const body = rally.rows.map((r, i) => {
      const c = C[i];
      return [r.ri, c.restart ? 'Y' : '', r.om == null ? '' : r.om.toFixed(2) + (c.restart ? '/0.00' : ''),
        c.vm == null ? '' : (c.vmPrevEnd != null ? c.vmPrevEnd.toFixed(2) + '/' : '') + c.vm.toFixed(2),
        fmtTOD(r.czt, mode), c.ta || '', c.taSet ? 'Y' : '', fmtTOD(c.tt, mode), fmtTOD(c.est, mode), c.estLocked ? 'Y' : '',
        r.done ? 'Y' : '', r.doneAt ? new Date(r.doneAt).toISOString() : '', r.cp ?? '', r.instr, r.info].map(csvEsc).join(',');
    });
    return head.join('\n') + '\n\n' + cols.join(',') + '\n' + body.join('\n') + '\n';
  }

  // Parse CSV text into raw rows {ri, om, czt, cp, instr, info}. Accepts either an export from toCSV
  // (rally details, a blank line, then an `RI,…` header: columns are found by name, computed ones ignored)
  // or any CSV with a header line that has those column names. Text with no `RI,…` header returns no rows.
  // Quoted fields may contain commas and newlines.
  function parseCSV(text) {
    const recs = []; let cells = [], cur = '', q = false, any = false;
    const endRec = () => { cells.push(cur); if (any || cells.length > 1) recs.push(cells); cells = []; cur = ''; any = false; };
    for (let k = 0; k < text.length; k++) {
      const ch = text[k];
      if (q) { if (ch === '"' && text[k + 1] === '"') { cur += '"'; k++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') { q = true; any = true; }
      else if (ch === ',') { cells.push(cur); cur = ''; any = true; }
      else if (ch === '\n') endRec();
      else if (ch !== '\r') { cur += ch; if (ch.trim()) any = true; }
    }
    endRec();
    const isHead = c => c.length > 1 && /^\s*ri\s*$/i.test(c[0]);
    const h = recs.findIndex(isHead);
    if (h < 0) return [];                          // no header line (JSON, prose, bare lines): not CSV, no rows
    const idx = {};
    const names = recs[h].map(s => s.trim().toLowerCase());
    for (const [key, name] of [['ri', 'ri'], ['om', 'om'], ['czt', 'czt'], ['cp', 'cp'], ['instr', 'instruction'], ['info', 'info']]) idx[key] = names.indexOf(name);
    const body = recs.slice(h + 1);
    const at = (c, i) => i >= 0 && c[i] != null ? c[i] : '';
    return body.filter(c => at(c, idx.ri).trim() !== '').map(c => ({
      ri: at(c, idx.ri), om: at(c, idx.om), czt: at(c, idx.czt) || null, cp: at(c, idx.cp) || null,
      instr: at(c, idx.instr), info: at(c, idx.info) }));
  }

  // Strip a model reply down to the JSON array of rows.
  function parseOCR(text) {
    if (!text) return [];
    let t = String(text).trim();
    const fences = [...t.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(m => m[1].trim());
    const cands = fences.length ? fences : [t];
    let out = [];
    for (let c of cands) {                         // several fenced blocks (e.g. one per page) are concatenated
      const m = c.match(/\[\s*(\{|\])/);              // start of an array of objects, not "[curve-left sign]"
      if (m) { const b = c.lastIndexOf(']'); c = c.slice(m.index, b + 1); }
      let v;
      try { v = JSON.parse(c); } catch (e) { continue; }   // a block that isn't JSON is skipped; the valid ones still count
      out = out.concat(Array.isArray(v) ? v : (v && Array.isArray(v.rows) ? v.rows : []));
    }
    return out;
  }

  // The reader's page-level rotation (clockwise degrees to upright); anything but 0, 90, 180, or 270 is 0 (DESIGN § Reading pages).
  function parseRotation(text) {
    const m = String(text || '').match(/"rotation"\s*:\s*(-?\d+(?:\.\d+)?)/);
    return m && [0, 90, 180, 270].includes(+m[1]) ? +m[1] : 0;
  }

  const Core = { parseTOD, fmtTOD, parseTA, fmtTA, TA_MAX, cmpRI, sameRI, normRow, mergeRows, compute, activeIndex, legOf,
    setTA, renameRI, completeActive, CLOSE_MI, closeMi, fmtOCF, uncomplete, lastCompleted, toCSV, parseCSV, parseOCR, parseRotation,
    normBand, normSigns, pagesUsed, signParts, imageFlags, noSignRows };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core; else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
