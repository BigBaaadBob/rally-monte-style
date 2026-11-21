// Unit tests for src/vision.js (DESIGN § Testing): band finding and sign graphics, on a synthetic ruled page that
// test/synth.js draws from invented content, then "photographs" with perspective, slant, shadow, a dark background,
// blur, and compression. Expected values come from the geometry drawn there, never from current output.
const assert = require('assert');
const Vision = require('../src/vision.js');
const { drawPage, photograph, readerRows, analyze, turned } = require('./synth.js');

let checks = 0;
const ok = (c, m) => { checks++; assert.ok(c, m); };
const near = (a, b, tol, m) => ok(a != null && Math.abs(a - b) <= tol, `${m}: got ${a}, want ${b}±${tol}`);

// ---- geometry helpers ----
{ const src = [[0, 0], [10, 0], [10, 20], [0, 20]], dst = [[5, 5], [105, 8], [95, 130], [2, 120]];
  const H = Vision.homography(src, dst);
  src.forEach((p, i) => { const q = Vision.applyH(H, p[0], p[1]); near(q[0], dst[i][0], 1e-6, 'homography x'); near(q[1], dst[i][1], 1e-6, 'homography y'); });
  const back = Vision.applyH(Vision.invH(H), 105, 8); near(back[0], 10, 1e-6, 'inverse x'); near(back[1], 0, 1e-6, 'inverse y');
  const I = Vision.mulH(H, Vision.invH(H)); near(I[0], 1, 1e-9, 'H·H⁻¹'); near(I[4], 1, 1e-9, 'H·H⁻¹'); near(I[1], 0, 1e-9, 'H·H⁻¹'); }
{ const w = 5, h = 3, data = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < w * h; i++) { data[i * 4] = i; data[i * 4 + 3] = 255; }
  const img = { data, w, h };
  for (const t of [1, 2, 3]) {                                         // the matrix agrees with the pixels, whichever way the image is turned
    const r = Vision.rotateImg(img, t), M = Vision.rotMatrix(w, h, t);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [nx, ny] = Vision.applyH(M, x, y); ok(r.data[(ny * r.w + nx) * 4] === y * w + x, `rotation ${t} at ${x},${y}`); }
  }
  ok(Vision.rotateImg(img, 1).w === h && Vision.rotateImg(img, 2).w === w, 'quarter turns swap the sides'); }

// ---- following strokes: pieces of one rule are joined, a stroke alongside is not ----
{ const line = (t0, t1, u0, slope) => { const T = [], U = []; for (let t = t0; t <= t1; t++) { T.push(t); U.push(u0 + slope * (t - t0)); } return { T, U, th: 3 }; };
  let out = Vision.joinStrokes([line(0, 400, 70, -0.03), line(410, 900, 70 - 0.03 * 410, -0.03)], 200);
  ok(out.length === 1 && out[0].T[out[0].T.length - 1] === 900, 'a rule broken at a crossing is one rule');
  out = Vision.joinStrokes([line(0, 400, 70, -0.03), line(430, 900, 70 - 0.03 * 430 + 12, -0.03)], 200);
  ok(out.length === 2, 'pieces that do not line up are not joined');
  out = Vision.joinStrokes([line(0, 1000, 70, -0.03), line(118, 200, 70 - 0.03 * 1000 + 0.03 * 882 + 0, -0.03)], 200);
  ok(out.length === 2, 'a stroke that starts alongside a rule, and happens to be in line with its extension backwards, is not joined to it');
  out = Vision.joinStrokes([line(0, 400, 70, 0), line(410, 900, 100, 0)], 200);
  ok(out.length === 2, 'a jump of 30 px is not a rule'); }

