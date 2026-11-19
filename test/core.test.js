const assert = require('assert');
const Core = require('../src/core.js');
const SAMPLE = require('../src/sample.js');
const T = Core.parseTOD;
const near = (a, b, tol, msg) => assert.ok(a != null && Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b}±${tol}`);

// time formats
assert.strictEqual(Core.fmtTOD(T('15:39:00'), 'hms'), '15:39:00');
assert.strictEqual(Core.fmtTOD(T('15:39:30'), 'hmc'), '15:39.50');
assert.strictEqual(T('15:39.5'), T('15:39:30'));
assert.strictEqual(Core.fmtTOD(T('15:59:59.8'), 'hms'), '16:00:00');
// Time Allowance (TA): whole seconds or m:ss, never negative (DESIGN Run controls)
assert.strictEqual(Core.parseTA('1:05'), 65);
assert.strictEqual(Core.parseTA('+1:05'), 65);
assert.strictEqual(Core.parseTA('2:00'), 120);
assert.strictEqual(Core.parseTA('12'), 12);
assert.strictEqual(Core.parseTA('+12'), 12);
assert.strictEqual(Core.parseTA(''), 0);
assert.strictEqual(Core.parseTA('   '), 0);
assert.strictEqual(Core.parseTA('0:59'), 59);
for (const bad of ['-12', '−0:30', '-1:05', '.50m', '1.5', '0:60', '1:5', '1:05.5', 'abc', '1m']) assert.strictEqual(Core.parseTA(bad), null, bad);
assert.strictEqual(Core.fmtTA(0), '0:00');
assert.strictEqual(Core.fmtTA(65), '1:05');
assert.strictEqual(Core.fmtTA(5400), '90:00');
assert.strictEqual(Core.fmtTA(null), '');
{ const rr = { rows: [{ ri: 1 }], taEvents: [] };
  assert.strictEqual(Core.setTA(rr, 0, -15)[0].ta, 0, 'TA is never negative');
  assert.strictEqual(Core.setTA(rr, 0, 9999)[0].ta, Core.TA_MAX, 'TA is capped at 90:00');
  assert.strictEqual(Core.setTA(rr, 0, 30.6)[0].ta, 31, 'TA is whole seconds'); }


// normalise "/0.00" (DESIGN Computation: a bare "/0.00" is a restart at OM 0.00)
let n = Core.normRow({ ri: '42', om: '8.55/0.00', czt: '09:12:00' });
assert.strictEqual(n.ri, 42); assert.strictEqual(n.om, 8.55); assert.strictEqual(n.restart, true);
n = Core.normRow({ ri: 1, om: '/0.00' }); assert.strictEqual(n.restart, true); assert.strictEqual(n.om, 0, 'bare /0.00 is OM 0.00');
n = Core.normRow({ ri: 1, om: ' / 0.00 ' }); assert.strictEqual(n.restart, true); assert.strictEqual(n.om, 0);
n = Core.normRow({ ri: 2, om: '1.25' }); assert.strictEqual(n.restart, false); assert.strictEqual(n.om, 1.25);
n = Core.normRow({ ri: 3, om: null }); assert.strictEqual(n.restart, false); assert.strictEqual(n.om, null, 'no OM stays null');
assert.strictEqual(Core.parseOCR('```json\n[{"ri":1,"om":"/0.00"}]\n```').map(Core.normRow)[0].restart, true, 'bare /0.00 in pasted JSON');
assert.strictEqual(Core.parseOCR('```json\n[{"ri":1,"om":"/0.00"}]\n```').map(Core.normRow)[0].om, 0);
{ const b = Core.parseCSV('RI,OM,CZT,CP,Instruction,Info\n1,/0.00,09:00:00,1,START,\n2,0.50,,,L,').map(Core.normRow);
  assert.deepStrictEqual([b[0].restart, b[0].om, b[1].restart, b[1].om], [true, 0, false, 0.5], 'bare /0.00 in CSV'); }

// merge + sort: shuffled input, then a page re-read replaces text but keeps completion
const SR = SAMPLE.rows;
let m = Core.mergeRows([], SR.slice(8).concat(SR.slice(0, 8)));
assert.strictEqual(m.added, SR.length);
assert.deepStrictEqual(m.rows.map(r => r.ri), SR.map(r => r.ri));
m.rows[0].done = true;
const anchorRI = SR[5].ri;
m = Core.mergeRows(m.rows, [{ ri: SR[0].ri, om: '/0.00', instr: 'fixed' }, { ri: anchorRI + 'A', om: SR[5].om, instr: 'inserted' }]);
assert.strictEqual(m.replaced, 1); assert.strictEqual(m.added, 1);
assert.strictEqual(m.rows[0].done, true); assert.strictEqual(m.rows[0].instr, 'fixed');
assert.strictEqual(m.rows.findIndex(r => r.ri === anchorRI + 'A'), m.rows.findIndex(r => r.ri === anchorRI) + 1);

// Independent expectation of compute, written from the DESIGN Computation rules (not from Core's output).
function expected(rally) {
  const rows = rally.rows, ocf = +rally.ocf, cn = rally.cn * 60, spd = rally.speedo, ev = rally.taEvents || [];
  let leg = -1, start = 0;
  const L = rows.map((r, i) => { if (i === 0 || r.restart) { leg++; start = i; } return leg; });
  const legStart = rows.map((r, i) => { let j = i; while (j > 0 && L[j - 1] === L[i]) j--; return j; });
  const vm = rows.map(r => r.restart ? 0 : r.om == null ? null : r.om * ocf);
  const prevEnd = rows.map((r, i) => r.restart && i > 0 && r.om != null ? r.om * ocf : null);
  const ta = rows.map((r, i) => { for (let j = i; j >= 0 && L[j] === L[i]; j--) { const e = ev.find(e => String(e.ri) === String(rows[j].ri)); if (e) return e.ta; } return 0; });
  const tt = rows.map((r, i) => r.czt == null ? null : r.czt + cn + ta[i]);
  const est = rows.map((r, i) => {
    if (tt[i] != null || vm[i] == null || !spd) return null;
    for (let j = i - 1; j >= 0 && L[j] === L[i]; j--) if (tt[j] != null && vm[j] != null) return tt[j] + Math.max(0, vm[i] - vm[j]) / spd * 3600;
    return null; });
  const lim = rally.closeMi ?? 0.5, close = rows.map(() => false);
  for (let i = 0; i + 1 < rows.length; i++) {
    const bEnd = rows[i + 1].restart ? prevEnd[i + 1] : vm[i + 1];
    if (vm[i] == null || bEnd == null) continue;
    const g = bEnd - vm[i]; if (g < -1e-9) continue;
    if (g <= lim + 1e-9) close[i] = close[i + 1] = true; }
  return { L, legStart, vm, prevEnd, ta, tt, est, close };
}
function agree(rally, label) {
  const C = Core.compute(rally), E = expected(rally);
  rally.rows.forEach((r, i) => {
    const w = `${label} row ${i}`;
    assert.strictEqual(C[i].leg, String(rally.rows[E.legStart[i]].ri), w + ' leg');
    for (const k of ['vm', 'vmPrevEnd', 'tt', 'est']) {
      const want = { vm: E.vm, vmPrevEnd: E.prevEnd, tt: E.tt, est: E.est }[k][i];
      if (want == null) assert.strictEqual(C[i][k], null, `${w} ${k} should be null`); else near(C[i][k], want, 1e-6, `${w} ${k}`); }
    assert.strictEqual(C[i].ta, E.ta[i], w + ' ta');
    assert.strictEqual(C[i].close, E.close[i], w + ' close'); });
  return C;
}

// compute on the sample
const base = () => ({ cn: 12, ocf: 1.02, taEvents: [], speedo: 30, rows: Core.mergeRows([], SAMPLE.rows).rows });
let R = base(), C = agree(R, 'sample');
// rule 1: the first row starts leg 1; no row has leg null
assert.ok(C.every(c => c.leg != null), 'no row has leg null');
assert.strictEqual(C[0].leg, String(R.rows[0].ri)); assert.strictEqual(C[0].restart, true);
assert.strictEqual(C[0].vm, 0); assert.strictEqual(C[0].vmPrevEnd, null, 'no previous frame before the first row');
assert.strictEqual(new Set(C.map(c => c.leg)).size, 5, 'the sample has 5 legs');
assert.strictEqual(new Set(C.map(c => c.leg)).size, R.rows.filter(r => r.restart).length, 'one leg per restart');
// a later restart: VM 0 with the previous frame's end shown, TT = CZT + CN
const k2 = C.findIndex((c, i) => i > 0 && c.restart), r2 = R.rows[k2];
assert.strictEqual(C[k2].vm, 0); near(C[k2].vmPrevEnd, r2.om * 1.02, 1e-9, 'restart shows prior-frame VM');
assert.strictEqual(C[k2].leg, String(r2.ri));
assert.strictEqual(Core.fmtTOD(C[k2].tt), Core.fmtTOD(r2.czt + 12 * 60), 'TT = CZT + CN minutes');
// plain row: VM = OM x OCF
const kp = R.rows.findIndex(r => !r.restart && typeof r.om === 'number');
near(C[kp].vm, R.rows[kp].om * 1.02, 1e-9, 'VM = OM x OCF');
// the sample exercises estimates, a close pair across a restart, and a row with no OM (non-vacuous)
const kest = C.findIndex(c => c.est != null);
assert.ok(kest >= 0, 'sample has a row showing an estimate'); assert.strictEqual(R.rows[kest].czt, null);
assert.ok(C.some((c, i) => i > 0 && C[i].restart && C[i - 1].close && c.close && C[i - 1].gapNext <= 0.5 + 1e-9), 'sample has a close pair spanning a restart');
// rule 3: a row with no OM (the finish RI)
const kno = R.rows.findIndex(r => r.om == null);
assert.ok(kno >= 0, 'sample has a row with no OM');
assert.strictEqual(C[kno].vm, null); assert.strictEqual(C[kno].tt, null); assert.strictEqual(C[kno].est, null); assert.strictEqual(C[kno].close, false);
// OCF cancels: same estimate as official distance at true speed 30/1.02
{ const e = C.findIndex(c => c.estAnchor != null), a = R.rows.findIndex(r => r.ri === C[e].estAnchor), omA = R.rows[a].restart ? 0 : R.rows[a].om;
  near(C[e].est - C[a].tt, (R.rows[e].om - omA) / (30 / 1.02) * 3600, 1e-6, 'speedo affected by OCF'); }
// no speedo -> no estimates
assert.ok(Core.compute({ ...R, speedo: null }).every(c => c.est == null));

// operation: complete, TA, freeze, restart reset
assert.strictEqual(Core.activeIndex(R), 0);
R.rows = Core.completeActive(R, 1); R.rows = Core.completeActive(R, 2); R.rows = Core.completeActive(R, 3);
assert.strictEqual(Core.activeIndex(R), 3);
const kta = 3, lastOfLeg0 = R.rows.findIndex((r, i) => i > 0 && r.restart) - 1;
assert.strictEqual(Core.legOf(R, kta), C[kta].leg);
assert.strictEqual(Core.legOf(R, k2), String(r2.ri));
R.taEvents = Core.setTA(R, kta, 30, 10);                // TA +30 s entered on the 4th row
C = agree(R, 'TA');
assert.strictEqual(C[kta - 1].ta, 0, 'rows before the TA row unchanged'); assert.strictEqual(C[kta].ta, 30);
assert.strictEqual(C[kta].taSet, true); assert.strictEqual(C[lastOfLeg0].ta, 30, 'rest of leg gets TA');
assert.strictEqual(C[k2].ta, 0, 'a restart starts at TA 0');
// re-entering TA at the same row replaces it; a later TA replaces from its row on
R.taEvents = Core.setTA(R, kta, 20, 11);
assert.strictEqual(R.taEvents.length, 1);
R.taEvents = Core.setTA(R, kta + 2, 15, 12);
C = agree(R, 'TA2');
assert.strictEqual(C[kta + 1].ta, 20); assert.strictEqual(C[kta + 2].ta, 15); assert.strictEqual(C[lastOfLeg0].ta, 15);
// an estimate follows the TA
{ const Rt = base(); Rt.taEvents = Core.setTA(Rt, k2, 30);
  const Ct = agree(Rt, 'TA on a restart'), b = Core.compute(base()), e = Ct.findIndex((c, i) => i > k2 && c.estAnchor === Rt.rows[k2].ri);
  assert.ok(e > 0, 'an estimate is anchored on the restart row'); near(Ct[e].est - b[e].est, 30, 1e-6, 'estimate follows TA'); }
// un-completing an earlier row does not pull the TA back onto it
assert.strictEqual(Core.compute({ ...R, rows: Core.uncomplete(R, 1) })[1].ta, 0);
// a restart set on a later row is a new leg with TA 0
{ const R2 = base(), kr = 5; R2.rows = R2.rows.map((r, i) => i === kr ? { ...r, restart: true } : r);
  R2.taEvents = Core.setTA(R2, kta, 30);
  const C2 = agree(R2, 'restart added');
  assert.strictEqual(C2[kr - 1].ta, 30);
  assert.strictEqual(C2[kr].leg, String(R2.rows[kr].ri)); assert.strictEqual(C2[kr].ta, 0);
  assert.strictEqual(C2[kr].vm, 0);
  near(C2[kr + 1].vm, R2.rows[kr + 1].om * 1.02, 1e-9, 'VM keeps OM frame after restart'); }

// un-complete
const last = Core.lastCompleted(R);
assert.strictEqual(last, 2);
R.rows = Core.uncomplete(R, last);
assert.strictEqual(Core.activeIndex(R), 2);
assert.strictEqual(R.rows[2].ttDone, null);
assert.strictEqual(R.rows[0].ttDone, R.rows[0].czt + 12 * 60, 'TT recorded at completion');

// Undo picks by RI order, never by completion time (#40): the first row of a leg carries the LATEST doneAt
{ const Ru = base(), lo = 0, hi = Ru.rows.findIndex((r, i) => i > 0 && r.restart) - 1;   // first and last rows of leg 1
  assert.ok(hi > lo, 'leg 1 has more than one row');
  for (let k = lo; k <= hi; k++) Ru.rows[k] = { ...Ru.rows[k], done: true, ttDone: null, doneAt: 1000 + k };
  Ru.rows[lo].doneAt = 9999;                                       // earliest RI, most recent completion
  assert.strictEqual(Core.lastCompleted(Ru), hi, 'Undo selects the last completed RI in RI order');
  const before = JSON.stringify(Core.compute(Ru));
  Ru.rows = Ru.rows.map(r => ({ ...r, doneAt: null }));            // completion times feed nothing
  assert.strictEqual(JSON.stringify(Core.compute(Ru)), before, 'no logged time feeds compute');
  assert.strictEqual(Core.lastCompleted(Ru), hi);
  Ru.rows = Core.uncomplete(Ru, Core.lastCompleted(Ru));
  assert.strictEqual(Core.lastCompleted(Ru), hi - 1, 'the next Undo selects the previous RI in RI order');
  assert.strictEqual(Core.activeIndex(Ru), hi, 'the un-completed RI becomes active when it is the first uncompleted'); }
// RI order, not array order, when the rows have been left unsorted
{ const Ru = base(); Ru.rows = [Ru.rows[3], Ru.rows[1], Ru.rows[2]].map(r => ({ ...r, done: true }));
  assert.strictEqual(Core.lastCompleted(Ru), 0, 'unsorted rows: the highest RI is last'); }
assert.strictEqual(Core.lastCompleted({ rows: [] }), -1, 'nothing complete -> -1');

// rule 1: the first row need not be a restart; it starts leg 1 and keeps the printed-frame VM
{ const Rm = { cn: 0, ocf: 1, speedo: 60, taEvents: [], rows: Core.mergeRows([], [
    { ri: 5, om: 3, czt: '10:00:00' }, { ri: 6, om: 4 }, { ri: 7, om: '2.00/0.00', czt: '10:30:00' }, { ri: 8, om: 2.5 }]).rows };
  const Cm = agree(Rm, 'first row not a restart');
  assert.strictEqual(Cm[0].restart, false); assert.strictEqual(Cm[0].leg, '5'); assert.strictEqual(Cm[1].leg, '5');
  assert.strictEqual(Cm[2].leg, '7'); assert.ok(Cm.every(c => c.leg != null));
  near(Cm[0].vm, 3, 1e-9, 'VM = OM x OCF in the printed frame');
  near(Cm[1].est, T('10:01:00'), 1e-9, 'estimate in leg 1 from an earlier TT');
  assert.strictEqual(Core.legOf(Rm, 1), '5'); assert.strictEqual(Core.legOf(Rm, 3), '7');
  Rm.taEvents = Core.setTA(Rm, 0, 30);
  const Ct = Core.compute(Rm);
  assert.strictEqual(Ct[1].ta, 30, 'TA in leg 1'); assert.strictEqual(Ct[2].ta, 0, 'restart resets TA'); }
// rule 2: a bare /0.00 first row is a restart at OM 0.00
{ const Rb = { cn: 0, ocf: 1.01, speedo: 60, taEvents: [], rows: Core.mergeRows([], [{ ri: 5, om: '/0.00', czt: '10:00:00' }, { ri: 6, om: 1 }]).rows };
  const Cb = agree(Rb, 'bare restart');
  assert.strictEqual(Cb[0].restart, true); assert.strictEqual(Rb.rows[0].om, 0); assert.strictEqual(Cb[0].vm, 0); }
// rule 3: a row with no OM has no VM, TT, or estimate, is never close, and can be completed
{ const Rn = { cn: 0, ocf: 1, speedo: 60, taEvents: [], rows: Core.mergeRows([], [
    { ri: 1, om: '/0.00', czt: '10:00:00' }, { ri: 2, om: 0.2 }, { ri: 3, om: null, instr: 'finish' }, { ri: 4, om: 0.3 }]).rows };
  const Cn = Core.compute(Rn);
  assert.strictEqual(Cn[2].vm, null); assert.strictEqual(Cn[2].tt, null); assert.strictEqual(Cn[2].est, null);
  assert.strictEqual(Cn[2].close, false); assert.strictEqual(Cn[2].gapNext, null);
  assert.strictEqual(Cn[3].close, false, 'a neighbour of a no-OM row is not close because of it');
  assert.strictEqual(Cn[1].close, true, 'rows with OMs still close to each other');
  Rn.rows = Core.completeActive(Rn, 1); Rn.rows = Core.completeActive(Rn, 2);
  assert.strictEqual(Core.activeIndex(Rn), 2);
  Rn.rows = Core.completeActive(Rn, 3);
  assert.strictEqual(Rn.rows[2].done, true); assert.strictEqual(Rn.rows[2].ttDone, null); assert.strictEqual(Core.activeIndex(Rn), 3); }

// close rows (VM gap <= the limit; DESIGN Computation)
{ const Cc = agree(base(), 'close 0.5');
  assert.ok(Cc.some(c => c.close) && Cc.some(c => !c.close), 'close flags are mixed on the sample');
  const c3 = agree({ ...base(), closeMi: 0.3 }, 'close 0.3');
  assert.ok(c3.filter(c => c.close).length < Cc.filter(c => c.close).length, 'a tighter limit flags fewer rows');
  // gap into a restart runs to the previous frame's end
  const i = Cc.findIndex((c, k) => k > 0 && c.restart);
  near(Cc[i - 1].gapNext, base().rows[i].om * 1.02 - Cc[i - 1].vm, 1e-9, 'gap into a restart uses previous-frame end');
  assert.strictEqual(Core.closeMi({ closeMi: '' }), 0.5); assert.strictEqual(Core.closeMi({ closeMi: 0.25 }), 0.25); }

// estimate locks: only on completion
{ const Rd = base(), e = Core.compute(Rd).findIndex(c => c.estLive != null);
  Rd.rows = Rd.rows.map((r, k) => k < e ? { ...r, done: true } : r);     // active = the first estimate row
  const e30 = Core.compute(Rd)[e].estLive;
  Rd.speedo = 45; assert.notStrictEqual(Core.compute(Rd)[e].est, e30, 'uncompleted est follows speedo');
  Rd.speedo = 30;
  Rd.rows = Core.completeActive(Rd, 5);
  assert.strictEqual(Rd.rows[e].estLock, e30); assert.strictEqual(Rd.rows[e].ttDone, null);
  Rd.speedo = 50; Rd.taEvents = Core.setTA(Rd, e - 1, 20);
  let c = Core.compute(Rd)[e];
  assert.strictEqual(c.estLocked, true); assert.strictEqual(c.est, e30, 'completed est frozen (speedo and TA)');
  Rd.rows = Core.uncomplete(Rd, e);
  c = Core.compute(Rd)[e];
  assert.strictEqual(c.estLocked, false); assert.strictEqual(c.est, c.estLive);
  // an old v2 tap lock on an uncompleted row is ignored
  Rd.rows[e + 1] = { ...Rd.rows[e + 1], estLock: 1 };
  assert.strictEqual(Core.compute(Rd)[e + 1].estLocked, false);
  // legacy row fields showEst and estLockBy are dropped; lockEst and unlockEst no longer exist
  const leg = { ri: 1, om: 1, showEst: true, estLockBy: 'tap', estLock: 5 };
  const n = Core.normRow(leg); assert.ok(!('showEst' in n) && !('estLockBy' in n), 'normRow drops legacy fields');
  const m = Core.mergeRows([{ ...Core.normRow({ ri: 1, om: 1 }), estLock: 5 }], [leg]).rows[0];
  assert.ok(!('showEst' in m) && !('estLockBy' in m), 'mergeRows drops legacy fields');
  const x = Core.completeActive(Rd, 5), u = Core.uncomplete(Rd, e);
  assert.ok(![...x, ...u].some(r => 'showEst' in r || 'estLockBy' in r), 'complete and uncomplete write no legacy fields');
  assert.strictEqual(Core.lockEst, undefined); assert.strictEqual(Core.unlockEst, undefined); }
// CSV
const csv = Core.toCSV({ ...R, name: SAMPLE.rally.name, crew: { driver: 'Jane Driver', navigator: 'John Navigator', passengers: [] } });
assert.ok(csv.includes(`${r2.ri},Y,${r2.om.toFixed(2)}/0.00,${(r2.om * 1.02).toFixed(2)}/0.00,${Core.fmtTOD(r2.czt)}`), 'CSV restart row');
{ const p = R.rows[kp]; assert.ok(csv.includes(`${p.ri},,${p.om.toFixed(2)},${(p.om * 1.02).toFixed(2)},`), 'CSV plain row'); }
assert.ok(csv.includes(`${R.rows[0].ri},Y,0.00/0.00,0.00,`), 'CSV first row is a restart at OM 0.00 with no previous frame');
assert.ok(csv.includes(`${R.rows[kno].ri},,,,`), 'CSV row with no OM has empty OM and VM');
// CSV import: an export re-imports by header name (a restart OM carries the restart); text with no RI header line finds no rows
{ const rows = Core.parseCSV(csv);
  assert.strictEqual(rows.length, R.rows.length, 'exported CSV re-imports every row');
  const norm = R.rows.map(x => Core.normRow(x)), back = rows.map(x => Core.normRow(x));
  norm.forEach((n, i) => { const b = back[i];
    assert.deepStrictEqual([b.ri, b.om, b.restart, b.czt, b.cp, b.instr, b.info], [n.ri, n.om, n.restart, n.czt, n.cp, n.instr, n.info], 'CSV round trip row ' + i); }); }
{ const q = Core.parseCSV('Rally,"A, B"\n\nRI,Restart,OM,Instruction,Info\n7,,1.25,"Left, then ""right""\nnext line",ok\n');
  assert.strictEqual(q.length, 1);
  assert.deepStrictEqual([q[0].ri, q[0].om, q[0].instr, q[0].info], ['7', '1.25', 'Left, then "right"\nnext line', 'ok'], 'quoted commas, quotes, and newlines'); }
{ const b = Core.parseCSV('RI,OM,CZT,CP,Instruction,Info\n210,1.50,,,"R at [sign]",note\n211,1.70,16:20:00,90,CHECKPOINT,');
  assert.deepStrictEqual(b.map(x => [x.ri, x.om, x.czt, x.cp, x.instr]), [['210', '1.50', null, null, 'R at [sign]'], ['211', '1.70', '16:20:00', '90', 'CHECKPOINT']], 'bare lines with a header'); }
assert.strictEqual(Core.parseCSV('210,1.50,,,x,y').length, 0, 'lines without a header line find no rows');
assert.strictEqual(Core.parseCSV('```json\n[{"ri":1,"om":"2.29","czt":null},\n {"ri":2,"om":"3.10","czt":null}]\n```').length, 0, 'pasted JSON finds no rows');
assert.strictEqual(Core.parseCSV('Here are the rows, and a few more, thanks.').length, 0, 'prose finds no rows');
assert.strictEqual(Core.parseCSV('').length, 0, 'empty text finds no rows');
// Vehicle (DESIGN Scope and Storage): a CSV details line directly after the crew lines, quoted like any field, written even when empty
{ const crew = { driver: 'Jane Driver', navigator: 'John Navigator', passengers: ['Pat Example'] };
  const lines = s => s.split('\n');
  const vcsv = Core.toCSV({ ...R, crew, vehicle: 'Blue hatchback, "test"' });
  const L = lines(vcsv), iv = L.findIndex(l => l.startsWith('Vehicle,'));
  assert.strictEqual(L[iv], 'Vehicle,"Blue hatchback, ""test"""', 'Vehicle value is CSV-quoted');
  assert.ok(L[iv - 1].startsWith('Passengers,'), 'Vehicle line directly follows the crew lines');
  assert.ok(iv < L.findIndex(l => l.startsWith('RI,')), 'Vehicle line is above the RI header');
  for (const v of [undefined, '']) {
    const e = lines(Core.toCSV({ ...R, crew, vehicle: v }));
    assert.ok(e.includes('Vehicle,'), 'Vehicle line is present with an empty value'); }
  const strip = s => lines(s).filter(l => !l.startsWith('Vehicle,')).join('\n');
  assert.deepStrictEqual(Core.parseCSV(vcsv), Core.parseCSV(strip(vcsv)), 'parseCSV ignores the Vehicle line'); }
// OCR parse
assert.strictEqual(Core.parseOCR('```json\n[{"ri":1}]\n```').length, 1);
assert.strictEqual(Core.parseOCR('Here: {"rows":[{"ri":1},{"ri":2}]}').length, 2);
assert.strictEqual(Core.parseOCR('Row 3 reads [curve-left sign]. Here it is:\n[{"ri":3,"instr":"at [sign]"}]\nDone.').length, 1);
assert.strictEqual(Core.parseOCR('Page 1:\n```json\n[{"ri":1}]\n```\nPage 2:\n```json\n[{"ri":2},{"ri":3}]\n```').length, 3);
assert.strictEqual(Core.parseOCR('[]').length, 0);
// #36: a fenced block that isn't JSON is skipped; the valid blocks still count
{ const rows = Core.parseOCR('Note:\n```text\nRI 1 is hard to read, sorry\n```\nRows:\n```json\n[{"ri":4},{"ri":5}]\n```');
  assert.deepStrictEqual(rows.map(x => x.ri), [4, 5], 'a non-JSON fence before a valid json block is skipped'); }
{ const rows = Core.parseOCR('```json\n[{"ri":1}]\n```\n```python\nprint(1)\n```\n```json\n[{"ri":2}]\n```');
  assert.deepStrictEqual(rows.map(x => x.ri), [1, 2], 'a non-JSON fence between valid blocks is skipped and the valid blocks are combined'); }
assert.strictEqual(Core.parseOCR('```text\nnot rows\n```').length, 0, 'a reply with no valid block finds no rows');
assert.strictEqual(Core.parseOCR('no JSON here at all').length, 0, 'prose with no JSON finds no rows');

// renameRI moves the row's TA events; rejected renames leave them alone
{ const Rr = base(), C0 = Core.compute(Rr);
  const k = Rr.rows.findIndex((x, i) => !C0[i].restart && Rr.rows.slice(i + 1).some((y, j) => y.czt != null && !C0[i + 1 + j].restart));
  assert.ok(k >= 0, 'sample has a non-restart row followed by a CZT row');
  const old = Rr.rows[k].ri;
  Rr.taEvents = Core.setTA(Rr, k, 30, 7);
  const other = Core.setTA({ rows: Rr.rows, taEvents: Rr.taEvents }, 0, 5, 8);
  const nr = old + 'x', res = Core.renameRI(Rr, k, ' ' + nr + ' ');
  assert.ok(res.ok); assert.strictEqual(res.ri, nr);
  assert.deepStrictEqual(res.taEvents, [{ ri: nr, ta: 30, at: 7 }], 'event moved, ta and at kept');
  assert.deepStrictEqual(Rr.taEvents, [{ ri: old, ta: 30, at: 7 }], 'input not mutated');
  const Rn = { ...Rr, rows: Rr.rows.map((x, i) => i === k ? { ...x, ri: res.ri } : x), taEvents: res.taEvents };
  const Rd = { ...Rn, taEvents: [{ ri: nr, ta: 30, at: null }] };
  assert.deepStrictEqual(Core.compute(Rn).map(c => c.tt), Core.compute(Rd).map(c => c.tt), 'TTs match a TA set directly on the renamed row');
  assert.strictEqual(Core.compute(Rn)[k].ta, 30);
  assert.strictEqual(Core.renameRI({ ...Rr, taEvents: other }, k, nr).taEvents.filter(e => e.ri === 0 || e.ri === Rr.rows[0].ri).length, 1, 'other rows events untouched');
  const blank = Core.renameRI(Rr, k, '  '); assert.ok(!blank.ok); assert.strictEqual(blank.taEvents, Rr.taEvents);
  const dup = Core.renameRI(Rr, k, String(Rr.rows[k + 1].ri)); assert.ok(!dup.ok); assert.strictEqual(dup.taEvents, Rr.taEvents);
  const num = Core.renameRI({ rows: [{ ri: 'a1' }, { ri: 9 }], taEvents: [{ ri: 'a1', ta: 1, at: 0 }] }, 0, '5');
  assert.strictEqual(num.ri, 5); assert.strictEqual(num.taEvents[0].ri, 5); }

// CSV writes OCF with four decimals, like the Setup tab and the Data summary (#39)
{ const R = { ...SAMPLE.rally, rows: Core.mergeRows([], SAMPLE.rows).rows, taEvents: [] };
  const line = Core.toCSV(R, 'hms').split(String.fromCharCode(10)).find(l => l.startsWith('OCF,'));
  assert.strictEqual(line, 'OCF,' + (+R.ocf).toFixed(4), 'CSV OCF line has four decimals');
  const R1 = { ...R, ocf: 1 };
  assert.strictEqual(Core.toCSV(R1, 'hms').split(String.fromCharCode(10)).find(l => l.startsWith('OCF,')), 'OCF,' + (1).toFixed(4), 'OCF 1 is written as four decimals');
  assert.strictEqual(Core.fmtOCF(''), '', 'a blank OCF stays blank'); }

// Guard (DESIGN § Testing): the built page makes no claude.ai artifact-runtime calls. Needs `python build.py` first.
{ const fs = require('fs'), path = require('path');
  const built = path.join(__dirname, '..', 'dist', 'index.html');
  assert.ok(fs.existsSync(built), 'dist/index.html is missing: run build.py before the unit tests');
  const html = fs.readFileSync(built, 'utf8');
  for (const id of ['window.claude', 'claude.use', 'useCap', 'hasClaude', 'caps.sample', 'caps.db', 'caps.downloads', 'Cloud.', 'data/users', 'SELF_HTML', '__REMOTE__', 'rally-route-instructions.html'])
    assert.ok(!html.includes(id), `the built page still contains the removed runtime identifier ${id}`); }

console.log('core tests: all passed');
