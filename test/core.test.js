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
assert.strictEqual(Core.parseRel('+1:05'), 65);
assert.strictEqual(Core.parseRel('-12'), -12);
assert.strictEqual(Core.parseRel('.50m'), 30);
assert.strictEqual(Core.parseRel(''), 0);
assert.strictEqual(Core.parseRel('abc'), null);
assert.strictEqual(Core.fmtRel(-65), '-1:05');

// normalise "/0.00"
let n = Core.normRow({ ri: '42', om: '8.55/0.00', czt: '09:12:00' });
assert.strictEqual(n.ri, 42); assert.strictEqual(n.om, 8.55); assert.strictEqual(n.restart, true);
n = Core.normRow({ ri: 1, om: '/0.00' }); assert.strictEqual(n.restart, true); assert.strictEqual(n.om, null);

// merge + sort: shuffled input, then a page re-read replaces text but keeps completion
let m = Core.mergeRows([], SAMPLE.slice(8).concat(SAMPLE.slice(0, 8)));
assert.strictEqual(m.added, 17);
assert.deepStrictEqual(m.rows.map(r => r.ri), SAMPLE.map(r => r.ri));
m.rows[0].done = true;
m = Core.mergeRows(m.rows, [{ ri: 41, om: 8.43, instr: 'fixed' }, { ri: '54A', om: 7.40, instr: 'inserted' }]);
assert.strictEqual(m.replaced, 1); assert.strictEqual(m.added, 1);
assert.strictEqual(m.rows[0].done, true); assert.strictEqual(m.rows[0].om, 8.43);
assert.strictEqual(m.rows.findIndex(r => r.ri === '54A'), m.rows.findIndex(r => r.ri === 54) + 1);

// compute
const base = () => ({ cn: 12, ocf: 1.02, taEvents: [], speedo: 30, rows: Core.mergeRows([], SAMPLE).rows });
let R = base(), C = Core.compute(R);
assert.strictEqual(C[0].restart, false, 'first row is not forced to be a restart');
assert.strictEqual(C[0].leg, null);
near(C[0].vm, 8.42 * 1.02, 1e-9, 'mid-rally start: VM = OM x OCF in the printed frame');
assert.strictEqual(C[1].restart, true); assert.strictEqual(C[1].leg, '42');
assert.strictEqual(C[1].vm, 0); near(C[1].vmPrevEnd, 8.55 * 1.02, 1e-9, 'restart shows prior-frame VM');
near(C[3].vm, 1.90 * 1.02, 1e-9, 'VM = OM x OCF');
assert.strictEqual(Core.fmtTOD(C[1].tt), '09:24:00', 'TT = CZT + CN minutes');
assert.strictEqual(Core.fmtTOD(C[3].tt), '09:26:30');
assert.strictEqual(C[0].tt, null);

// estimator: RI 43 anchored on RI 42 (VM 0), dVM = .62*1.02 at speedo 30 (vehicle mph)
near(C[2].est, T('09:24:00') + 0.62 * 1.02 / 30 * 3600, 1e-6, 'estimate RI 43');
assert.strictEqual(C[2].estAnchor, 42);
// RI 48 anchors on CP 25 (RI 47)
near(C[7].est, T('09:30:00') + (4.03 - 3.88) * 1.02 / 30 * 3600, 1e-6, 'estimate RI 48');
assert.strictEqual(C[7].estAnchor, 47);
// OCF cancels: same estimate as official distance at true speed 30/1.02
near(C[7].est - C[6].tt, (4.03 - 3.88) / (30 / 1.02) * 3600, 1e-6, 'speedo affected by OCF');
// RI 41 (first leg, no TT before it) has no estimate
assert.strictEqual(C[0].est, null);
// no speedo -> no estimates
assert.strictEqual(Core.compute({ ...R, speedo: null })[2].est, null);

// operation: complete, TA, freeze, restart reset
assert.strictEqual(Core.activeIndex(R), 0);
R.rows = Core.completeActive(R, 1); R.rows = Core.completeActive(R, 2); R.rows = Core.completeActive(R, 3);
assert.strictEqual(Core.activeIndex(R), 3);
assert.strictEqual(Core.legOf(R, 3), '42');
R.taEvents = Core.setTA(R, 3, 30, 10);                  // TA +30 s entered while on RI 44
C = Core.compute(R);
assert.strictEqual(Core.fmtTOD(C[1].tt), '09:24:00', 'rows before the TA row unchanged');
assert.strictEqual(C[2].ta, 0);
assert.strictEqual(Core.fmtTOD(C[3].tt), '09:27:00', 'TA row gets TA'); assert.strictEqual(C[3].taSet, true);
assert.strictEqual(Core.fmtTOD(C[12].tt), '09:34:45', 'rest of leg gets TA');
near(C[7].est, T('09:30:30') + (4.03 - 3.88) * 1.02 / 30 * 3600, 1e-6, 'estimate follows TA');
// re-entering TA at the same row replaces it; a later TA replaces from its row on
R.taEvents = Core.setTA(R, 3, 20, 11);
assert.strictEqual(R.taEvents.length, 1);
R.taEvents = Core.setTA(R, 5, -15, 12);
C = Core.compute(R);
assert.strictEqual(C[4].ta, 20); assert.strictEqual(C[5].ta, -15); assert.strictEqual(C[16].ta, -15);
// un-completing an earlier row does not pull the TA back onto it
assert.strictEqual(Core.compute({ ...R, rows: Core.uncomplete(R, 1) })[1].ta, 0);
// a later restart is a new leg with TA 0
const R2 = base(); R2.rows = R2.rows.map(r => r.ri === 50 ? { ...r, restart: true } : r);
R2.taEvents = Core.setTA(R2, 3, 30);
C = Core.compute(R2);
assert.strictEqual(C[8].ta, 30);
assert.strictEqual(C[9].leg, '50'); assert.strictEqual(C[9].ta, 0);
assert.strictEqual(Core.fmtTOD(C[9].tt), '09:32:30', 'TA zero after restart');
assert.strictEqual(C[9].vm, 0);
near(C[10].vm, 6.40 * 1.02, 1e-9, 'VM keeps OM frame after restart');