// ---- the page and its photographs ----
const TAG_ROWS = [2, 4, 6, 8];
const SIGNS = [{ row: 2, kind: 'diamond' }, { row: 4, kind: 'rect' }, { row: 6, kind: 'photo' }, { row: 8, kind: 'diamond' }];
const pageOpts = { map: true, streak: 90, lines: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1], signs: SIGNS };
const iou = (a, b) => { const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (w <= 0 || h <= 0) return 0; const i = w * h; return i / ((a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - i); };
const trueBox = (res, s) => { const a = res.cf(s.box[0], s.box[1]), b = res.cf(s.box[2], s.box[3]); return { left: a.x, top: a.y, right: b.x, bottom: b.y }; };

// every band holds its own row, within a few pixels of the rules drawn
function checkBands(page, res, name, flagsOK) {
  page.truth.rows.forEach((r, i) => {
    const b = res.rows[i].band, a = res.cf(0, r.top).y, z = res.cf(0, r.bottom).y;
    ok(b, `${name}: row ${i + 1} has a band`);
    near(b.top, a, 0.004, `${name}: row ${i + 1} top`); near(b.bottom, z, 0.004, `${name}: row ${i + 1} bottom`);
    if (!flagsOK) { ok(!b.check, `${name}: row ${i + 1} is not flagged`); ok(b.src === 'rules', `${name}: row ${i + 1} src`); }
  });
}
function checkSigns(page, res, name) {
  for (const s of page.truth.signs) {
    const found = res.rows[s.row - 1].boxes;
    ok(found.length === 1, `${name}: row ${s.row} has one graphic, got ${found.length}`);
    ok(iou(found[0], trueBox(res, s)) > 0.55, `${name}: row ${s.row} graphic matches the one drawn (iou ${iou(found[0], trueBox(res, s)).toFixed(2)})`);
  }
  page.truth.rows.forEach((r, i) => { if (!TAG_ROWS.includes(i + 1)) ok(res.rows[i].boxes.length === 0, `${name}: untagged row ${i + 1} gets none`); });
}

const variants = {
  'flat page': {}, 'slant +3°': { slant: 3 }, 'slant -3°': { slant: -3 }, 'keystone 10%': { key: 0.1 }, 'keystone -10%': { key: -0.1 },
  'shadow': { shadow: 0.45 }, 'dark background': { bg: 40 }, 'light background': { bg: 245 }, 'blur': { blur: 2 }, 'compression': { noise: 6, jpeg: 10 },
  'all together': { slant: 3, key: 0.1, shadow: 0.4, bg: 50, blur: 1, noise: 5, jpeg: 8 },
};
const page = drawPage(pageOpts);
for (const [name, o] of Object.entries(variants)) {
  const ph = photograph(page, o), rows = readerRows(page, ph, i => TAG_ROWS.includes(i) ? 1 : 0), res = analyze(ph.img, rows, {});
  ok(res.ok, name + ': a table is found'); ok(!res.pageCheck, name + ': no page flag');
  checkBands(page, res, name); checkSigns(page, res, name);
  ok(res.image.w <= 2000 && res.image.h <= 2000, name + ': the page copy is at most 2,000 px');
  ok(res.image.h > res.image.w, name + ': the page copy is portrait');
  { const T = page.T, c = (x, y) => res.cf(x, y), tl = c(T.vx[0], T.top), tr = c(T.vx[7], T.top), bl = c(T.vx[0], T.bottom), br = c(T.vx[7], T.bottom);
    near(tl.x, bl.x, 0.004, name + ': the table is a rectangle (left edge)'); near(tr.x, br.x, 0.004, name + ': the table is a rectangle (right edge)');
    near(tl.y, tr.y, 0.004, name + ': the table is a rectangle (top edge)'); near(bl.y, br.y, 0.004, name + ': the table is a rectangle (bottom edge)');
    const m = c(T.vx[0] + 100, 60), n = c(T.vx[3], 1600);                // the map above the headings and the foot of the sheet are kept
    ok(m.y > 0 && m.y < tl.y && m.x > 0 && m.x < 1, name + ': the map above the table is inside the page copy');
    ok(n.y > bl.y && n.y < 1 && n.x > 0 && n.x < 1, name + ': the sheet below the table is inside the page copy'); }
  for (const r of res.rows) for (const k of ['top', 'bottom', 'left', 'right']) { ok(r.band[k] >= 0 && r.band[k] <= 1 && r.band[k] === Math.round(r.band[k] * 1e4) / 1e4, name + ': ' + k + ' is a fraction with four decimals'); }
}
{ // the band covers the Instruction and Info columns: from the Instruction column's left rule to the table's right edge
  const ph = photograph(page, {}), res = analyze(ph.img, readerRows(page, ph), {});
  const l = res.cf(page.T.vx[5], 0).x, r = res.cf(page.T.vx[7], 0).x;
  near(res.rows[0].band.left, l, 0.006, 'band left'); near(res.rows[0].band.right, r, 0.006, 'band right'); }
{ // row heights vary about 10:1 and every band is still its own
  const hs = page.truth.rows.map(r => r.bottom - r.top); ok(Math.max(...hs) / Math.min(...hs) >= 9, 'heights vary about 10:1'); }

// ---- orientation (rules 1-2) ----
{ const ph = photograph(page, { slant: 2, key: 0.05 }), sideways = turned(ph, 1);
  ok(Vision.needsTurn(ph.img) === 0, 'an upright page is left alone');
  ok(Vision.needsTurn(sideways) === 1, 'a page shot sideways is turned');
  ok(Vision.needsTurn(Vision.rotateImg(ph.img, 3)) === 1, 'sideways the other way is turned too');
  const again = Vision.rotateImg(sideways, 1);                          // after the pre-pass the page is upside down at worst
  ok(Vision.needsTurn(again) === 0, 'a turned page is not turned again');
  // upside down: the reader says 180 and measures y on the image as sent
  const up = turned(ph, 2), rows = readerRows(page, ph, i => TAG_ROWS.includes(i) ? 1 : 0).map(r => ({ ...r, y: 1 - r.y }));
  const res = analyze(up, rows, { rotation: 180 });
  checkBands(page, res, 'upside down'); checkSigns(page, res, 'upside down'); ok(res.turns === 2, 'turned 180');
  // the pre-pass missed: the page arrives sideways, the reader says 270 (clockwise degrees to upright), y is ignored
  const side = turned(ph, 1), srows = readerRows(page, ph, i => TAG_ROWS.includes(i) ? 1 : 0).map(r => ({ ...r, y: 0.5 }));
  const rs = analyze(side, srows, { rotation: 270 });
  page.truth.rows.forEach((r, i) => {
    const b = rs.rows[i].band; ok(b, `sideways: row ${i + 1} has a band`);
    near(b.top, rs.cf(0, r.top).y, 0.004, `sideways: row ${i + 1} top`);
    ok(b.src === 'row' && b.check === true, `sideways: row ${i + 1} is built from row alone and flagged`);
  });
  const r90 = analyze(turned(ph, 3), srows, { rotation: 90 }); ok(r90.rows.every(r => r.band && r.band.src === 'row' && r.band.check), 'rotation 90 is handled like 270');
  // missing or invalid rotation means 0
  for (const bad of [undefined, null, 45, '180', 361, NaN]) { const r = analyze(ph.img, readerRows(page, ph), { rotation: bad }); ok(r.turns === 0 && r.rows[0].band.src === 'rules', 'invalid rotation ' + bad + ' is 0'); } }

// ---- flags and src (rules 7-9) ----
{ const ph = photograph(page, { slant: 1 }), base = readerRows(page, ph, i => TAG_ROWS.includes(i) ? 1 : 0);
  // y outside every band: the row decides, flagged
  let rows = base.map((r, i) => i === 4 ? { ...r, y: 0.002 } : r), res = analyze(ph.img, rows, {});
  ok(res.rows[4].band.check === true && res.rows[4].band.src === 'rules', 'y in no band: flagged, src rules');
  near(res.rows[4].band.top, res.cf(0, page.truth.rows[4].top).y, 0.004, 'y in no band: the row decides');
  ok(!res.pageCheck && res.rows.filter((r, i) => i !== 4 && r.band.check).length === 0, 'one stray y does not flag the page');
  // y says another band: y wins, src y, flagged
  rows = base.map((r, i) => i === 3 ? { ...r, row: 7 } : r); res = analyze(ph.img, rows, {});
  ok(res.rows[3].band.src === 'y' && res.rows[3].band.check === true, 'y overrides row: src y, flagged');
  near(res.rows[3].band.top, res.cf(0, page.truth.rows[3].top).y, 0.004, 'y overrides row: y decides');
  // no y: row alone, not flagged
  rows = base.map(r => ({ row: r.row, tags: r.tags })); res = analyze(ph.img, rows, {});
  ok(res.rows.every(r => r.band.src === 'row' && !r.band.check), 'no y: src row, no flag'); checkBands(page, res, 'row only', true);
  // invalid row and y: no band
  for (const [rw, y] of [[null, null], [0, 2], [-1, -0.1], [1.5, 'x'], ['2', NaN], [NaN, Infinity]]) ok(analyze(ph.img, [{ row: rw, y }], {}).rows[0].band === null, `invalid ${rw}/${y} gives no band`);
  ok(analyze(ph.img, [{ row: 40 }], {}).rows[0].band === null, 'row beyond the table and no y: no band');
  // row beyond the table with y: y decides, flagged
  res = analyze(ph.img, [{ row: 40, y: base[2].y }], {}); ok(res.rows[0].band.check === true && res.rows[0].band.src === 'y' || res.rows[0].band.src === 'rules', 'row out of range: y decides'); ok(res.rows[0].band.check === true, 'row out of range: flagged');
  // a continuation fragment at the top counts as row 1 and is not returned: the first returned row says 2
  rows = base.slice(1).map(r => ({ ...r, row: r.row })); res = analyze(ph.img, rows, {}); near(res.rows[0].band.top, res.cf(0, page.truth.rows[1].top).y, 0.004, 'continuation counted');
  // too few rules: centred on y with a fixed margin, flagged
  const blank = { data: new Uint8ClampedArray(600 * 800 * 4).fill(255), w: 600, h: 800 };
  const bf = analyze(blank, [{ row: 5, y: 0.5 }, { row: 5 }, { y: 0.01 }], {});
  ok(bf.ok === false && bf.rows[0].band.src === 'fallback' && bf.rows[0].band.check === true, 'fallback: src, flagged');
  near((bf.rows[0].band.top + bf.rows[0].band.bottom) / 2, 0.5, 0.0002, 'centred on y'); near(bf.rows[0].band.bottom - bf.rows[0].band.top, 2 * Vision.K.FALLBACK, 0.0002, 'fixed margin');
  ok(bf.rows[1].band === null, 'too few rules and no y: no band'); ok(bf.rows[2].band.top === 0, 'clamped at the page top');
  ok(bf.rows[0].boxes.length === 0, 'no signs without a table');
  // a missing rule merges two rows into one band: the first row's row and y still agree, so both rows are flagged because they share a band
  { const lost = drawPage({ ...pageOpts, signs: [], map: false, streak: 0, dropRule: 5 }), lph = photograph(lost, {}), all = readerRows(lost, lph, () => 0);
    const two = [all[3], all[4]], lres = analyze(lph.img, two, {});          // rows 4 and 5 lie either side of the lost rule
    ok(lres.rows[0].band.check === true && lres.rows[1].band.check === true, 'two rows in one band are both flagged');
    ok(lres.rows[0].band.src === 'rules' && !lres.pageCheck, 'the first of them agrees with its band, and only the shared band flags it');
    const solo = analyze(lph.img, [all[3]], {}); ok(!solo.rows[0].band.check, 'one row alone in the merged band is not flagged');
    const full = analyze(lph.img, all, {}); ok(full.rows[3].band.check && full.rows[4].band.check, 'with every row given, rows 4 and 5 are flagged');
    const whole = drawPage({ ...pageOpts, signs: [], map: false, streak: 0 }), wph = photograph(whole, {}), wres = analyze(wph.img, readerRows(whole, wph, () => 0).slice(3, 5), {});
    ok(wres.rows.every(r => !r.band.check), 'the same two rows with the rule present are not flagged'); }
  // the page cross-check: a band above the headings that the column rules also cross
  const dp = drawPage({ ...pageOpts, decoy: 40, signs: [] }), dph = photograph(dp, {}), drows = readerRows(dp, dph, () => 0), dres = analyze(dph.img, drows, {});
  ok(dres.pageCheck === true, 'the cross-check overrides the headings band');
  checkBands(dp, dres, 'cross-check', true);
  ok(dres.rows.every(r => r.band.pageCheck === true && r.band.check === true), 'every row of the page is flagged and highlighted');
  // the headings and the first rows are cut off the photo: the first rule found is below them, so the reader's row 1 is above it
  { const cp = drawPage({ ...pageOpts, signs: [], map: false, streak: 0 }), cut = drawPage({ ...pageOpts, signs: [], map: false, streak: 0, cut: cp.T.rules[3] - 18 });
    const cph = photograph(cut, {}), all = readerRows(cut, cph, () => 0), seen = all.slice(2).map((r, i) => ({ ...r, row: i + 1 }));    // the reader counts from the first row it can see
    const cres = analyze(cph.img, seen, {});
    ok(cres.pageCheck === true, 'rows above the first rule found: the page is flagged');
    seen.forEach((r, i) => { const b = cres.rows[i].band, t = cut.truth.rows[i + 2]; ok(b && b.check && b.pageCheck, 'cut page: row ' + (i + 1) + ' is flagged'); near(b.top, cres.cf(0, t.top).y, 0.005, 'cut page: row ' + (i + 1) + ' band top'); near(b.bottom, cres.cf(0, t.bottom).y, 0.005, 'cut page: row ' + (i + 1) + ' band bottom'); }); }
  // the first rows lie above the first rule found: with a y they get a fallback band (flagged); with neither a usable row mapping nor a y, none
  { const cp = drawPage({ ...pageOpts, signs: [], map: false, streak: 0 }), cut = drawPage({ ...pageOpts, signs: [], map: false, streak: 0, cut: cp.T.rules[3] - 18 });
    const cph = photograph(cut, {}), all = readerRows(cut, cph, () => 0), res = analyze(cph.img, all, {});
    for (const i of [0, 1]) {
      const b = res.rows[i].band, t = cut.truth.rows[i], mid = res.cf(0, (t.top + t.bottom) / 2).y;
      ok(b && b.src === 'fallback' && b.check === true && b.pageCheck === true, `above the first rule, row ${i + 1} with a y: fallback band, flagged`);
      near((b.top + b.bottom) / 2, mid, 0.005, `above the first rule, row ${i + 1}: fallback band centred on its y`);
    }
    const noY = analyze(cph.img, all.map((r, i) => i < 2 ? { row: r.row, tags: r.tags } : r), {});
    ok(noY.pageCheck === true && noY.rows[0].band === null && noY.rows[1].band === null, 'the same rows with no y: no band'); }
  const nd = analyze(photograph(dp, {}).img, drows.map(r => ({ row: r.row })), {}); ok(!nd.pageCheck, 'with no y there is nothing to cross-check');
}

// ---- sign graphics (rules 10-13) ----
{ // a clean page, like a PDF: a cell with one line of text and a sign
  const clean = drawPage({ ...pageOpts, map: false, streak: 0 }), ph = photograph(clean, {}), rows = readerRows(clean, ph, i => TAG_ROWS.includes(i) ? 1 : 0), res = analyze(ph.img, rows, {});
  checkSigns(clean, res, 'clean page');
  // untagged rows are not searched even when they hold a graphic
  const none = analyze(ph.img, readerRows(clean, ph, () => 0), {}); ok(none.rows.every(r => r.boxes.length === 0), 'no tags, no search');
  // at most as many graphics as tags, largest first
  const two = drawPage({ ...pageOpts, map: false, streak: 0, signs: [{ row: 8, kind: 'diamond' }, { row: 8, kind: 'rect', dx: 150 }] }), p2 = photograph(two, {});
  const r2 = analyze(p2.img, readerRows(two, p2, i => i === 8 ? 2 : 0), {}); ok(r2.rows[7].boxes.length === 2, 'two graphics side by side are two images');
  ok(r2.rows[7].boxes[0].left < r2.rows[7].boxes[1].left, 'left to right');
  ok(iou(r2.rows[7].boxes[0], trueBox(r2, two.truth.signs[0])) > 0.55 && iou(r2.rows[7].boxes[1], trueBox(r2, two.truth.signs[1])) > 0.55, 'both match the ones drawn');
  const r1 = analyze(p2.img, readerRows(two, p2, i => i === 8 ? 1 : 0), {}); ok(r1.rows[7].boxes.length === 1, 'one tag keeps one graphic');
  ok(iou(r1.rows[7].boxes[0], trueBox(r2, two.truth.signs[1])) > 0.55 || iou(r1.rows[7].boxes[0], trueBox(r2, two.truth.signs[0])) > 0.55, 'the one kept is one of those drawn');
  const ra = analyze(p2.img, readerRows(two, p2, i => i === 8 ? 3 : 0), {}); ok(ra.rows[7].boxes.length === 2, 'more tags than graphics: only what is there');
  // tiny lettering inside a sign does not set the text height: with it counted as text, every line of text would look like a graphic
  const badge = drawPage({ ...pageOpts, map: false, streak: 0, signs: [{ row: 2, kind: 'badge' }, { row: 4, kind: 'badge' }, { row: 6, kind: 'badge' }, { row: 8, kind: 'badge' }], lines: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }), pb = photograph(badge, { slant: 1 });
  const rb = analyze(pb.img, readerRows(badge, pb, () => 3), {});
  badge.truth.rows.forEach((r, i) => { const want = TAG_ROWS.includes(i + 1) ? 1 : 0; ok(rb.rows[i].boxes.length === want, `badges: row ${i + 1} has ${want} graphic(s), got ${rb.rows[i].boxes.length}`); });
  // one sign alone in the row
  const one = drawPage({ ...pageOpts, map: false, streak: 0, signs: [{ row: 8, kind: 'rect' }] }), p1 = photograph(one, {});
  const o1 = analyze(p1.img, readerRows(one, p1, i => i === 8 ? 1 : 0), {}); ok(o1.rows[7].boxes.length === 1, 'a row with one sign shows that sign alone');
  // multi-line text and a row with tags but no graphic: no false positives, no flags
  const text = drawPage({ ...pageOpts, map: false, streak: 0, signs: [], lines: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3] }), pt = photograph(text, { slant: 1.5, blur: 1 });
  const rt = analyze(pt.img, readerRows(text, pt, () => 1), {});
  ok(rt.rows.every(r => r.boxes.length === 0), 'no block of text is a graphic'); ok(rt.rows.every(r => r.band && !r.band.check), 'tags with no graphic found are not flagged');
  // text and sign in one cell, three lines of text above the sign
  const mix = drawPage({ ...pageOpts, map: false, streak: 0, signs: [{ row: 8, kind: 'diamond', dy: 90 }], lines: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] }), pm = photograph(mix, {});
  const rm = analyze(pm.img, readerRows(mix, pm, i => i === 8 ? 1 : 0), {}); ok(rm.rows[7].boxes.length === 1 && iou(rm.rows[7].boxes[0], trueBox(rm, mix.truth.signs[0])) > 0.55, 'sign below text'); }

