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
    };
  }

  // ---------- page images (DESIGN § Reading pages → Page images) ----------
  // A band is {page, top, bottom, left, right}: a page copy id and fractions (0-1) of that copy.
  // check:true marks a band where the reader's y overrode its row (flagged on Route).
  function normBand(b) {
    if (!b || typeof b !== 'object' || typeof b.page !== 'string' || !b.page) return null;
    const f = v => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1;
    if (![b.top, b.bottom, b.left, b.right].every(f) || !(b.top < b.bottom) || !(b.left < b.right)) return null;
    const out = { page: b.page, top: b.top, bottom: b.bottom, left: b.left, right: b.right };
    if (b.check) out.check = true;
    return out;
  }
  const pagesUsed = rows => [...new Set(rows.map(x => x.band && x.band.page).filter(Boolean))];

  // Heavy full-width row rules and full-height column rules in a grayscale image {data, w, h}.
  function findRules(img) {
    const { data, w, h } = img, DARK = 110;
    const hs = [];                                   // [start,end] pixel rows that are rule lines
    let x0 = w, x1 = 0;
    for (let y = 0; y < h; y++) {
      let best = 0, bs = 0, run = 0, rs = 0;
      for (let x = 0; x < w; x++) {
        if (data[y * w + x] < DARK) { if (!run) rs = x; run++; if (run > best) { best = run; bs = rs; } } else run = 0;
      }
      if (best >= 0.7 * w) { hs.push(y); x0 = Math.min(x0, bs); x1 = Math.max(x1, bs + best); }
    }
    const group = idx => {                           // consecutive indices (gap of 1 allowed) -> [{s, e}]
      const out = [];
      for (const i of idx) { const g = out[out.length - 1]; if (g && i - g.e <= 2) g.e = i; else out.push({ s: i, e: i }); }
      return out;
    };
    const hr = group(hs);
    let vr = [];
    if (hr.length >= 2) {
      const y0 = hr[0].s, y1 = hr[hr.length - 1].e, span = y1 - y0 + 1, vs = [];
      for (let x = 0; x < w; x++) {
        let c = 0;
        for (let y = y0; y <= y1; y++) if (data[y * w + x] < DARK) c++;
        if (c >= 0.7 * span) vs.push(x);
      }
      vr = group(vs);
    }
    return { hr, vr, x0: hs.length ? x0 : null, x1: hs.length ? x1 : null };
  }

  // The image band for one reader row, or null (no image). img = {data: gray bytes, w, h}; row and y as the
  // reader returned them (invalid or missing values are ignored). The first ruled band is the column headings,
  // so row n is the nth ruled band after it. Returns {top, bottom, left, right, check}, fractions to 4 decimals.
  function findBand(img, row, y) {
    const okRow = Number.isInteger(row) && row > 0;
    const okY = typeof y === 'number' && isFinite(y) && y >= 0 && y <= 1;
    if (!okRow && !okY) return null;
    const q = v => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;
    const { w, h } = img;
    const R = findRules(img), hr = R.hr, vr = R.vr;
    const x0 = R.x0 != null ? R.x0 : 0.05 * w, x1 = R.x1 != null ? R.x1 : 0.95 * w;
    const left = vr.length >= 3 ? vr[vr.length - 3].e + 1 : x0 + 0.4 * (x1 - x0);
    const right = vr.length >= 3 ? vr[vr.length - 1].s : x1;
    const out = (top, bottom, check) => (bottom > top && right > left)
      ? { top: q(top / h), bottom: q(bottom / h), left: q(left / w), right: q(right / w), check: !!check } : null;
    if (hr.length >= 3) {
      const bandAt = yy => { for (let i = 1; i < hr.length - 1; i++) if (yy >= hr[i].e + 1 && yy < hr[i + 1].s) return i; return -1; };
      const rowBand = okRow && row < hr.length - 1 ? row : -1;
      const yBand = okY ? bandAt(y * h) : -1;
      const i = yBand >= 0 ? yBand : rowBand;
      if (i >= 1) return out(hr[i].e + 1, hr[i + 1].s, okRow && yBand >= 0 && rowBand !== yBand);
      if (!okY) return null;                         // row names a band that is not there and y gives none
    }
    if (!okY) return null;                           // too few rules and no y
    const M = 0.04 * h;                              // fixed margin each side of y
    return out(Math.max(0, y * h - M), Math.min(h, y * h + M), false);
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
        out[i] = { ...r, done: o.done, ttDone: o.ttDone, doneAt: o.doneAt, estLock: o.estLock, band: r.band || o.band };
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

  const Core = { parseTOD, fmtTOD, parseTA, fmtTA, TA_MAX, cmpRI, sameRI, normRow, mergeRows, compute, activeIndex, legOf,
    setTA, renameRI, completeActive, CLOSE_MI, closeMi, fmtOCF, uncomplete, lastCompleted, toCSV, parseCSV, parseOCR,
    normBand, pagesUsed, findBand };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core; else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
