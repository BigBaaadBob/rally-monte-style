// Synthetic ruled page for the vision tests: drawn from invented content (no scans), then photographed with
// perspective, slant, shadow, background, blur, and compression. Expected values come from the geometry drawn here.
'use strict';
const Vision = require('../src/vision.js');

const origin = new WeakMap();
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// The page, drawn flat. Returns {g, PW, PH, T} where T describes the table the test drew.
function drawPage(o = {}) {
  const PW = 1000, PH = 1650, g = new Uint8Array(PW * PH).fill(255), rnd = rng(o.seed || 7);
  const rect = (x, y, w, h, v) => { for (let j = Math.max(0, y); j < Math.min(PH, y + h); j++) for (let i = Math.max(0, x); i < Math.min(PW, x + w); i++) g[j * PW + i] = v; };
  const box = (x, y, w, h, t, v) => { rect(x, y, w, t, v); rect(x, y + h - t, w, t, v); rect(x, y, t, h, v); rect(x + w - t, y, t, h, v); };
  const seg = (x0, y0, x1, y1, t, v) => { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)); for (let i = 0; i <= n; i++) rect(Math.round(x0 + (x1 - x0) * i / n - t / 2), Math.round(y0 + (y1 - y0) * i / n - t / 2), t, t, v); };
  const T = 3;                                                      // rule thickness
  const vx = o.vx || [60, 110, 170, 240, 300, 360, 700, 940];       // 8 column rules: Instruction is 360-700
  const top = o.top || 220;
  let heights = o.heights || [50, 90, 300, 60, 160, 75, 170, 30, 200, 100, 120];   // headings, then rows (about 10:1)
  if (o.decoy) heights = [o.decoy, ...heights];                     // a band above the headings that the column rules also cross
  const rules = [top]; for (const hh of heights) rules.push(rules[rules.length - 1] + hh);
  const bottom = rules[rules.length - 1];
  rules.forEach((r, i) => { if (i !== o.dropRule) rect(vx[0], r, vx[vx.length - 1] - vx[0] + T, T, 0); });   // dropRule: a rule the photo lost
  for (const x of vx) rect(x, top, T, bottom - top + T, 0);
  // letters in every cell; the Instruction cell gets 1-3 lines of text (text height 14)
  const letters = (x0, y0, wmax, v) => { let x = x0; while (x + 7 < x0 + wmax) { rect(x, y0, 7, 14, v); x += 11 + (rnd() < 0.15 ? 8 : 0); } };
  const truth = { rows: [], signs: [] };
  for (let k = o.decoy ? 2 : 1; k < heights.length; k++) {
    const y0 = rules[k] + T, y1 = rules[k + 1];
    truth.rows.push({ top: y0, bottom: y1 });
    for (let c = 0; c < vx.length - 1; c++) {
      if (c === 5) continue;
      letters(vx[c] + 10, y0 + 12, Math.min(60, vx[c + 1] - vx[c] - 20), 0);
    }
    const ri = truth.rows.length, lines = o.lines ? o.lines[ri - 1] : 1 + (k % 3);
    for (let l = 0; l < lines && y0 + 12 + l * 26 + 14 < y1 - 6; l++) letters(vx[5] + 12, y0 + 12 + l * 26, (vx[6] - vx[5]) * (0.5 + 0.4 * rnd()), 0);
  }
  // signs: {row (1-based), kind, dx, dy}: placed in the Instruction cell below the text
  for (const s of o.signs || []) {
    const r = truth.rows[s.row - 1], x = vx[5] + 20 + (s.dx || 0), y = Math.min(r.top + 12 + (s.dy == null ? 40 : s.dy), r.bottom - 8 - 90);
    let bb;
    if (s.kind === 'diamond') {                                     // a diamond with a plaque touching it
      const cx = x + 40, cy = y + 30;
      seg(cx, cy - 30, cx + 30, cy, 4, 0); seg(cx + 30, cy, cx, cy + 30, 4, 0); seg(cx, cy + 30, cx - 30, cy, 4, 0); seg(cx - 30, cy, cx, cy - 30, 4, 0);
      rect(cx - 25, cy + 32, 50, 22, 0); for (let i = 0; i < 4; i++) rect(cx - 20 + i * 11, cy + 36, 7, 14, 255);
      bb = [cx - 32, cy - 32, cx + 32, cy + 54];
    } else if (s.kind === 'rect') {                                 // a bordered white rectangle with text inside
      box(x, y, 90, 56, 3, 0); letters(x + 10, y + 12, 70, 0); letters(x + 10, y + 32, 50, 0);
      bb = [x, y, x + 90, y + 56];
    } else if (s.kind === 'badge') {                                // an outlined badge with tiny separate lettering inside (it must not set the text height)
      box(x, y, 90, 70, 3, 0);
      for (let i = 0; i < 6; i++) rect(x + 24, y + 10 + i * 9, 42, 3, 0);
      bb = [x, y, x + 90, y + 70];
    } else {                                                        // photo-like: noisy block
      for (let j = 0; j < 64; j += 2) for (let i = 0; i < 96; i += 2) rect(x + i, y + j, 2, 2, 30 + Math.floor(rnd() * 190));
      bb = [x, y, x + 96, y + 64];
    }
    truth.signs.push({ row: s.row, box: bb });
  }
  if (o.map) { box(vx[0] + 100, 60, 600, 120, 3, 0); for (let i = 0; i < 8; i++) seg(vx[0] + 120 + i * 70, 70 + (i % 3) * 20, vx[0] + 160 + i * 70, 170 - (i % 2) * 30, 3, 0); }   // a ruled map box above the table
  if (o.cut) rect(0, 0, PW, o.cut, 255);                             // the photo is cut off above this: no headings, no first rows
  if (o.streak) rect(o.streak, 0, 3, PH, 190);                       // a faint full-height scanner streak
  return { g, PW, PH, T: { vx, rules, top, bottom, thick: T }, truth };
}