// ---- the Instruction cell is found from the right edge, not from a fixed column count (rule 10) ----
// Instruction is the second-to-last column: the table's right edge, then Instruction's right rule, then its left rule. A column rule
// the photo lost or drew too faintly, or a table with another number of columns left of Instruction, must not cost the page its signs.
{ const base = { ...pageOpts, map: false, streak: 0 };
  const run = (name, o, want) => {
    const pg = drawPage({ ...base, ...o }), ph = photograph(pg, {}), res = analyze(ph.img, readerRows(pg, ph, i => TAG_ROWS.includes(i) ? 1 : 0), {});
    if (want) checkSigns(pg, res, name); else ok(res.rows.every(r => r.boxes.length === 0), `${name}: no sign boxes`);
    return res;
  };
  const vx7 = [60, 130, 200, 270, 360, 700, 940];                    // six columns: the shape of a real table
  const full = run('7 rules', { vx: vx7 }, true);
  for (const i of [1, 2, 3]) {                                       // a rule left of Instruction lost: 6 rules found
    const lost = run(`rule ${i} missing`, { vx: vx7, dropCol: i }, true);
    full.rows.forEach((r, k) => ok(lost.rows[k].boxes.length === r.boxes.length, `rule ${i} missing: row ${k + 1} has as many graphics as the full page`));
  }
  run('rule 2 too faint', { vx: vx7, faintCol: 2 }, true);
  run('5 rules', { vx: [60, 200, 360, 700, 940] }, true);
  run('5 rules, other widths', { vx: [100, 280, 360, 700, 940] }, true);
  run('4 rules', { vx: [240, 360, 700, 940] }, true);
  run('9 rules', { vx: [60, 100, 140, 190, 240, 300, 360, 700, 940] }, true);
  run('2 rules', { vx: [360, 700] }, false);                         // fewer than 3 column rules: no sign boxes, no error
  run('1 rule', { vx: [360] }, false); }

console.log(`vision tests: ${checks} checks passed`);
