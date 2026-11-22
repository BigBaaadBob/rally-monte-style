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
  // y says another band (rule 9). A row's y is moved one row down the page by giving it the next row's y.
  const N = base.length, topOf = (r, i) => r.cf(0, page.truth.rows[i].top).y, botOf = (r, i) => r.cf(0, page.truth.rows[i].bottom).y;
  const off = (rs, idx) => rs.map((r, i) => idx.includes(i) ? { ...r, y: base[i + 1].y } : r);
  // n rows off in both directions (the first half one row down, the rest one row up), so no single headings offset fits them and the cross-check stays put
  const dirOf = (i, n) => i < Math.ceil(n / 2) ? 1 : -1, mix = (rs, n) => rs.map((r, i) => i < n ? { ...r, y: base[i + dirOf(i, n)].y } : r);
  // a page in doubt, a majority of its rows disagree: y decides, src y, flagged
  res = analyze(ph.img, mix(base, 6), {});
  ok(!res.pageCheck, 'majority off: the headings are not moved');
  for (let i = 0; i < 6; i++) { ok(res.rows[i].band.src === 'y' && res.rows[i].band.check === true, `majority off: row ${i + 1} src y, flagged`); near(res.rows[i].band.top, topOf(res, i + dirOf(i, 6)), 0.004, `majority off: row ${i + 1} y decides`); }
  // a page in doubt, a row that names no band (below the table): y decides for the row whose y is off
  rows = off(base, [3]).map((r, i) => i === 8 ? { ...r, row: 40 } : r); res = analyze(ph.img, rows, {});
  ok(res.rows[3].band.src === 'y' && res.rows[3].band.check === true, 'a row names no band: the page is in doubt, src y, flagged');
  near(res.rows[3].band.top, topOf(res, 4), 0.004, 'a row names no band: y decides');
  // a sound page, one row's y a row off: the row band is kept, src rules, flagged; rows far from it are not flagged
  res = analyze(ph.img, off(base, [3]), {});
  ok(!res.pageCheck && res.rows[3].band.src === 'rules' && res.rows[3].band.check === true, 'sound page, one row off: src rules, flagged');
  near(res.rows[3].band.top, topOf(res, 3), 0.004, 'sound page, one row off: row decides'); near(res.rows[3].band.bottom, botOf(res, 3), 0.004, 'sound page, one row off: row decides (bottom)');
  ok(res.rows.every((r, i) => [3, 4].includes(i) || (!r.band.check && r.band.src === 'rules')), 'sound page, one row off: no other row is flagged except by the shared band');
  // a sound page, an adjacent block of rows off
  res = analyze(ph.img, off(base, [2, 3]), {});
  for (const i of [2, 3]) { ok(res.rows[i].band.src === 'rules' && res.rows[i].band.check === true, `sound page, block off: row ${i + 1} src rules, flagged`); near(res.rows[i].band.top, topOf(res, i), 0.004, `sound page, block off: row ${i + 1} row decides`); }
  // the majority: just under half off, row wins; exactly half and just over half, y wins (the first 9 or 8 rows are given)
  for (const [m, n, wins] of [[9, 4, 'row'], [8, 4, 'y'], [9, 5, 'y']]) {
    res = analyze(ph.img, mix(base, n).slice(0, m), {}); ok(!res.pageCheck, `${n} of ${m} off: the headings are not moved`);
    for (let i = 0; i < n; i++) { ok(res.rows[i].band.src === (wins === 'y' ? 'y' : 'rules') && res.rows[i].band.check === true, `${n} of ${m} off: row ${i + 1} src ${wins === 'y' ? 'y' : 'rules'}, flagged`); near(res.rows[i].band.top, topOf(res, wins === 'y' ? i + dirOf(i, n) : i), 0.004, `${n} of ${m} off: ${wins} decides row ${i + 1}`); }
  }
  // the S26 pattern: the two top rows' y one row too low. Both keep their row bands and are flagged; the third row shares a band with the second's y, so it stays flagged
  res = analyze(ph.img, off(base, [0, 1]), {});
  for (const i of [0, 1]) { ok(res.rows[i].band.src === 'rules' && res.rows[i].band.check === true, `S26 pattern: row ${i + 1} keeps its row band, flagged`); near(res.rows[i].band.top, topOf(res, i), 0.004, `S26 pattern: row ${i + 1} row decides`); }
  ok(res.rows[2].band.check === true && res.rows[2].band.src === 'rules', 'S26 pattern: the third row is flagged by the same-band rule'); near(res.rows[2].band.top, topOf(res, 2), 0.004, 'S26 pattern: the third row keeps its band');
  ok(res.rows.slice(3).every(r => !r.band.check), 'S26 pattern: the other rows are not flagged');
  // a continuation fragment at the top (row 1, not returned): the page is still sound and a row off keeps its row band
  res = analyze(ph.img, off(base, [3]).slice(1), {});
  ok(res.rows[2].band.src === 'rules' && res.rows[2].band.check === true, 'continuation at the top: a row off on a sound page keeps its row band'); near(res.rows[2].band.top, topOf(res, 3), 0.004, 'continuation at the top: row decides');
  // a row rule missing low: two rows merge, every row below names the band one too low and the last names none, so y wins below the merge
  for (const [j, name] of [[N - 3, 'lower half'], [1, 'upper half']]) {
    const lost = drawPage({ ...pageOpts, signs: [], map: false, streak: 0, dropRule: j + 2 }), lph = photograph(lost, { slant: 1 }), all = readerRows(lost, lph, () => 0), lres = analyze(lph.img, all, {});
    const lt = (i, k) => lres.cf(0, lost.truth.rows[i][k]).y;
    ok(lres.pageCheck === (j === 1), `rule missing in the ${name}: ${j === 1 ? 'most rows lie below the merge, so the cross-check moves the headings (a page in doubt)' : 'the headings are not moved'}`);
    ok(lres.rows[j].band.check === true && lres.rows[j + 1].band.check === true, `rule missing in the ${name}: the merged rows are flagged`);
    near(lres.rows[j + 1].band.top, lt(j, 'top'), 0.004, `rule missing in the ${name}: the second merged row is in the merged band`); near(lres.rows[j + 1].band.bottom, lt(j + 1, 'bottom'), 0.004, `rule missing in the ${name}: the merged band's bottom`);
    if (j === 1) ok(lres.rows.every(r => r.band && r.band.check === true && r.band.pageCheck === true), `rule missing in the ${name}: every row of the page gets check and pageCheck`);
    if (j !== 1) ok(lres.rows[j + 1].band.src === 'y', `rule missing in the ${name}: y decides below the merge`);
    for (let i = j + 2; i < N; i++) near(lres.rows[i].band.top, lt(i, 'top'), 0.004, `rule missing in the ${name}: row ${i + 1} y decides`);
  }
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