// Photograph the page: page -> photo by the matrix M (page coordinates to photo coordinates), then shadow, blur, noise.
function photograph(page, o = {}) {
  const { g, PW, PH } = page, W = o.W || 1400, H = o.H || 1900, rnd = rng(11);
  const slant = (o.slant || 0) * Math.PI / 180, key = o.key || 0;       // key: top edge this fraction narrower than the bottom
  const cx = PW / 2, cy = PH / 2, c = Math.cos(slant), s = Math.sin(slant);
  const M = [c, -s, 0, s, c, 0, 0, 0, 1];
  // page centred coordinates -> perspective -> rotate -> place
  const toC = [1, 0, -cx, 0, 1, -cy, 0, 0, 1], persp = [1, 0, 0, 0, 1, 0, 0, key / PH, 1], place = [1, 0, W / 2 + (o.dx || 0), 0, 1, H / 2 + (o.dy || 0), 0, 0, 1];
  const F = Vision.mulH(place, Vision.mulH(M, Vision.mulH(persp, toC)));   // page -> photo
  const inv = Vision.invH(F);
  const out = new Float32Array(W * H), bg = o.bg == null ? 70 : o.bg;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = inv[6] * x + inv[7] * y + inv[8], px = (inv[0] * x + inv[1] * y + inv[2]) / d, py = (inv[3] * x + inv[4] * y + inv[5]) / d;
    let v = bg;
    if (px >= 0 && py >= 0 && px < PW - 1 && py < PH - 1) {
      const x0 = Math.floor(px), y0 = Math.floor(py), fx = px - x0, fy = py - y0;
      v = (g[y0 * PW + x0] * (1 - fx) + g[y0 * PW + x0 + 1] * fx) * (1 - fy) + (g[(y0 + 1) * PW + x0] * (1 - fx) + g[(y0 + 1) * PW + x0 + 1] * fx) * fy;
      v = 255 - (255 - v) * 0.85;                                       // inked paper is never pure black
    }
    out[y * W + x] = v;
  }
  if (o.shadow) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + x] *= 1 - o.shadow * (x / W) * (0.6 + 0.4 * (y / H));
  for (let r = 0; r < (o.blur || 0); r++) {                              // box blur, radius 1, repeated
    const t = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0, n = 0; for (let i = -1; i <= 1; i++) { const xx = x + i; if (xx >= 0 && xx < W) { a += out[y * W + xx]; n++; } } t[y * W + x] = a / n; }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let a = 0, n = 0; for (let i = -1; i <= 1; i++) { const yy = y + i; if (yy >= 0 && yy < H) { a += t[yy * W + x]; n++; } } out[y * W + x] = a / n; }
  }
  const img = { data: new Uint8ClampedArray(W * H * 4), w: W, h: H };
  for (let i = 0; i < W * H; i++) {
    let v = out[i] + (o.noise ? (rnd() - 0.5) * 2 * o.noise : 0);
    if (o.jpeg) v = Math.round(v / o.jpeg) * o.jpeg;                     // blocky quantisation, like compression
    v = Math.max(0, Math.min(255, v));
    img.data[i * 4] = v; img.data[i * 4 + 1] = v * 0.97; img.data[i * 4 + 2] = v * 0.93; img.data[i * 4 + 3] = 255;
  }
  const to = (x, y) => Vision.applyH(F, x, y);
  const ph = { img, F, to }; origin.set(img, { ph, pre: 0 });
  return ph;
}

// Reader-style input for the page: the row's number and its vertical centre on the photographed image.
function readerRows(page, ph, tagsOf) {
  const xc = (page.T.vx[0] + page.T.vx[page.T.vx.length - 1]) / 2;
  return page.truth.rows.map((r, i) => ({ row: i + 1, y: ph.to(xc, (r.top + r.bottom) / 2)[1] / ph.img.h, tags: tagsOf ? tagsOf(i + 1) : 0 }));
}

// Which photograph an image came from, and how it was turned since (clockwise quarter turns), so a page coordinate can be followed to the copy.
function turned(ph, n) { const im = Vision.rotateImg(ph.img, n); origin.set(im, { ph, pre: n }); return im; }
// Analyse and attach res.cf(px, py): where a page point (the geometry drawn) lands in the page copy, as fractions of the copy.
function analyze(img, rows, opt) {
  const res = Vision.analyzePage(img, rows, opt), o = origin.get(img);
  if (o) {
    const w = o.ph.img.w, h = o.ph.img.h, sw = o.pre % 2 ? h : w, sh = o.pre % 2 ? w : h;
    let M = Vision.mulH(Vision.rotMatrix(w, h, o.pre), o.ph.F);
    M = Vision.mulH(Vision.rotMatrix(sw, sh, res.turns), M);
    if (res.H) M = Vision.mulH(res.H, M);
    res.cf = (px, py) => { const [x, y] = Vision.applyH(M, px, py); return { x: x / res.image.w, y: y / res.image.h }; };
  }
  return res;
}

module.exports = { drawPage, photograph, readerRows, analyze, turned, rng };
