// Route Table core: pure functions, no DOM, no clock.
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
  // Relative time (TA): "30", "-12", "+1:05", "-0:45", ".50m" / "1.25m" (minutes, decimal)
  function parseRel(s) {
    if (s == null) return null;
    s = String(s).trim().replace(/\s+/g, '');
    if (!s) return 0;
    let m = s.match(/^([+-]?)(\d*\.?\d+)m$/i);
    if (m) return (m[1] === '-' ? -1 : 1) * Math.round(parseFloat(m[2]) * 60 * 100) / 100;
    m = s.match(/^([+-]?)(\d+):(\d{2})$/);
    if (m) return (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]);
    m = s.match(/^([+-]?)(\d+(?:\.\d+)?)s?$/);
    if (m) return (m[1] === '-' ? -1 : 1) * parseFloat(m[2]);
    return null;
  }
  function fmtRel(sec, mode) {
    if (sec == null || !isFinite(sec)) return '';
    const sg = sec < 0 ? '-' : sec > 0 ? '+' : '';
    const a = Math.abs(sec);
    if (mode === 'hmc') return `${sg}${(a / 60).toFixed(2)}m`;
    const r = Math.round(a);
    return `${sg}${Math.floor(r / 60)}:${p2(r % 60)}`;
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
      if (m) { restart = true; om = m[1] != null ? +m[1] : null; } else om = num(om);
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
      done: !!x.done, ttDone: x.ttDone ?? null, doneAt: x.doneAt ?? null, showEst: !!x.showEst,
      estLock: x.estLock ?? null, estLockBy: x.estLockBy ?? null,
    };
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
        out[i] = { ...r, done: o.done, ttDone: o.ttDone, doneAt: o.doneAt, showEst: o.showEst, estLock: o.estLock, estLockBy: o.estLockBy };
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
  // Rows before the first restart form an unnamed leg (leg null) so a rally can be
  // test-run from the middle; their VM is OM x OCF in whatever frame the OM is printed.
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
    let leg = null, legRows = [], ta = 0;
    rows.forEach((r, i) => {
      const restart = !!r.restart;
      if (restart) { leg = String(r.ri); legRows = []; ta = 0; }
      const ev = events.find(e => sameRI(e.ri, r.ri));
      if (ev) ta = +ev.ta || 0;
      const vm = restart ? 0 : (r.om == null ? null : r.om * ocf);
      const vmPrevEnd = restart && r.om != null ? r.om * ocf : null;
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
    let leg = null;
    (rally.rows || []).forEach((r, i) => { if (i <= idx && r.restart) leg = String(r.ri); });
    return leg;
  }

  // Set the TA at row idx (replaces a TA already entered at that row). Returns new events array.
  function setTA(rally, idx, sec, now) {
    const ri = rally.rows[idx].ri;
    const ev = (rally.taEvents || []).filter(e => !sameRI(e.ri, ri));
    ev.push({ ri, ta: sec, at: now ?? null });
    return ev;
  }

  // Lock / unlock a row's estimated TT. Returns new rows array (unchanged if nothing to lock).
  function lockEst(rally, idx, by) {
    const c = compute(rally)[idx];
    if (!c || c.tt != null || c.estLive == null) return rally.rows;
    return rally.rows.map((r, i) => i === idx ? { ...r, estLock: c.estLive, estLockBy: by || 'tap', showEst: true } : r);
  }
  function unlockEst(rally, idx) {
    return rally.rows.map((r, i) => i === idx ? { ...r, estLock: null, estLockBy: null } : r);
  }

  // Mark the active row complete; records the TT it had and locks any estimate.
  function completeActive(rally, now) {
    const a = activeIndex(rally);
    if (a < 0) return rally.rows;
    const c = compute(rally)[a];
    return rally.rows.map((r, i) => {
      if (i !== a) return r;
      const x = { ...r, done: true, ttDone: c.tt, doneAt: now ?? null };
      if (c.tt == null) Object.assign(x, { estLock: c.estLive, estLockBy: c.estLive == null ? null : 'done' });
      return x;
    });
  }
  // Un-complete a row; its locked estimate is released.
  function uncomplete(rally, idx) {
    return rally.rows.map((r, i) => i === idx ? { ...r, done: false, ttDone: null, doneAt: null, estLock: null, estLockBy: null } : r);
  }
  // Index of the most recently completed row (by doneAt; ties/absent -> highest index).
  function lastCompleted(rally) {
    let best = -1, bestT = -Infinity;
    (rally.rows || []).forEach((r, i) => {
      if (!r.done) return;
      const t = r.doneAt ?? -1;
      if (t > bestT || (t === bestT && i > best)) { best = i; bestT = t; }
    });
    return best;
  }

  // ---------- export ----------
  function csvEsc(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
  function toCSV(rally, mode) {
    const C = compute(rally);
    const crew = rally.crew || {};
    const head = [
      ['Rally', rally.name], ['Date', rally.date], ['Driver', crew.driver], ['Navigator', crew.navigator],
      ['Passengers', (crew.passengers || []).join('; ')], ['Car number', rally.cn], ['Class', rally.cls], ['OCF', rally.ocf],
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
      const v = JSON.parse(c);
      out = out.concat(Array.isArray(v) ? v : (v && Array.isArray(v.rows) ? v.rows : []));
    }
    return out;
  }

  const Core = { parseTOD, fmtTOD, parseRel, fmtRel, cmpRI, sameRI, normRow, mergeRows, compute, activeIndex, legOf,
    setTA, lockEst, unlockEst, completeActive, CLOSE_MI, closeMi, uncomplete, lastCompleted, toCSV, parseOCR };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core; else root.Core = Core;
})(typeof window !== 'undefined' ? window : globalThis);