// un-complete
const last = Core.lastCompleted(R);
assert.strictEqual(last, 2);
R.rows = Core.uncomplete(R, last);
assert.strictEqual(Core.activeIndex(R), 2);
assert.strictEqual(R.rows[2].ttDone, null);
assert.strictEqual(R.rows[1].ttDone, T('09:24:00'), 'TT recorded at completion');

// first-row restart only if printed so
assert.strictEqual(Core.compute({ ...base(), rows: Core.mergeRows([], [{ ri: 5, om: '/0.00', czt: '10:00:00' }, { ri: 6, om: 1 }]).rows })[0].restart, true);
// legs before the first restart still estimate from an earlier TT in that leg
{ const Rm = { cn: 0, ocf: 1, speedo: 60, taEvents: [], rows: Core.mergeRows([], [{ ri: 1, om: 5, czt: '10:00:00' }, { ri: 2, om: 6 }]).rows };
  near(Core.compute(Rm)[1].est, T('10:01:00'), 1e-9, 'estimate in unnamed first leg'); }

// close rows (VM gap <= 0.5)
{ const Cc = Core.compute(base());
  const close = Cc.filter(c => c.close).map(c => c.ri);
  assert.deepStrictEqual(close, [41, 42, 44, 45, 47, 48, 51, 52, 53, 54, 55, 56]);
  near(Cc[0].gapNext, 0.13 * 1.02, 1e-9, 'gap into a restart uses previous-frame end');
  const c3 = Core.compute({ ...base(), closeMi: 0.3 }).filter(c => c.close).map(c => c.ri);
  assert.deepStrictEqual(c3, [41, 42, 47, 48, 52, 53, 54, 55], 'settable limit');
  assert.strictEqual(Core.closeMi({ closeMi: '' }), 0.5); assert.strictEqual(Core.closeMi({ closeMi: 0.25 }), 0.25); }

// estimate locks: only on completion
{ const Rd = base(); Rd.rows = Rd.rows.map((r, k) => k < 7 ? { ...r, done: true } : r);   // active = RI 48
  const e30 = Core.compute(Rd)[7].estLive;
  Rd.speedo = 45; assert.notStrictEqual(Core.compute(Rd)[7].est, e30, 'uncompleted est follows speedo');
  Rd.speedo = 30;
  Rd.rows = Core.completeActive(Rd, 5);
  assert.strictEqual(Rd.rows[7].estLock, e30); assert.strictEqual(Rd.rows[7].ttDone, null);
  Rd.speedo = 50; Rd.taEvents = Core.setTA(Rd, 6, 20);
  let c = Core.compute(Rd)[7];
  assert.strictEqual(c.estLocked, true); assert.strictEqual(c.est, e30, 'completed est frozen (speedo and TA)');
  Rd.rows = Core.uncomplete(Rd, 7);
  c = Core.compute(Rd)[7];
  assert.strictEqual(c.estLocked, false); assert.strictEqual(c.est, c.estLive);
  // an old v2 tap lock on an uncompleted row is ignored
  Rd.rows[8] = { ...Rd.rows[8], estLock: 1, estLockBy: 'tap' };
  assert.strictEqual(Core.compute(Rd)[8].estLocked, false); }
// CSV
const csv = Core.toCSV({ ...R, name: 'Desert Loop', crew: { driver: 'Bob', navigator: 'Sue', passengers: [] } });
assert.ok(csv.includes('42,Y,8.55/0.00,8.72/0.00,09:12:00'), 'CSV restart row');
assert.ok(csv.includes('41,,8.42,8.59,'), 'CSV first row not a restart');
// OCR parse
assert.strictEqual(Core.parseOCR('```json\n[{"ri":1}]\n```').length, 1);
assert.strictEqual(Core.parseOCR('Here: {"rows":[{"ri":1},{"ri":2}]}').length, 2);
assert.strictEqual(Core.parseOCR('Row 3 reads [curve-left sign]. Here it is:\n[{"ri":3,"instr":"at [sign]"}]\nDone.').length, 1);
assert.strictEqual(Core.parseOCR('Page 1:\n```json\n[{"ri":1}]\n```\nPage 2:\n```json\n[{"ri":2},{"ri":3}]\n```').length, 3);
assert.strictEqual(Core.parseOCR('[]').length, 0);

console.log('core tests: all passed');