// ---- the table frame (rules 5-6): gridOf on rules built from the geometry drawn, so every number below is a line drawn, never an output ----
// A column rule is {x, from y to y}; a row rule is {y, from x to x}. Row pitch (median of the gaps between the body's rules) is 100; half is 50.
{ const mk = (u, t0, t1) => ({ c0: u, c1: 0, c2: 0, t0, t1, tc: (t0 + t1) / 2, hh: (t1 - t0) / 2, th: 3, con: 100, dark: 0 });
  const VX = [60, 110, 170, 240, 300, 360, 700, 940], YS = [220, 270, 360, 660, 720, 880, 955, 1125, 1155, 1355, 1455, 1575], TW = 880;
  const build = (o = {}) => {
    const vx = o.vx || VX, ext = o.ext || {};
    const V = vx.map((x, i) => { const e = ext[i] || [220, 1575]; return mk(x, e[0], e[1]); }).filter((_, i) => !(o.skip || []).includes(i)).concat(o.extraV || []);
    const H = (o.ys || YS).map(y => mk(y, 60, 940)).concat(o.extraH || []);
    const g = new Uint8Array(1000 * 1800).fill(255);                    // the paper, with the slanted rule drawn dark (only the combined rule is tested against it)
    for (const r of o.ink || []) for (let y = r.t0; y <= r.t1; y++) { const x = Math.round(r.x0 + r.slope * (y - r.t0)); for (let d = -1; d <= 1; d++) g[y * 1000 + x + d] = 0; }
    return { w: 1000, h: 1800, V, H, g };
  };
  const frame = (G, name, y0, y1, x0 = 60, x1 = 940) => {
    ok(G.ok, name + ': a frame'); ok(G.head === 0, name + ': the headings are the first band');
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].forEach((p, i) => { near(G.quad[i][0], p[0], 1, name + ': corner ' + i + ' x'); near(G.quad[i][1], p[1], 1, name + ': corner ' + i + ' y'); });
  };
  const base = Vision.gridOf(build());
  frame(base, 'plain table', 220, 1575); ok(base.V.length === 8 && base.H.length === YS.length, 'plain table: every column and row rule kept');
  ok(base.diag.notSnapped.length === 0 && base.diag.reruns.length === 1 && base.diag.reruns[0].trigger.join() === 'final pitch' && !base.diag.reruns[0].changed, 'plain table: both limits snap; the one second run (final pitch) changes nothing');
  // column rules of mixed heights, some reaching up into a ruled box as wide as the table: all kept, the frame starts at the headings
  { const G = Vision.gridOf(build({ extraH: [mk(100, 60, 940), mk(190, 60, 940)], ext: { 0: [100, 1575], 7: [100, 1575], 2: [100, 1575], 4: [100, 1575], 3: [190, 1575] } }));
    frame(G, 'mixed column heights', 220, 1575); ok(G.V.length === 8, 'mixed column heights: all eight column rules kept');
    ok(G.H.length === YS.length && G.Hout.length === 2, 'mixed column heights: the box lines are not rows (' + G.H.length + ' rows, ' + G.Hout.length + ' outside)'); }
  // a column rule covers the body, falling short by at most half a row pitch at each end
  { const G = Vision.gridOf(build({ ext: { 3: [260, 1535] } })); ok(G.V.length === 8, 'short by 40 (under half a pitch) at both ends: kept');
    const S = Vision.gridOf(build({ ext: { 4: [300, 1575] } })); ok(S.V.length === 7 && !S.V.some(v => v.c0 === 300), 'short by 80 at the top: not a column rule');
    const B = Vision.gridOf(build({ ext: { 4: [220, 1495] } })); ok(B.V.length === 7 && !B.V.some(v => v.c0 === 300), 'short by 80 at the bottom: not a column rule'); }
  // a box line 30 px above the headings' top rule and one 30 px below the last row's rule (both under half a pitch, 50), column rules ending at the table's rules:
  // the column rules end nearest the table's rules, so the lines are not covered, and the limits are the headings' top rule and the last row's bottom rule
  { const G = Vision.gridOf(build({ extraH: [mk(190, 60, 940), mk(1605, 60, 940)] }));
    frame(G, 'box lines 30 px outside the table', 220, 1575); ok(G.V.length === 8 && G.H.length === YS.length, 'box lines 30 px outside the table: not rows');
    ok(G.diag.votes.top.votes === 6 && G.diag.votes.bottom.votes === 6 && G.diag.notSnapped.length === 0, 'box lines 30 px outside the table: the limits are covered by all 6 interior rules'); }
  // column rules that stop short of the table by up to half a row pitch are column rules, whatever the page height (a pitch of 200 here, so half is 100)
  { const ys = [220, 420, 620, 820, 1020, 1220, 1420];
    const G = Vision.gridOf(build({ ys, ext: { 1: [300, 1420], 4: [220, 1340] } })); frame(G, 'columns short by 80', 220, 1420); ok(G.V.length === 8, 'columns short by 80 of a 200 pitch (at the top, at the bottom): kept');
    // ends a few pixels either side of the old fixed bar (3% of the page height, 54 px): the same columns either way
    const J = Vision.gridOf(build({ ys, ext: { 3: [220, 1369], 5: [220, 1363] } })); frame(J, 'columns short by 51 and 57', 220, 1420); ok(J.V.length === 8, 'columns short by 51 and by 57: both kept'); }
  // most of the column rules end a little short of the last row rule (45 of a 100 pitch): the bottom limit is still that rule
  { const ext = {}; [1, 2, 3, 5, 6].forEach(i => { ext[i] = [220, 1530]; });
    const G = Vision.gridOf(build({ ext })); frame(G, 'columns end short of the last rule', 220, 1575); ok(G.V.length === 8 && G.H.length === YS.length, 'columns end short of the last rule: every row rule kept'); }
  // a row rule inside the body: exactly 80% of the table width is accepted, just under is not
  { const x0 = 60; ok(Vision.gridOf(build({ extraH: [mk(500, x0, x0 + Vision.K.ROW_SPAN * TW)] })).H.length === YS.length + 1, 'a row rule spanning exactly 80% is a row rule');
    ok(Vision.gridOf(build({ extraH: [mk(500, x0, x0 + Vision.K.ROW_SPAN * TW - 1)] })).H.length === YS.length, 'a row rule just under 80% is not'); }
  // a row rule must reach both rules that bound the Instruction cell, with a gap of half a column width (median 60: 30) at each
  { const vx = [60, 110, 170, 240, 300, 360, 900, 940];             // Instruction is 360-900
    ok(Vision.gridOf(build({ vx, extraH: [mk(500, 60, 60 + 0.9 * TW)] })).H.length === YS.length, 'a 90% rule that stops 48 short of an Instruction rule is not a row rule');
    ok(Vision.gridOf(build({ vx, extraH: [mk(500, 60, 872)] })).H.length === YS.length + 1, 'a rule that stops 28 short of it is'); }
  // column ends jittered by a few pixels, top and bottom independently: the same columns and frame
  { const jt = [3, -4, 2, -3, 4, -2, 1, -1], jb = [-2, 3, -4, 2, 1, -3, 4, -1], ext = {};
    jt.forEach((d, i) => { ext[i] = [220 + d, 1575 + jb[i]]; });
    const G = Vision.gridOf(build({ ext })); frame(G, 'jittered column ends', 220, 1575); ok(G.V.length === 8 && G.H.length === YS.length, 'jittered column ends: the same rules'); }
  // a ruled box below the table, one interior column rule running on into it (a streak joined to it): the bottom limit stays at the last row's rule
  { const G = Vision.gridOf(build({ extraH: [mk(1610, 60, 940), mk(1700, 60, 940)], ext: { 0: [220, 1700], 7: [220, 1700], 3: [220, 1700] } }));
    frame(G, 'box below with a streak', 220, 1575); ok(G.H.length === YS.length && G.Hout.length === 2 && G.V.length === 8, 'box below with a streak: the box lines are not rows'); }
  // a photo cut off through a row (rules 220-360 are full-width rows that pass the row test but do not meet the interior columns, so they are not the fallback limit): no rule where the columns begin (or end), so that limit is not snapped and the frame starts at the first rule found
  { const G = Vision.gridOf(build({ ext: Object.fromEntries(VX.map((_, i) => [i, [515, 1575]])) }));
    frame(G, 'cut off at the top', 660, 1575); ok(G.diag.notSnapped.length === 0 && G.diag.votes.top.votes === 6, 'cut off at the top: every interior rule covers the first rule found, so it is the limit (6 of 6)');
    const E = Vision.gridOf(build({ ext: Object.fromEntries(VX.map((_, i) => [i, [220, 1040]])) }));
    frame(E, 'cut off at the bottom', 220, 955); ok(E.diag.notSnapped.length === 0 && E.diag.votes.bottom.votes === 6, 'cut off at the bottom: every interior rule covers the last rule found (6 of 6)'); }
  // no majority: three interior rules cover the upper rows and three the lower, so no rule is covered by more than half of the six. Nothing is snapped
  // (a plurality never sets a limit), both limits are reported as not snapped, and the columns then fail the body test, so no frame
  { const ext = {}; [1, 2, 3].forEach(i => { ext[i] = [220, 800]; }); [4, 5, 6].forEach(i => { ext[i] = [900, 1575]; });
    const G = Vision.gridOf(build({ ext }));
    ok(G.diag.notSnapped.join() === 'top,bottom' && G.diag.votes.top === null && G.diag.votes.bottom === null, 'no majority: both limits reported as not snapped');
    ok(!G.ok && G.V.length === 2, 'no majority: the columns that cover only half of the body are not column rules (no frame, no error)'); }
  // a plurality is not a majority: of five interior rules, one reaches exactly to the box's top line (100) and one to its other line (150): the headings' top rule is covered by all five
  { const vx = [60, 130, 200, 270, 360, 700, 940];
    const G = Vision.gridOf(build({ vx, extraH: [mk(100, 60, 940), mk(150, 60, 940)], ext: { 1: [100, 1575], 2: [150, 1575] } }));
    frame(G, 'two of five reach the box', 220, 1575); ok(G.V.length === 7, 'two of five reach the box: all seven column rules kept');
    ok(G.diag.votes.top.votes === 5 && G.diag.votes.top.next === 2 && G.diag.votes.top.of === 5, 'the box line is covered by 2 of 5 interior rules, the headings rule by all 5 (got ' + JSON.stringify(G.diag.votes.top) + ')');
    ok(G.diag.votes.bottom.votes === 5 && G.diag.notSnapped.length === 0, 'the bottom limit snaps by 5 of 5'); }
  // the outer rules of the first look are provisional: a long vertical beside the table that does not cover the body is dropped, with one second run from the start
  { const G = Vision.gridOf(build({ extraV: [mk(20, 600, 1400)] }));
    frame(G, 'a vertical beside the table', 220, 1575); ok(G.V.length === 8 && G.V[0].c0 === 60, 'a vertical beside the table: not a column rule');
    ok(G.diag.reruns.length === 1 && G.diag.reruns[0].trigger.includes('outer rules'), 'a vertical beside the table: the second run is reported'); }
  // a line outside the body counts only if it spans 80% of the table width between the outer rules and is as dark as the body's rules
  { const G = Vision.gridOf(build({ extraH: [mk(100, 60, 940), mk(150, 60, 60 + Vision.K.ROW_SPAN * TW - 1), Object.assign(mk(1600, 60, 940), { con: 20 }), mk(1700, 0, 1000)], ext: { 0: [100, 1700], 7: [100, 1700] } }));
    ok(G.Hout.length === 2, 'outside the body: a full line and one reaching past the outer rules count; one just under 80% and a faint one do not (got ' + G.Hout.length + ')'); }
  // a full-width line near the image's bottom edge with no box: the outer column rules do not reach it, so it is not counted
  { const G = Vision.gridOf(build({ extraH: [mk(1790, 60, 940)] })); frame(G, 'a line at the bottom edge', 220, 1575);
    ok(G.Hout.length === 0 && G.H.length + G.Hout.length === YS.length, 'a line at the bottom edge with no box: not in Hout, the row count stays at the rules drawn'); }
  // pieces of one slanted column rule, overlapping by more than joinStrokes joins (18 px of a 100 pitch: half a pitch is the limit): one column rule
  { const sl = 0.04, piece = (t0, t1, x0) => { const tc = (t0 + t1) / 2, hh = (t1 - t0) / 2; return { c0: x0 + sl * (tc - t0), c1: sl * hh, c2: 0, t0, t1, tc, hh, th: 3, con: 100, dark: 0 }; };
    const ink = [{ x0: 240, slope: sl, t0: 220, t1: 1575 }];
    const G = Vision.gridOf(build({ skip: [3], ink, extraV: [piece(220, 898, 240), piece(880, 1575, 240 + sl * 660)] }));
    frame(G, 'a rule in two pieces', 220, 1575); ok(G.V.length === 8, 'a slanted rule broken in two pieces that overlap by 18: one column rule (got ' + G.V.length + ')');
    const far = Vision.gridOf(build({ skip: [3], ink, extraV: [piece(220, 898, 240), piece(880, 1575, 240 + sl * 660 + 15)] }));
    ok(far.V.length === 7, 'two parallel pieces 15 apart (merge distance 9): not combined, neither covers the body');
    const bent = Vision.gridOf(build({ skip: [3], ink, extraV: [piece(220, 850, 240), Object.assign(piece(880, 1575, 240 + sl * 660), { c1: 0.5 * 347.5 })] }));
    ok(bent.V.length === 7, 'a piece and a streak segment that does not line up: not combined'); }
  // too few rules: no frame, no error
  ok(!Vision.gridOf(build({ ys: [220] })).ok, 'one row rule: no frame'); ok(!Vision.gridOf(build({ vx: [60, 940] })).ok, 'two column rules: no frame');
  // on a drawn and photographed page: a ruled box as wide as the table above the headings, with some column rules running up into it
  { const pg = drawPage({ wideBox: [40, 190], colExt: { 2: [40, 1578], 4: [40, 1578], 3: [190, 1578] }, lines: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] });
    for (const [name, o] of [['flat', {}], ['slant and keystone', { slant: 2, key: 0.06, blur: 1 }]]) {
      const ph = photograph(pg, o), G = Vision.gridOf(Vision.rulesOf(ph.img)), res = analyze(ph.img, readerRows(pg, ph), {});
      ok(G.ok && G.head === 0 && G.V.length === 8, 'box above, ' + name + ': a frame, headings first, eight column rules');
      const tl = ph.to(60, 220), bl = ph.to(60, 1578); near(G.quad[0][1] - tl[1], 0, 6, 'box above, ' + name + ': the frame starts at the headings'); near(G.quad[3][1] - bl[1], 0, 6, 'box above, ' + name + ': and ends at the last row');
      checkBands(pg, res, 'box above, ' + name); } } }

console.log(`vision tests: ${checks} checks passed`);
