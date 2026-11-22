// Rally vision: pure image functions (no DOM, no clock). DESIGN § Reading pages → Page images and Sign images.
// An image is RGBA {data, w, h} (what a canvas's getImageData gives). Everything here is a function of pixels
// and numbers, so it is unit-tested under Node on pages the test draws (test/vision.test.js).
(function (root) {
  'use strict';

  // ---------- thresholds: the brief's starting values, tuned on the evaluation set (rule numbers: DESIGN) ----------
  const K = {
    BLOCK: 1 / 40,        // rule 3: adaptive-threshold window, as a fraction of the page width
    C: 12,                // rule 3: ink is this many grey levels below the local mean
    STROKE: 0.006,        // widest ink run (fraction of the longer side) that can belong to a rule
    PIECE: 0.08,          // shortest piece (fraction of the rule length wanted) kept to be joined
    JOIN: 0.08, JOIN_TOL: 3, OVERLAP: 12, JOIN_SLOPE: 0.02,   // pieces in line within this fraction of the page, and this many pixels, are one rule
    GAP: 0.01,            // widest break in a rule (fraction of its direction) that is bridged
    H_MIN: 0.30,          // shortest row rule candidate (fraction of the width)
    V_MIN: 0.15,          // shortest column rule candidate (fraction of the height)
    SIDE: 25, SIDE_D: 0.003, SIDE_OK: 0.5,   // rule 5: a rule is this much darker than the paper on both sides, at this distance
    CONTRAST: 0.5,        // rule 5: a column rule's contrast with its paper is at least this share of the typical column rule's
    LIMIT_SNAP: 0.5,      // rule 5: a body limit snaps to the nearest row rule within this many median row pitches
    COL_SHORT: 0.5,       // rule 5: a column rule may fall short of a body limit by this many row pitches
    ROW_SPAN: 0.8,        // rule 5: a row rule spans at least this much of the table width
    ROW_SLACK: 0.01,      // rule 5: a column rule's end may fall short of the row rule it ends on by this fraction of the page height (only to tell which rules cross)
    PIECE_GAP: 0.5,       // rule 5: pieces of a column rule that overlap or gap by at most this many row pitches may be one rule
    INSTR_GAP: 0.5,       // rule 5: a row rule may stop short of an Instruction-cell rule by this many median column widths
    MERGE: 0.005,         // rule 5: rules closer than this fraction of the page height are merged; also the slack at the body's edges
    MARGIN_X: 0.03, MARGIN_Y: 0.02,   // the window the rules are found in: margin kept around the table (fraction of the table size)
    SHEET_X: 0.5, SHEET_Y: 0.6,       // page copy: most of the sheet kept beside / above and below the table (fraction of the table size)
    COPY_MAX: 2000,       // page copy: longest side in pixels
    FALLBACK: 0.04,       // rule 8: half-height of the fallback band (fraction of the page height)
    PAGE_MIN_ROWS: 2,     // rule 7: rows that must agree before the headings offset is overridden
    SOUND_MAJORITY: 1 / 2,   // rule 9: a page is sound when more than this fraction of its rows with a usable y have y inside their own row's band
    CELL_MX: 6, CELL_MY: 7,       // rule 10: pixels kept clear of the cell's rules (at 1,500 px page width)
    JOIN_W: 5, JOIN_H: 1,         // rule 12: ink joins sideways (radius) but not between lines
    TALL: 1.8, WIDE: 1.2, // rule 12: a graphic is taller / wider than this many text heights
    TEXT_PCT: 0.4,        // rule 11: text height is this point of the heights of the lines of text, by width
    MIN_AREA: 30,         // rule 11: smallest component counted
    LINE_ASPECT: 1.5,     // rule 11: a line of text is at least this many times wider than tall
    MERGE_GAP: 8,         // rule 12: boxes this close (pixels at 1,500 px page width) merge
  };

  // ---------- small helpers ----------
  const median = a => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  // The text height (rule 11), from the lines of text in the cells: items are [height, width]. The most common height, each line counted by
  // its width, finds the text (a few long lines outweigh many scraps of lettering inside signs); scraps under half that are then dropped and
  // the text height is the K.TEXT_PCT point of what is left (lines with descenders are taller than lines without).
  const textHeight = items => {
    const bins = new Map(); for (const [h, w] of items) { const k = Math.round(h / 2); bins.set(k, (bins.get(k) || 0) + w); }
    let best = -1, bw = -1; for (const k of bins.keys()) { const sc = (bins.get(k - 1) || 0) + bins.get(k) + (bins.get(k + 1) || 0); if (sc > bw || (sc === bw && k > best)) { bw = sc; best = k; } }
    const kept = items.filter(([h]) => h >= best), tot = kept.reduce((n, v) => n + v[1], 0);   // best is half the mode's height in 2 px bins
    kept.sort((x, y) => x[0] - y[0]);
    let c = 0; for (const v of kept) { c += v[1]; if (c >= K.TEXT_PCT * tot) return v[0]; }
    return kept[kept.length - 1][0];
  };
  const q4 = v => Math.round(Math.min(1, Math.max(0, v)) * 10000) / 10000;

  function toGray(img) {
    const { data, w, h } = img, n = w * h, g = new Uint8Array(n);
    for (let i = 0, j = 0; j < n; j++, i += 4) g[j] = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
    return g;
  }

  // Rule 3: ink = darker than the local mean by C, over a window of w/40. Local, so a shadow or the dark
  // background around the page does not swamp the rules.
  function binarize(g, w, h) {
    const W1 = w + 1, I = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) { let row = 0; for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row; } }
    const r = Math.max(2, (Math.round(w * K.BLOCK) | 1) >> 1), bin = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
        const s = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
        if (g[y * w + x] < s / ((x1 - x0) * (y1 - y0)) - K.C) bin[y * w + x] = 1;
      }
    }
    return bin;
  }
  function colMajor(bin, w, h) { const cm = new Uint8Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cm[x * h + y] = bin[y * w + x]; return cm; }

  // ---------- following thin dark strokes ----------
  // M is indexed [along * perp + across]. Walks along; in each step finds the short ink runs (a rule is thin) and
  // joins each to the stroke that was at about that place a step before. Text makes only short strokes; a rule
  // makes one that runs the page. Returns strokes {T, U, th}: centre U at each step T, mean thickness th.
  function trace(M, along, perp, minLen, maxThick, gapMax) {
    const out = [], occ = new Int32Array(perp + 16).fill(-1);
    let act = [];
    const fin = tr => { const n = tr.T.length; if (n >= 2 && tr.T[n - 1] - tr.T[0] >= K.PIECE * minLen) { tr.th /= n; out.push(tr); } };
    for (let a = 0; a < along; a++) {
      const base = a * perp, segs = [];
      for (let p = 0; p < perp;) {
        if (M[base + p]) { let q = p + 1; while (q < perp && M[base + q]) q++; if (q - p <= maxThick) segs.push((p + q - 1) / 2, q - p); p = q; } else p++;
      }
      for (let i = 0; i < act.length; i++) {
        const tr = act[i]; tr.pred = tr.u + tr.slope * (a - tr.a); tr.hit = false;
        const k = Math.round(tr.pred); if (k >= 0 && k < perp && occ[k + 8] < 0) occ[k + 8] = i;
      }
      const fresh = [];
      for (let s = 0; s < segs.length; s += 2) {
        const c = segs[s], th = segs[s + 1], k = Math.round(c);
        let best = -1, bd = 1e9;
        if (k >= 0 && k < perp) for (let d = -4; d <= 4; d++) {
          const idx = occ[k + d + 8]; if (idx < 0) continue;
          const tr = act[idx]; if (tr.hit) continue;
          const dd = Math.abs(tr.pred - c);
          if (dd <= 1.8 + 0.2 * (a - tr.a) && dd < bd) { bd = dd; best = idx; }
        }
        if (best >= 0) {
          const tr = act[best]; tr.hit = true;
          if (tr.T.length < 4 || th <= 1.7 * tr.th / tr.T.length + 1) {   // a fat run is a junction with another rule: skip it
            tr.T.push(a); tr.U.push(c); tr.th += th; tr.a = a; tr.u = c;
            const n = tr.T.length, b = Math.min(n - 1, 12); if (b >= 5) tr.slope = (tr.U[n - 1] - tr.U[n - 1 - b]) / (tr.T[n - 1] - tr.T[n - 1 - b]);
          }
        } else fresh.push({ T: [a], U: [c], th, a, u: c, slope: 0, pred: c, hit: true });
      }
      const keep = [];
      for (const tr of act) {
        const k = Math.round(tr.pred); if (k >= 0 && k < perp) occ[k + 8] = -1;
        if (a - tr.a <= gapMax) keep.push(tr); else fin(tr);
      }
      act = keep.concat(fresh);
    }
    for (const tr of act) fin(tr);
    return joinStrokes(out, K.JOIN * along).filter(tr => tr.T[tr.T.length - 1] - tr.T[0] >= minLen);
  }
  // A rule broken where another rule meets it comes back as pieces; pieces in line with each other are joined.
  function joinStrokes(ps, maxGap) {
    ps = ps.slice().sort((a, b) => a.T[0] - b.T[0]);
    const lsq = (T, U) => { const n = T.length; if (n < 6) return { s: 0, n: 0 }; let st = 0, su = 0, stt = 0, stu = 0; for (let i = 0; i < n; i++) { st += T[i]; su += U[i]; stt += T[i] * T[i]; stu += T[i] * U[i]; } const d = n * stt - st * st; return { s: d ? (n * stu - st * su) / d : 0, n }; };
    const tail = tr => lsq(tr.T.slice(-80), tr.U.slice(-80)), head = tr => lsq(tr.T.slice(0, 80), tr.U.slice(0, 80));
    for (let i = 0; i < ps.length; i++) {
      for (let again = true; again;) {
        again = false;
        const A = ps[i], ta = A.T[A.T.length - 1], ua = A.U[A.U.length - 1], sa = tail(A);
        for (let j = i + 1; j < ps.length; j++) {
          const B = ps[j]; if (B.T[0] - ta > maxGap) break;                   // sorted by start
          if (B.T[0] < ta - K.OVERLAP) continue;                                 // a stroke alongside, not the next piece
          const sb = head(B), tol = Math.min(sa.n, sb.n) >= 30 ? K.JOIN_SLOPE : 4 * K.JOIN_SLOPE;
          if (Math.abs(B.U[0] - (ua + sa.s * (B.T[0] - ta))) > K.JOIN_TOL || Math.abs(sb.s - sa.s) > tol) continue;
          let keep = A.T.length; while (keep > 0 && A.T[keep - 1] >= B.T[0]) keep--;      // pieces may overlap by a few steps
          if (keep < 2) continue;
          A.th = A.th * keep / (keep + B.T.length) + B.th * B.T.length / (keep + B.T.length);
          A.T = A.T.slice(0, keep).concat(B.T); A.U = A.U.slice(0, keep).concat(B.U); ps.splice(j, 1); again = true; break;
        }
      }
    }
    return ps;
  }

  // Least-squares gentle curve u(t) through a stroke; normalised variable s in [-1, 1] so a crease can bend a rule a little.
  function fitCurve(tr) {
    const n = tr.T.length, t0 = tr.T[0], t1 = tr.T[n - 1], tc = (t0 + t1) / 2, hh = (t1 - t0) / 2 || 1;
    const order = (t1 - t0) > 60 ? 2 : 1;
    let c = [0, 0, 0], use = tr.T.map((_, i) => i);
    for (let pass = 0; pass < 2; pass++) {
      const m = order + 1, A = [], B = new Array(m).fill(0);
      for (let i = 0; i < m; i++) A.push(new Array(m).fill(0));
      for (const i of use) {
        const s = (tr.T[i] - tc) / hh, f = [1, s, s * s];
        for (let r = 0; r < m; r++) { B[r] += f[r] * tr.U[i]; for (let q = 0; q < m; q++) A[r][q] += f[r] * f[q]; }
      }
      for (let i = 0; i < m; i++) {                                   // Gaussian elimination
        let p = i; for (let r = i + 1; r < m; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
        [A[i], A[p]] = [A[p], A[i]]; [B[i], B[p]] = [B[p], B[i]];
        if (Math.abs(A[i][i]) < 1e-12) continue;
        for (let r = i + 1; r < m; r++) { const f = A[r][i] / A[i][i]; for (let q = i; q < m; q++) A[r][q] -= f * A[i][q]; B[r] -= f * B[i]; }
      }
      c = [0, 0, 0];
      for (let i = m - 1; i >= 0; i--) { let v = B[i]; for (let q = i + 1; q < m; q++) v -= A[i][q] * c[q]; c[i] = Math.abs(A[i][i]) < 1e-12 ? 0 : v / A[i][i]; }
      const res = tr.T.map((t, i) => { const s = (t - tc) / hh; return Math.abs(tr.U[i] - (c[0] + c[1] * s + c[2] * s * s)); });
      if (pass === 0) { use = res.map((r, i) => i).filter(i => res[i] <= 3); if (use.length < 0.5 * n) break; } else break;
    }
    return { c0: c[0], c1: c[1], c2: c[2], t0, t1, tc, hh, th: tr.th };
  }
  const ev = (c, t) => { const s = Math.max(-1.3, Math.min(1.3, (t - c.tc) / c.hh)); return c.c0 + c.c1 * s + c.c2 * s * s; };

  // Rule 5: a rule is darker than the paper on both sides. Sets c.dark (typical grey along the rule); true if it is a rule.
  function lineTest(g, w, h, c, horiz) {
    const N = 40, d = Math.max(3, Math.round(K.SIDE_D * Math.max(w, h))), cs = [], cons = [];
    const px = (t, u) => { const x = horiz ? t : u, y = horiz ? u : t; return g[Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))]; };
    let ok = 0;
    for (let i = 0; i < N; i++) {
      const t = c.t0 + (c.t1 - c.t0) * (i + 0.5) / N, u = ev(c, t);
      const mid = Math.min(px(t, u - 1), px(t, u), px(t, u + 1)), a = px(t, u - d), b = px(t, u + d); cs.push(mid); cons.push((a + b) / 2 - mid);
      if (a - mid > K.SIDE && b - mid > K.SIDE) ok++;
    }
    c.dark = median(cs); c.con = median(cons);
    return ok / N >= K.SIDE_OK;
  }

  // All long dark strokes of the page, as fitted curves. H: u is y over t = x. V: u is x over t = y.
  function rulesOf(img, o) {
    o = o || {};
    const { w, h } = img, g = toGray(img), bin = binarize(g, w, h), cm = colMajor(bin, w, h);
    const maxT = Math.max(6, Math.round(K.STROKE * Math.max(w, h)));
    const mk = (strokes, horiz) => strokes.map(fitCurve).filter(c => lineTest(g, w, h, c, horiz));
    const H = mk(trace(cm, w, h, (o.hMin || K.H_MIN) * w, maxT, Math.max(6, Math.round(K.GAP * w))), true);
    const V = mk(trace(bin, h, w, (o.vMin || K.V_MIN) * h, maxT, Math.max(6, Math.round(K.GAP * h))), false);
    return { w, h, g, bin, H, V };
  }

  // Rule 1: a page shot sideways has more long vertical rules than horizontal ones. Returns the clockwise quarter turns (0 or 1).
  function needsTurn(img) {
    const m = 0.3 * Math.min(img.w, img.h), R = rulesOf(img, { hMin: m / img.w, vMin: m / img.h });
    const count = (cs, span) => { const pos = cs.map(c => ev(c, c.tc)).sort((a, b) => a - b); let n = 0, last = -1e9; for (const p of pos) { if (p - last > K.MERGE * span) n++; last = p; } return n; };
    return count(R.V, img.w) > count(R.H, img.h) ? 1 : 0;
  }

  // ---------- the table ----------
  function dedupe(cs, pos, minD, longer) {              // keep the first of rules closer than minD (the longer one when longer is set)
    const s = cs.map(c => ({ c, p: pos(c) })).sort((a, b) => a.p - b.p), out = [];
    for (const x of s) {
      if (!out.length || x.p - out[out.length - 1].p >= minD) out.push(x);
      else if (longer && x.c.t1 - x.c.t0 > out[out.length - 1].c.t1 - out[out.length - 1].c.t0) out[out.length - 1] = x;
    }
    return out.map(x => x.c);
  }
  function cross(hc, vc, y0) {                           // where a row rule (y over x) meets a column rule (x over y)
    let y = y0, x = ev(vc, y);
    for (let i = 0; i < 8; i++) { y = ev(hc, x); x = ev(vc, y); }
    return [x, y];
  }
  // Rules 5-6 and the table frame (DESIGN § Reading pages → Page images → Finding the table). Returns
  // {ok, V, H, Hout, head, xc, ym, tw, quad, diag}. ok: a frame; head: the headings band index (0 when ok, the body's first band);
  // Hout: row-rule candidates outside the body (the lines of a box above or below); diag: what the harness reports (reruns, limits, margins).
  // Order: (1) long verticals, provisional outer rules; (2) horizontals that span the table and cross two interior verticals; (3) first pitch;
  // (4) the body's limits, voted by the interior verticals' ends; (5) column test; (6) row test against the final columns; (7) a side with no
  // limit takes the outermost row rule that passes the row test; (8) final pitch. Steps 5-6 run at most twice: the second run happens once, when
  // the outer rules changed (from step 2) or, otherwise, always once more with the final pitch (and a fallback limit in place of a provisional one).
  function gridOf(R) {
    const { w, h } = R, res = { ok: false, V: [], H: [], Hout: [], head: null, xc: w / 2, quad: null, diag: null };
    let V = R.V;
    if (V.length < 3) return res;
    const med = median(V.map(v => v.con));
    V = V.filter(v => v.con >= K.CONTRAST * med);                        // rule 5: about as dark as the others (against its own paper)
    const ym0 = median(V.map(v => (v.t0 + v.t1) / 2));
    if (dedupe(V, v => ev(v, ym0), K.MERGE * h, true).length < 3) return res;
    const mergeD = K.MERGE * h, slack = K.ROW_SLACK * h;
    const gapsOf = ys => { const g = []; for (let i = 1; i < ys.length; i++) g.push(ys[i] - ys[i - 1]); return median(g); };
    // Pieces of one column rule that the trace left apart (a break, or an overlap longer than joinStrokes joins) are one rule when: they
    // overlap or gap by at most K.PIECE_GAP row pitches, their fitted lines agree within the merge distance over that stretch, their union
    // covers the body (the provisional limits topC and botC, as in the column test), and the combined rule passes the line and contrast tests.
    const mergePieces = (vs, pitch, topC, botC, yAt) => {
      vs = vs.slice();
      const covers = c => c.t0 <= yAt(topC, c) + K.COL_SHORT * pitch && c.t1 >= yAt(botC, c) - K.COL_SHORT * pitch;
      for (let again = true; again;) {
        again = false;
        search: for (const A of vs) for (const B of vs) {
          if (A === B || !(A.t0 < B.t0 && B.t1 > A.t1) || Math.abs(B.t0 - A.t1) > K.PIECE_GAP * pitch) continue;
          const lo = Math.min(A.t1, B.t0), hi = Math.max(A.t1, B.t0);
          if (![lo, (lo + hi) / 2, hi].every(t => Math.abs(ev(A, t) - ev(B, t)) <= mergeD)) continue;
          const T = [], U = [], cut = (lo + hi) / 2;
          for (let t = Math.ceil(A.t0); t <= B.t1; t++) { T.push(t); U.push(ev(t <= cut ? A : B, t)); }
          const c = fitCurve({ T, U, th: (A.th + B.th) / 2 });
          if (!covers(c) || !lineTest(R.g, w, h, c, false) || c.con < K.CONTRAST * med) continue;
          vs = vs.filter(x => x !== A && x !== B).concat([c]); again = true; break search;
        }
      }
      return dedupe(vs, v => ev(v, ym0), mergeD, true);
    };
    // One pass over steps 2-8 for the candidate verticals Vraw. fixed: {pitch, top, bot} to skip steps 2-4 (a rerun with the limits as found).
    // last: no further rerun, so the outer rules are taken as they are.
    const attempt = (Vraw, fixed, last) => {
      const Vc = dedupe(Vraw, v => ev(v, ym0), mergeD, true);
      if (Vc.length < 3) return { V: Vc, H: [], fail: true, notSnapped: [], votes: {} };
      let VV = Vc;                                                       // the candidates after pieces are combined
      const n = Vc.length, xl = ev(Vc[0], ym0), xr = ev(Vc[n - 1], ym0), tw = (xr - xl), xc = (xl + xr) / 2, inner = Vc.slice(1, -1);
      const s = { Vc, V: Vc, H: [], pitchUsed: 0, pitch1: NaN, notSnapped: [], votes: {} };
      let pitch, top, bot, topSn, botSn;
      if (fixed) { pitch = fixed.pitch; top = fixed.top; bot = fixed.bot; topSn = botSn = true; s.notSnapped = fixed.notSnapped; }
      else {
        const yAt = (c, v) => cross(c, v, ev(c, xc))[1], need = Math.min(2, inner.length);
        const W = dedupe(R.H.filter(c => c.t1 - c.t0 >= K.ROW_SPAN * tw), c => ev(c, xc), mergeD);       // every rule that spans the table: the candidates the verticals' ends vote among
        if (W.length < 2) { s.H = W; s.fail = true; return s; }
        const Q0 = W.filter(c => inner.filter(v => { const y = yAt(c, v); return y >= v.t0 - slack && y <= v.t1 + slack; }).length >= need), Q = Q0.length >= 2 ? Q0 : W;
        pitch = s.pitch1 = gapsOf(Q.map(c => ev(c, xc)));
        VV = mergePieces(Vraw, pitch, Q[0], Q[Q.length - 1], yAt);
        const inr = VV.slice(1, -1);
        // a limit is the outermost row rule that a majority of the interior column rules cover: a rule covers a row rule when it is present at
        // its height, or when that row rule is the nearest candidate to the column rule's end, within LIMIT_SNAP pitches (so a box line near the
        // headings' top rule is not covered by column rules that end at the headings). A plurality never sets a limit, and a few rules reaching
        // into a box cannot select the box's line. next: the most covered of the rules passed over (outside the one chosen).
        const nearest = (v, at) => { let best = null, bd = Infinity; for (const c of W) { const d = Math.abs(yAt(c, v) - at); if (d < bd) { bd = d; best = c; } } return bd <= K.LIMIT_SNAP * pitch ? best : null; };
        const nearTop = new Map(inr.map(v => [v, nearest(v, v.t0)])), nearBot = new Map(inr.map(v => [v, nearest(v, v.t1)]));
        const vote = isTop => {
          const order = isTop ? W : W.slice().reverse(); let next = 0;
          for (const c of order) {
            let k = 0;
            for (const v of inr) { const y = yAt(c, v); if ((y >= v.t0 && y <= v.t1) || (isTop ? nearTop : nearBot).get(v) === c) k++; }
            if (2 * k > inr.length) return { c, votes: k, next, of: inr.length };
            next = Math.max(next, k);
          }
          return null;
        };
        const t = vote(true), b = vote(false);
        top = t ? t.c : Q[0]; bot = b ? b.c : Q[Q.length - 1]; topSn = !!t; botSn = !!b;
        s.votes = { top: t && { votes: t.votes, next: t.next, of: t.of }, bottom: b && { votes: b.votes, next: b.next, of: b.of } };
        if (!t) s.notSnapped.push('top'); if (!b) s.notSnapped.push('bottom');
      }
      s.pitchUsed = pitch;
      const yAt = (c, v) => cross(c, v, ev(c, xc))[1], sh = K.COL_SHORT * pitch;     // step 5: a column rule covers the body, anything above is ignored
      const Vcol = VV.filter(v => v.t0 <= yAt(top, v) + sh && v.t1 >= yAt(bot, v) - sh);
      s.V = Vcol;
      if (Vcol.length < 3) { s.fail = true; return s; }
      if (!last && (Vcol[0] !== VV[0] || Vcol[Vcol.length - 1] !== VV[VV.length - 1])) { s.outerChanged = true; return s; }
      // step 6: row rules against the final columns
      const m = Vcol.length, xl2 = ev(Vcol[0], ym0), xr2 = ev(Vcol[m - 1], ym0), tw2 = xr2 - xl2, xc2 = (xl2 + xr2) / 2;
      const yc = c => ev(c, xc2), yAt2 = (c, v) => cross(c, v, yc(c))[1];
      const cw = median(Vcol.slice(1).map((v, i) => ev(v, ym0) - ev(Vcol[i], ym0))), g = K.INSTR_GAP * cw;
      const iv = [Vcol[m - 3], Vcol[m - 2]];                              // the Instruction cell: second-to-last and third-to-last rules from the right
      const gapTo = (c, v) => { const x = cross(c, v, yc(c))[0]; return c.t0 > x ? c.t0 - x : c.t1 < x ? x - c.t1 : 0; };
      const rowOk = c => c.t1 - c.t0 >= K.ROW_SPAN * tw2 && iv.every(v => gapTo(c, v) <= g);
      const yTop = yc(top), yBot = yc(bot), innerC = Vcol.slice(1, -1), needC = Math.min(2, innerC.length);
      const crosses = c => innerC.filter(v => { const y = yAt2(c, v); return y >= v.t0 - slack && y <= v.t1 + slack; }).length >= needC;
      // a side with a snapped limit is bounded by it; a side without one takes the outermost rule that passes the row test and still meets the interior column rules
      const cand = R.H.filter(c => {
        if (!rowOk(c)) return false;
        const y = yc(c);
        if ((topSn && y < yTop - mergeD) || (botSn && y > yBot + mergeD)) return false;
        return (y >= yTop - mergeD && y <= yBot + mergeD) || crosses(c);
      });
      if (topSn && !cand.includes(top)) cand.push(top);
      if (botSn && !cand.includes(bot)) cand.push(bot);
      const Hs = dedupe(cand, yc, mergeD);
      s.xc = xc2; s.tw = tw2; s.H = Hs;
      if (Hs.length < 2) { s.fail = true; return s; }
      s.topFell = !topSn && Hs[0] !== top; s.botFell = !botSn && Hs[Hs.length - 1] !== bot;     // step 7
      s.top = Hs[0]; s.bot = Hs[Hs.length - 1]; s.pitch = gapsOf(Hs.map(yc));                  // step 8
      const hcon = median(Hs.map(c => c.con)), lo = Math.min(xl2, xr2), hi = Math.max(xl2, xr2);   // outside the body: spans 80% of tw between the outer rules, and as dark as the body's rules
      const reach1 = (v, y) => y >= v.t0 - K.LIMIT_SNAP * s.pitch && y <= v.t1 + K.LIMIT_SNAP * s.pitch;     // both outer rules, as traced before clipping, reach the line
      s.Hout = R.H.filter(c => { if (Hs.includes(c)) return false; const y = yc(c); if (!(y < yc(s.top) - mergeD || y > yc(s.bot) + mergeD)) return false; if (!reach1(Vcol[0], y) || !reach1(Vcol[m - 1], y)) return false; return Math.min(c.t1, hi) - Math.max(c.t0, lo) >= K.ROW_SPAN * tw2 && c.con >= K.CONTRAST * hcon; });
      const need = needC, reach = (c, v) => { const y = yAt2(c, v); return Math.max(0, v.t0 - y, y - v.t1); };
      s.margins = {
        cols: Vcol.map(v => ({ short: [Math.max(0, v.t0 - yAt2(s.top, v)) / s.pitch, Math.max(0, yAt2(s.bot, v) - v.t1) / s.pitch] })),
        rows: Hs.map(c => ({ width: (c.t1 - c.t0) / tw2 - K.ROW_SPAN, gaps: iv.map(v => gapTo(c, v) / cw),
          cross: need ? (slack - innerC.map(v => reach(c, v)).sort((a, b) => a - b)[need - 1]) / slack : null })),   // ROW_SLACK's margin: > 0 passes with room
        out: s.Hout.map(c => ({ y: yc(c), width: (Math.min(c.t1, hi) - Math.max(c.t0, lo)) / tw2 })),
      };
      return s;
    };
    const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
    const reruns = [];
    let s = attempt(V, null, false);
    if (s.outerChanged) {                                                // the outer rules and tw of step 1 were provisional: start again from step 2
      const prev = s.V; s = attempt(prev, null, true); reruns.push({ trigger: ['outer rules'], changed: true });
    } else if (!s.fail) {                                                // always once more, with the final pitch (and the fallback limits, if any)
      const trigger = ['final pitch'];
      if (s.topFell || s.botFell) trigger.push('fallback limit');
      const prev = s, ns = attempt(prev.V, { pitch: prev.pitch, top: prev.top, bot: prev.bot, notSnapped: prev.notSnapped }, true);
      reruns.push({ trigger, changed: !!ns.fail || !same(prev.V, ns.V) || !same(prev.H, ns.H) });
      s = Object.assign(ns, { votes: prev.votes, pitch1: prev.pitch1 });
    }
    res.V = s.V; res.H = s.H;
    res.diag = { pitch1: s.pitch1, pitch: s.pitch, notSnapped: s.notSnapped, votes: s.votes, reruns, margins: s.margins || null };
    if (s.fail) return res;
    Object.assign(res, { xc: s.xc, ym: ym0, tw: s.tw, Hout: s.Hout || [], head: 0 });
    const top = s.top, bot = s.bot, l = s.V[0], r = s.V[s.V.length - 1], y0 = ev(top, res.xc), y1 = ev(bot, res.xc);
    res.quad = [cross(top, l, y0), cross(top, r, y0), cross(bot, r, y1), cross(bot, l, y1)];
    res.ok = true;
    return res;
  }

  // ---------- geometry ----------
  // Homography (3x3, row-major array of 9) taking the four points src to dst.
  function homography(src, dst) {
    const A = [], B = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
    }
    for (let i = 0; i < 8; i++) {
      let p = i; for (let r = i + 1; r < 8; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]]; [B[i], B[p]] = [B[p], B[i]];
      for (let r = i + 1; r < 8; r++) { const f = A[r][i] / A[i][i]; for (let q = i; q < 8; q++) A[r][q] -= f * A[i][q]; B[r] -= f * B[i]; }
    }
    const x = new Array(8);
    for (let i = 7; i >= 0; i--) { let v = B[i]; for (let q = i + 1; q < 8; q++) v -= A[i][q] * x[q]; x[i] = v / A[i][i]; }
    return [...x, 1];
  }
  function applyH(M, x, y) { const d = M[6] * x + M[7] * y + M[8]; return [(M[0] * x + M[1] * y + M[2]) / d, (M[3] * x + M[4] * y + M[5]) / d]; }
  function mulH(A, B) { const C = new Array(9).fill(0); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) C[i * 3 + j] += A[i * 3 + k] * B[k * 3 + j]; return C; }
  function invH(M) {
    const [a, b, c, d, e, f, g, h, i] = M, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    return [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(v => v / det);
  }
  // Clockwise quarter turns: the image, and the matrix taking old pixel coordinates to new.
  function rotateImg(img, turns) {
    turns = ((turns % 4) + 4) % 4; if (!turns) return img;
    const { data, w, h } = img, ow = turns === 2 ? w : h, oh = turns === 2 ? h : w, out = new Uint8ClampedArray(ow * oh * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = turns === 1 ? h - 1 - y : turns === 2 ? w - 1 - x : y, ny = turns === 1 ? x : turns === 2 ? h - 1 - y : w - 1 - x;
      const s = (y * w + x) * 4, d = (ny * ow + nx) * 4; out[d] = data[s]; out[d + 1] = data[s + 1]; out[d + 2] = data[s + 2]; out[d + 3] = data[s + 3];
    }
    return { data: out, w: ow, h: oh };
  }
  function rotMatrix(w, h, turns) {
    turns = ((turns % 4) + 4) % 4;
    return turns === 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : turns === 1 ? [0, -1, h - 1, 1, 0, 0, 0, 0, 1] : turns === 2 ? [-1, 0, w - 1, 0, -1, h - 1, 0, 0, 1] : [0, 1, 0, -1, 0, w - 1, 0, 0, 1];
  }
  // Bilinear sample of img into an ow x oh image; M takes output coordinates to source coordinates. White outside.
  function warp(img, M, ow, oh) {
    const { data, w, h } = img, out = new Uint8ClampedArray(ow * oh * 4).fill(255);
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
      const d = M[6] * x + M[7] * y + M[8], sx = (M[0] * x + M[1] * y + M[2]) / d, sy = (M[3] * x + M[4] * y + M[5]) / d;
      if (!(sx >= 0 && sy >= 0 && sx <= w - 1 && sy <= h - 1)) continue;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = sx - x0, fy = sy - y0, o = (y * ow + x) * 4;
      for (let k = 0; k < 4; k++) {
        const a = data[(y0 * w + x0) * 4 + k], b = data[(y0 * w + x1) * 4 + k], c = data[(y1 * w + x0) * 4 + k], e = data[(y1 * w + x1) * 4 + k];
        out[o + k] = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
      }
    }
    return { data: out, w: ow, h: oh };
  }

  // ---------- bands (rules 4-9) ----------
  const len = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  function convex(quad) { let s = 0; for (let i = 0; i < 4; i++) { const a = quad[i], b = quad[(i + 1) % 4], c = quad[(i + 2) % 4], z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]); if (!z) return false; if (!s) s = Math.sign(z); else if (Math.sign(z) !== s) return false; } return true; }

  // Rule 4: the homography that makes the table a rectangle. Two images come from it: the one the rules are found in (the table with a small margin,
  // aImage / aH) and the page copy (the whole corrected photo within K.SHEET_X / K.SHEET_Y table sizes of the table, so a strong keystone
  // cannot blow it up, at most K.COPY_MAX px on the long side; content outside the table, such as a map above the headings or notes below it,
  // is kept). conv takes pixels of the first to pixels of the copy (an offset and a scale).
  function rectify(img, quad) {
    const wt = (len(quad[0], quad[1]) + len(quad[3], quad[2])) / 2, ht = (len(quad[0], quad[3]) + len(quad[1], quad[2])) / 2;
    if (!(wt > 0.15 * img.w && ht > 0.15 * img.h) || !convex(quad)) return null;
    const H0 = homography(quad, [[0, 0], [wt, 0], [wt, ht], [0, ht]]);
    const frame = (x0, y0, x1, y1) => {                                              // the corrected photo cropped to this window, at most K.COPY_MAX px
      const s = Math.min(1, K.COPY_MAX / Math.max(x1 - x0, y1 - y0)), H = mulH([s, 0, -x0 * s, 0, s, -y0 * s, 0, 0, 1], H0);
      return { H, image: warp(img, invH(H), Math.round((x1 - x0) * s), Math.round((y1 - y0) * s)) };
    };
    const mx = K.MARGIN_X * wt, my = K.MARGIN_Y * ht, a = frame(-mx, -my, wt + mx, ht + my);
    let x0 = -K.SHEET_X * wt, x1 = wt + K.SHEET_X * wt, y0 = -K.SHEET_Y * ht, y1 = ht + K.SHEET_Y * ht;
    const cs = [[0, 0], [img.w - 1, 0], [img.w - 1, img.h - 1], [0, img.h - 1]];
    if (cs.every(c => H0[6] * c[0] + H0[7] * c[1] + H0[8] > 1e-6)) {               // all four corners in front of the camera: crop to the photo
      const w = cs.map(c => applyH(H0, c[0], c[1]));
      x0 = Math.max(x0, Math.min(...w.map(p => p[0]))); x1 = Math.min(x1, Math.max(...w.map(p => p[0])));
      y0 = Math.max(y0, Math.min(...w.map(p => p[1]))); y1 = Math.min(y1, Math.max(...w.map(p => p[1])));
    }
    const c = frame(Math.min(x0, -mx), Math.min(y0, -my), Math.max(x1, wt + mx), Math.max(y1, ht + my));   // the analysed window is always inside
    const conv = mulH(c.H, invH(a.H));
    return { aH: a.H, aImage: a.image, H: c.H, image: c.image, conv: { sx: conv[0], sy: conv[4], tx: conv[2], ty: conv[5] } };
  }

  // Which band (index k: between row rules k and k+1) holds the vertical position yy; -1 for none. edges[k] is the
  // bottom of rule k, tops[k] the top of rule k.
  function bandAt(edges, tops, yy) { for (let k = 0; k < edges.length - 1; k++) if (yy >= edges[k] && yy < tops[k + 1]) return k; return -1; }

  // Page-level reading. img: the image as sent to the reader (after the pre-pass turn). rows: [{row, y, tags}] as the
  // reader returned them (row, y optional). opt.rotation: the reader's clockwise degrees to upright (0, 90, 180, 270).
  // Returns {image, H, turns, ok, pageCheck, rows: [{band, boxes}]}. image is the page copy; H takes the (turned)
  // sent image's pixel coordinates to the copy's (null when no table was found, and the copy is the turned image).
  function analyzePage(img, rows, opt) {
    opt = opt || {};
    let rot = opt.rotation; if (![0, 90, 180, 270].includes(rot)) rot = 0;
    const turns = rot / 90, rowOnly = rot === 90 || rot === 270;
    const sent = rotateImg(img, turns);
    const R1 = rulesOf(sent), G1 = gridOf(R1);
    let image = sent, aimage = sent, H = null, aH = null, conv = null, R = R1, G = G1, xcSent = G1.xc;
    if (G1.ok) {
      const rect = rectify(sent, G1.quad);
      if (rect) {
        xcSent = (G1.quad[0][0] + G1.quad[1][0] + G1.quad[2][0] + G1.quad[3][0]) / 4;
        const R2 = rulesOf(rect.aImage), G2 = gridOf(R2);
        image = rect.image; H = rect.H; aimage = rect.aImage; aH = rect.aH; conv = rect.conv; R = R2; G = G2;
      }
    }
    const { w, h } = aimage, yMap = y => aH ? applyH(aH, xcSent, y * sent.h)[1] / h : y;
    const items = rows.map(r => {
      const okRow = Number.isInteger(r.row) && r.row > 0;
      let y = r.y, okY = !rowOnly && typeof y === 'number' && isFinite(y) && y >= 0 && y <= 1;
      if (okY) { if (rot === 180) y = 1 - y; y = yMap(y); }
      return { okRow, okY, y, row: r.row, tags: r.tags | 0 };
    });
    const useRules = G.ok && G.head != null && G.H.length >= 3;
    const xc = G.xc, ys = useRules ? G.H.map(c => ev(c, xc)) : [], hth = useRules ? G.H.map(c => c.th) : [];
    const edge = (k0, k1) => {
      const V = G.V, n = V.length;
      if (n >= 3) { const m = Math.min(h, Math.max(0, (k0 + k1) / 2));   /* a band above or below the window takes the edge at its nearest end */ return [ev(V[n - 3], m) + V[n - 3].th / 2, ev(V[n - 1], m) - V[n - 1].th / 2]; }
      return [0.41 * w, 0.95 * w];
    };
    // rule 7: the headings offset that puts the most rows' y inside their own band
    let head = useRules ? G.head : null, pageCheck = false;
    if (useRules) {
      const edges = ys.map((v, k) => v + hth[k] / 2), tops = ys.map((v, k) => v - hth[k] / 2);
      const score = hd => items.reduce((n, it) => { if (!it.okRow || !it.okY) return n; const k = hd + it.row; return n + (k >= 0 && k <= ys.length - 2 && it.y * h >= edges[k] && it.y * h < tops[k + 1] ? 1 : 0); }, 0);
      const s0 = score(head);
      let best = head, bs = s0;
      for (let hd = -(ys.length - 2); hd <= ys.length - 2; hd++) { const s = score(hd); if (s > bs) { bs = s; best = hd; } }   // below zero: rows above the first rule found
      if (best !== head && bs >= K.PAGE_MIN_ROWS) { head = best; pageCheck = true; }
    }
    // rule 9: a page is sound when (a) the cross-check did not move the headings, (b) more than K.SOUND_MAJORITY of the rows with a usable y
    // (valid, inside the page copy) have that y inside their own row's band (a y in no band disagrees; rows with no usable y are left out),
    // and (c) every row has a row that names a band (a rule missing low leaves the last row's row naming no band). On a sound page a row whose y
    // falls in another band keeps its row band, flagged; on a page in doubt y decides.
    let sound = false;
    if (useRules && !pageCheck) {
      const edges = ys.map((v, k) => v + hth[k] / 2), tops = ys.map((v, k) => v - hth[k] / 2);
      const rowBandOf = it => it.okRow && head + it.row >= 0 && head + it.row <= ys.length - 2 ? head + it.row : -1;
      const inCopy = it => { const v = conv ? (it.y * h * conv.sy + conv.ty) / image.h : it.y; return v >= 0 && v <= 1; };
      const usable = items.filter(it => it.okY && inCopy(it));
      const agree = usable.filter(it => { const rb = rowBandOf(it); return rb >= 0 && bandAt(edges, tops, it.y * h) === rb; }).length;
      sound = usable.length > 0 && agree / usable.length > K.SOUND_MAJORITY && items.every(it => rowBandOf(it) >= 0);
    }
    // rule 8: rows whose y fall in the same band are all flagged (a missing rule merges two rows into one band; the first row's row and y still agree)
    const yb = items.map(it => { if (!useRules || !it.okY) return -1; const b = bandAt(ys.map((v, k) => v + hth[k] / 2), ys.map((v, k) => v - hth[k] / 2), it.y * h); return b > head ? b : -1; });
    const shared = yb.map(b => b >= 0 && yb.filter(x => x === b).length >= 2);
    const out = items.map((it, idx) => {
      const o = { band: null, boxes: [], k: -1 };
      const mk = (top, bottom, src, check, k) => {
        const [l, r] = edge(top, bottom);
        if (!(bottom > top && r > l)) return;
        o.band = { top: top / h, bottom: bottom / h, left: l / w, right: r / w, src };      // unclipped: a fallback band may reach past the window; conv1 clips it to the copy
        if (check || pageCheck || shared[idx]) o.band.check = true;
        if (pageCheck) o.band.pageCheck = true;
        o.k = k;
      };
      if (useRules) {
        const edges = ys.map((v, k) => v + hth[k] / 2), tops = ys.map((v, k) => v - hth[k] / 2);
        const rowBand = it.okRow && head + it.row >= 0 && head + it.row <= ys.length - 2 ? head + it.row : -1;
        let yBand = it.okY ? bandAt(edges, tops, it.y * h) : -1;
        if (yBand <= head) yBand = -1;                                 // headings and above are not rows
        if (yBand >= 0) {
          const differs = it.okRow && rowBand >= 0 && rowBand !== yBand, k = differs && sound ? rowBand : yBand;   // rule 9: a sound page keeps the row band
          mk(edges[k], tops[k + 1], differs && !sound ? 'y' : 'rules', it.okRow && rowBand !== yBand, k); return o;
        }
        if (rowBand >= 0) { mk(edges[rowBand], tops[rowBand + 1], rowOnly ? 'row' : it.okY ? 'rules' : 'row', rowOnly || it.okY, rowBand); return o; }
      }
      if (it.okY) { const m = K.FALLBACK * h; mk(it.y * h - m, it.y * h + m, 'fallback', true, -1); }   // may reach past the analysed window; the copy's edge clips it below
      return o;
    });
    // rules 10-13: sign graphics, only in rows whose instruction has tags and a ruled band
    if (useRules) {
      const specs = out.map((o, i) => ({ k: o.k, tags: items[i].tags }));
      const boxes = signBoxes(R, G, specs, head);
      out.forEach((o, i) => { o.boxes = boxes[i]; });
    }
    // bands and graphics were found in the analysed window; they are reported as fractions of the page copy
    // (clipped to the copy; a band with nothing left inside the copy is none)
    const fx = v => q4(conv ? (v * w * conv.sx + conv.tx) / image.w : v), fy = v => q4(conv ? (v * h * conv.sy + conv.ty) / image.h : v);   // q4 clips to 0-1
    const conv1 = o => ({ band: o.band && (b => b.bottom > b.top && b.right > b.left ? b : null)({ ...o.band, top: fy(o.band.top), bottom: fy(o.band.bottom), left: fx(o.band.left), right: fx(o.band.right) }),
      boxes: o.boxes.map(b => ({ left: fx(b.left), top: fy(b.top), right: fx(b.right), bottom: fy(b.bottom) })) });
    return { image, H, turns, ok: useRules, pageCheck, rowCount: useRules ? Math.max(0, ys.length - 2 - head) : 0, rows: out.map(conv1) };
  }

  // ---------- sign graphics (rules 10-13) ----------
  // Connected pieces of ink in a cell, after joining letters sideways (not between lines). Boxes are absolute pixels.
  function pieces(bin, w, x0, y0, x1, y1) {
    const cw = x1 - x0, ch = y1 - y0, tmp = new Uint8Array(cw * ch), m = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) {                                       // sideways: ink within K.JOIN_W either side
      let last = -1e9;
      for (let x = 0; x < cw; x++) { if (bin[(y0 + y) * w + x0 + x]) last = x; if (x - last <= K.JOIN_W) tmp[y * cw + x] = 1; }
      last = 1e9;
      for (let x = cw - 1; x >= 0; x--) { if (bin[(y0 + y) * w + x0 + x]) last = x; if (last - x <= K.JOIN_W) tmp[y * cw + x] = 1; }
    }
    for (let x = 0; x < cw; x++) for (let y = 0; y < ch; y++) if (tmp[y * cw + x]) for (let d = -K.JOIN_H; d <= K.JOIN_H; d++) { const yy = y + d; if (yy >= 0 && yy < ch) m[yy * cw + x] = 1; }
    const out = [], stack = [];
    for (let i = 0; i < cw * ch; i++) {
      if (m[i] !== 1) continue;
      let minx = cw, miny = ch, maxx = 0, maxy = 0, area = 0; m[i] = 2; stack.push(i);
      while (stack.length) {
        const p = stack.pop(), px = p % cw, py = (p / cw) | 0; area++;
        if (px < minx) minx = px; if (px > maxx) maxx = px; if (py < miny) miny = py; if (py > maxy) maxy = py;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy; if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
          const n = ny * cw + nx; if (m[n] === 1) { m[n] = 2; stack.push(n); }
        }
      }
      out.push({ x0: x0 + minx, y0: y0 + miny, x1: x0 + maxx + 1, y1: y0 + maxy + 1, area });
    }
    return out;
  }

  // specs: per row {k: band index or -1, tags}. Returns, per row, boxes {left, top, right, bottom} (fractions of the copy),
  // ordered top to bottom then left to right. A row without tags, or without a band, gets none.
  function signBoxes(R, G, specs, head) {
    const { w, h, bin } = R, V = G.V, n = V.length, none = specs.map(() => []);
    if (n < 3) return none;                                            // rule 10: the Instruction cell is found from the right edge (as the band is), so only 3 column rules are needed, not a fixed count
    const sc = w / 1500, mx = Math.round(K.CELL_MX * sc), my = Math.round(K.CELL_MY * sc), gap = Math.max(2, Math.round(K.MERGE_GAP * sc)), xc = G.xc;
    const L = V[n - 3], Rr = V[n - 2], cells = new Map(), heights = [];
    const cellOf = k => {
      if (cells.has(k)) return cells.get(k);
      const yt = ev(G.H[k], xc) + G.H[k].th / 2, yb = ev(G.H[k + 1], xc) - G.H[k + 1].th / 2;
      const x0 = Math.max(0, Math.ceil(Math.max(ev(L, yt), ev(L, yb)) + L.th / 2) + mx), x1 = Math.min(w, Math.floor(Math.min(ev(Rr, yt), ev(Rr, yb)) - Rr.th / 2) - mx);
      const y0 = Math.max(0, Math.ceil(yt) + my), y1 = Math.min(h, Math.floor(yb) - my);
      const c = x1 - x0 >= 10 && y1 - y0 >= 10 ? pieces(bin, w, x0, y0, x1, y1) : [];
      cells.set(k, c); return c;
    };
    for (let k = Math.max(0, head + 1); k < G.H.length - 1; k++) for (const p of cellOf(k)) if (p.area > K.MIN_AREA && p.x1 - p.x0 >= K.LINE_ASPECT * (p.y1 - p.y0)) heights.push([p.y1 - p.y0, p.x1 - p.x0]);   // rule 11: once per page, from lines of text
    const th = heights.length ? textHeight(heights) : 18 * sc;
    return specs.map(sp => {
      if (!sp.tags || sp.k < 0) return [];
      let bx = cellOf(sp.k).filter(p => p.y1 - p.y0 > K.TALL * th && p.x1 - p.x0 > K.WIDE * th).map(p => ({ x0: p.x0, y0: p.y0, x1: p.x1, y1: p.y1 }));
      for (let moved = true; moved;) {                                   // boxes that touch or nearly touch merge
        moved = false;
        for (let i = 0; i < bx.length && !moved; i++) for (let j = i + 1; j < bx.length && !moved; j++) {
          const a = bx[i], b = bx[j];
          if (a.x0 - gap < b.x1 && b.x0 - gap < a.x1 && a.y0 - gap < b.y1 && b.y0 - gap < a.y1) {
            bx[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) }; bx.splice(j, 1); moved = true;
          }
        }
      }
      bx.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
      bx = bx.slice(0, sp.tags);
      bx.sort((a, b) => a.y0 - b.y0);                                    // lines top to bottom, left to right within a line
      const lines = [];
      for (const b of bx) { const ln = lines.find(l => Math.min(l.y1, b.y1) - Math.max(l.y0, b.y0) > 0.5 * Math.min(l.y1 - l.y0, b.y1 - b.y0)); if (ln) { ln.items.push(b); ln.y0 = Math.min(ln.y0, b.y0); ln.y1 = Math.max(ln.y1, b.y1); } else lines.push({ y0: b.y0, y1: b.y1, items: [b] }); }
      return lines.flatMap(l => l.items.sort((a, b) => a.x0 - b.x0)).map(b => ({ left: q4(b.x0 / w), top: q4(b.y0 / h), right: q4(b.x1 / w), bottom: q4(b.y1 / h) }));
    });
  }

  const Vision = { K, joinStrokes, toGray, binarize, rulesOf, gridOf, needsTurn, analyzePage, rotateImg, rotMatrix, warp, homography, applyH, invH, mulH };
  if (typeof module !== 'undefined' && module.exports) module.exports = Vision; else root.Vision = Vision;
})(typeof window !== 'undefined' ? window : globalThis);
