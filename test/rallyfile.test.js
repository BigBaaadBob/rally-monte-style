// Unit tests for src/rallyfile.js (docs/RALLY-FILE.md): zip read and write, encode, decode, validation, and the load notice.
// Expected values come from the spec and from Core, never from current output.
'use strict';
const assert = require('assert');
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const Core = require('../src/core.js'), RF = require('../src/rallyfile.js'), SAMPLE = require('../src/sample.js');

const enc = s => new TextEncoder().encode(s);
const JPG = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 1, 2, 3, 4, 5]);
const PNG = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 9, 9, 9]);

// A zip builder for the tests: stored or deflate entries, with the header fields the reader must reject set on request.
function buildZip(entries, o = {}) {
  const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const chunks = [], cd = []; let off = 0;
  for (const e of entries) {
    const name = enc(e.name), data = e.data, method = e.method ?? 0, body = method === 8 ? zlib.deflateRawSync(data) : data, crc = e.crc ?? RF.crc32(data), flags = e.flags ?? 0;
    const lh = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(body.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
    chunks.push(lh, name, body);
    cd.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(flags), ...u16(method), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(body.length), ...u32(data.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
    off += lh.length + name.length + body.length;
  }
  const cdSize = cd.reduce((n, c) => n + c.length, 0), n = o.count ?? entries.length;
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(n), ...u16(n), ...u32(o.cdSize ?? cdSize), ...u32(o.cdOff ?? off), ...u16(0)]);
  const all = [...chunks, ...cd, ...(o.zip64 ? [new Uint8Array([0x50, 0x4b, 6, 7, ...new Array(16).fill(0)])] : []), end], out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let p = 0; for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}
const docOf = (o = {}) => ({ format: 'rally-monte-style', version: 1, rally: {}, ris: [], ...o });
const fileOf = (doc, extra = [], method = 0) => buildZip([{ name: 'rally.json', data: enc(typeof doc === 'string' ? doc : JSON.stringify(doc)), method }, ...extra]);
const rejects = async (bytes, re, msg) => { try { await RF.decode(bytes); } catch (e) { assert.ok(e instanceof RF.RallyFileError, msg + ': a RallyFileError, got ' + e); assert.ok(re.test(e.message), `${msg}: message "${e.message}" should match ${re}`); return; } assert.fail(msg + ': was not rejected'); };
const round3 = v => Array.isArray(v) ? v.map(round3) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round3(x)])) : typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;

(async () => {
  // ---- zip ----
  assert.strictEqual(RF.crc32(enc('123456789')), 0xCBF43926, 'CRC-32 check value');
  { const z = RF.zipWrite([{ name: 'a.txt', data: enc('hello') }, { name: 'dir/b.bin', data: new Uint8Array([1, 2, 3]) }]);
    const m = RF.zipOpen(z);
    assert.deepStrictEqual([...m.keys()], ['a.txt', 'dir/b.bin']);
    assert.deepStrictEqual([...await RF.zipRead(z, m.get('dir/b.bin'))], [1, 2, 3], 'stored entry reads back');
    assert.strictEqual(new TextDecoder().decode(await RF.zipRead(z, m.get('a.txt'))), 'hello'); }
  { const big = enc('x'.repeat(5000) + 'end'), z = buildZip([{ name: 'd.txt', data: big, method: 8 }, { name: 'e.txt', data: enc('s') }]);
    const m = RF.zipOpen(z);
    assert.ok(m.get('d.txt').csize < big.length, 'the test entry really is compressed');
    assert.deepStrictEqual(await RF.zipRead(z, m.get('d.txt')), big, 'a deflate entry reads back'); }
  { const z = buildZip([{ name: 'a.txt', data: enc('hello'), crc: 123 }]);
    await rejects(fileOf('{}', [{ name: 'x', data: enc('a'), crc: 1 }]).slice(0, 10), /not a rally file/, 'a truncated file is not a zip');
    try { await RF.zipRead(z, RF.zipOpen(z).get('a.txt')); assert.fail('bad CRC'); } catch (e) { assert.ok(/checksum/.test(e.message), 'a wrong CRC is damaged'); } }
  { const z = RF.zipWrite([{ name: 'A.txt', data: enc('1') }, { name: 'x\\y.txt', data: enc('2') }, { name: './z.txt', data: enc('3') }]), m = RF.zipOpen(z);
    assert.ok(m.has('A.txt') && !m.has('a.txt'), 'names are case-sensitive');
    assert.ok(m.has('x/y.txt') && m.has('z.txt'), 'a backslash is /, and a leading ./ is dropped'); }

  // ---- version, format, and every rejection (docs/RALLY-FILE.md § What is rejected) ----
  await rejects(enc('not a zip at all'), /not a rally file.*not a zip/, 'not a zip');
  await rejects(enc(JSON.stringify({ app: 'rally-monte-style', version: 1, rally: { rows: [] } })), /earlier version.*JSON export.*cannot load/, 'an old JSON export has its own message');
  await rejects(enc('[1, 2]'), /earlier version.*JSON/, 'any JSON text gets that message');
  await rejects(enc('{"broken'), /not a zip/, 'broken JSON text is just not a zip');
  await rejects(new Uint8Array(RF.MAX_BYTES + 1), /over 50 MB/, 'over 50 MB');
  await rejects(buildZip([{ name: 'other.json', data: enc('{}') }]), /no rally\.json/, 'no rally.json');
  await rejects(buildZip([]), /no rally\.json/, 'an empty zip');
  await rejects(buildZip([{ name: 'sub/rally.json', data: enc(JSON.stringify(docOf())) }]), /no rally\.json/, 'rally.json must be at the root');
  await rejects(fileOf('{ "format": '), /rally\.json is not valid JSON/, 'rally.json does not parse');
  await rejects(fileOf('[]'), /does not hold a JSON object/, 'rally.json is not an object');
  await rejects(fileOf(docOf({ format: 'other' })), /format must be/, 'wrong format');
  await rejects(fileOf({ version: 1, rally: {}, ris: [] }), /format must be/, 'missing format');
  for (const v of [undefined, '1', 1.5, 0, -1, null]) await rejects(fileOf(docOf({ version: v })), /no valid version/, 'version ' + JSON.stringify(v));
  await rejects(fileOf(docOf({ version: 2 })), /newer version.*file version 2.*reads up to 1/, 'a higher version');
  for (const v of [undefined, null, [], 'x', 5]) await rejects(fileOf(docOf({ rally: v })), /“rally” must be an object/, 'rally ' + JSON.stringify(v));
  for (const v of [undefined, null, {}, 'x']) await rejects(fileOf(docOf({ ris: v })), /“ris” must be a list/, 'ris ' + JSON.stringify(v));
  for (const v of [{}, 'x', 3]) await rejects(fileOf(docOf({ ta: v })), /“ta” must be a list/, 'ta ' + JSON.stringify(v));
  for (const v of [null, 5, 'x', []]) await rejects(fileOf(docOf({ ris: [{ ri: 1 }, v] })), /item 2 of “ris” must be an object/, 'an RI item ' + JSON.stringify(v));
  for (const v of ['signs/1.jpg', {}, [1], [null], ['a', 2]]) await rejects(fileOf(docOf({ ris: [{ ri: 1, signs: v }] })), /“signs” of item 1.*list of paths/, 'signs ' + JSON.stringify(v));
  await rejects(buildZip([{ name: 'rally.json', data: enc('{}'), flags: 1 }]), /zip feature.*encrypted/, 'an encrypted entry');
  await rejects(buildZip([{ name: 'rally.json', data: enc('{}') }], { zip64: true }), /zip feature.*ZIP64/, 'a ZIP64 locator');
  await rejects(buildZip([{ name: 'rally.json', data: enc('{}') }], { count: 0xFFFF }), /ZIP64/, 'a ZIP64 entry count');
  { const z = buildZip([{ name: 'rally.json', data: enc('{}'), method: 8 }]), m = RF.zipOpen(z); assert.strictEqual(m.get('rally.json').method, 8);
    const bad = buildZip([{ name: 'rally.json', data: enc('{}') }]);
    const cd = bad.length - 22 - (46 + 10); new DataView(bad.buffer).setUint16(cd + 10, 12, true);       // central directory: method 12 (bzip2)
    await rejects(bad, /zip feature.*compression method 12/, 'an unsupported compression method'); }
  await rejects(buildZip([{ name: 'rally.json', data: enc(JSON.stringify(docOf())), crc: 5 }]), /damaged.*checksum/, 'a bad checksum in rally.json');
  await rejects(buildZip([{ name: 'rally.json', data: enc('{}') }], { cdOff: 3 }), /damaged/, 'a broken zip directory');

  // ---- an empty rally loads, with every default ----
  { const d = await RF.decode(fileOf(docOf()));
    assert.deepStrictEqual([d.kind, d.rally, d.rows, d.ta, d.problems, d.images.size], [null, {}, [], [], [], 0], 'a file with only the required fields'); }

  // ---- unknown fields are ignored at every level; deflate and stored both load ----
  for (const method of [0, 8]) {
    const d = await RF.decode(fileOf(docOf({ future: 1, kind: 'saved', savedAt: '2026-01-01T00:00:00Z', rally: { name: 'N', extra: [1], id: 'r1' },
      ris: [{ ri: 1, om: '1.00', instruction: 'x', mystery: true, band: { page: 'p', top: 0.1, bottom: 0.2, left: 0, right: 1 }, imgCheck: 'p' }], ta: [{ ri: 1, ta: '0:30', extra: 1 }] }), [], method));
    assert.deepStrictEqual(d.problems, [], 'unknown fields are not problems');
    assert.strictEqual(d.rally.name, 'N');
    assert.ok(!('mystery' in d.rows[0]) && !('extra' in d.rally), 'unknown fields are not carried');
    assert.ok(d.rows[0].band === null && d.rows[0].imgCheck === null, 'bands and imgCheck in a file are ignored');
    assert.deepStrictEqual(d.ta, [{ ri: 1, ta: 30, at: null }]); }

  // ---- kind ----
  for (const [k, want, prob] of [['saved', 'saved', 0], ['distributed', 'distributed', 0], [undefined, null, 0], ['pocket', null, 1], [7, null, 1]]) {
    const d = await RF.decode(fileOf(docOf({ kind: k })));
    assert.strictEqual(d.kind, want, 'kind ' + k); assert.strictEqual(d.problems.filter(p => p.type === 'kind').length, prob, 'kind notice ' + k); }

  // ---- rally fields: the mapping, and the Setup rules ----
  { const d = await RF.decode(fileOf(docOf({ rally: { id: 'r-1_A', name: 'Spring', date: '2026-05-02', driver: 'Jane Driver', navigator: 'John Navigator', passengers: ['A', 'B'],
      vehicle: 'Rally Car', carNumber: 12, class: 'B', ocf: 1.0123, closeLimitMi: 0.25, speedometer: 42 } })));
    assert.deepStrictEqual(d.rally, { id: 'r-1_A', name: 'Spring', date: '2026-05-02', crew: { driver: 'Jane Driver', navigator: 'John Navigator', passengers: ['A', 'B'] },
      vehicle: 'Rally Car', cn: 12, cls: 'B', ocf: 1.0123, closeMi: 0.25, speedo: 42 }, 'field names map as in the spec'); assert.deepStrictEqual(d.problems, []); }
  { const d = await RF.decode(fileOf(docOf({ rally: { carNumber: '', class: '', ocf: '1.02', closeLimitMi: '', speedometer: '35.04' } })));
    assert.deepStrictEqual([d.rally.cn, 'cls' in d.rally, d.rally.ocf, d.rally.closeMi, d.rally.speedo], ['', false, 1.02, Core.CLOSE_MI, 35], 'text values, blanks, and an empty class'); assert.deepStrictEqual(d.problems, []); }
  { const bad = { id: '__proto__', name: 5, date: '2026-13-45', driver: [], navigator: {}, passengers: ['ok', 3], vehicle: false, carNumber: 1000, class: 'Z', ocf: 0, closeLimitMi: 6, speedometer: 0 };
    const d = await RF.decode(fileOf(docOf({ rally: bad })));
    assert.deepStrictEqual(d.rally, { crew: { passengers: ['ok'] } }, 'every bad value is left out; a passenger that is not text is dropped');
    assert.deepStrictEqual(d.problems.map(p => p.field).sort(), ['OCF', 'car number', 'class', 'close limit', 'date', 'driver', 'id', 'name', 'navigator', 'passengers', 'speedometer', 'vehicle'], 'each is listed'); }
  for (const id of ['', 'a b', 'a/b', 'x'.repeat(65), '"><img>', '__proto__', '-a', 5]) { const d = await RF.decode(fileOf(docOf({ rally: { id } }))); assert.ok(!('id' in d.rally), 'id ' + id + ' is not kept'); }
  for (const id of ['a', 'r1abc', 'A-b_9', 'x'.repeat(64)]) assert.strictEqual((await RF.decode(fileOf(docOf({ rally: { id } })))).rally.id, id, 'id ' + id);
  for (const [v, ok] of [[0, true], [999, true], ['007', true], [1000, false], [-1, false], [1.5, false], ['x', false], [true, false]]) {
    const d = await RF.decode(fileOf(docOf({ rally: { carNumber: v } }))); assert.strictEqual(d.rally.cn !== undefined, ok, 'carNumber ' + JSON.stringify(v)); }
  for (const [v, ok] of [[1, true], [100, true], [0.99, false], [101, false], ['', false]]) {
    const d = await RF.decode(fileOf(docOf({ rally: { speedometer: v } }))); assert.strictEqual(d.rally.speedo !== undefined, ok, 'speedometer ' + JSON.stringify(v)); }

  // ---- Route Instructions: the mapping, order, and the content cases ----
  { const d = await RF.decode(fileOf(docOf({ ris: [
      { ri: '12', om: '5.94', czt: '09:04:30', cp: 4, instruction: ' L at STOP. ', info: 'x' },
      { ri: '12A', om: '5.94/0.00', czt: '9:10.5', cp: '5', instruction: 'RESTART' },
      { ri: 11, om: '/0.00', instruction: 'out of order stays where the file put it' },
      { ri: 13, om: 7.5, czt: '', instruction: 'no OM text, a number', cp: null },
      { ri: 14, instruction: 'no OM at all' }] })));
    assert.deepStrictEqual(d.rows.map(r => r.ri), [12, '12A', 11, 13, 14], 'the file order is kept, and a numeric string is a number');
    const [a, b, c, e, f] = d.rows;
    assert.deepStrictEqual([a.om, a.restart, a.czt, a.cp, a.instr, a.info], [5.94, false, 9 * 3600 + 270, '4', 'L at STOP.', 'x']);
    assert.deepStrictEqual([b.om, b.restart, b.czt, b.cp], [5.94, true, 9 * 3600 + 10 * 60 + 30, '5'], 'a restart OM, and CZT as H:MM.cc');
    assert.deepStrictEqual([c.om, c.restart], [0, true], 'a bare /0.00');
    assert.deepStrictEqual([e.om, e.czt, e.cp], [7.5, null, null]); assert.deepStrictEqual([f.om, f.restart], [null, false]);
    assert.deepStrictEqual(d.problems, []); assert.ok(d.rows.every(r => r.band === null && r.imgCheck === null && Array.isArray(r.signs)), 'normRow ran: no bands'); }
  { const d = await RF.decode(fileOf(docOf({ ris: [
      { ri: 1, om: '5/3', czt: '25:99', cp: {}, instruction: 3, info: [], done: 'yes', doneAt: 'yesterday', ttDone: 'x', estLock: '100:00:00' },
      { ri: 2, om: [], czt: 5 }] })));
    assert.deepStrictEqual(d.problems.map(p => `${p.label} ${p.field}`), ['RI 1 OM', 'RI 1 CZT', 'RI 1 CP', 'RI 1 instruction', 'RI 1 info', 'RI 1 done', 'RI 1 completion time', 'RI 1 ttDone', 'RI 1 estLock',
      'RI 2 OM', 'RI 2 CZT', 'RI 2 instruction'], 'each bad value is listed, by RI and field');
    const a = d.rows[0]; assert.deepStrictEqual([a.om, a.czt, a.cp, a.instr, a.info, a.done, a.doneAt, a.ttDone, a.estLock], [null, null, null, '', '', false, null, null, null], 'and left blank'); }
  { const d = await RF.decode(fileOf(docOf({ ris: [{ ri: 7, instruction: 'a' }, { ri: '7', instruction: 'dup of 7' }, { ri: 7, instruction: 'dup again' }, { instruction: 'no ri' }, { ri: '', instruction: 'blank ri' }, { ri: { x: 1 }, instruction: 'odd' }, { ri: 8 }] })));
    assert.deepStrictEqual(d.rows.map(r => [r.ri, r.instr]), [[7, 'a'], [null, 'no ri'], [null, 'blank ri'], [null, 'odd'], [8, '']], 'a duplicate RI keeps the first; a row with no RI is kept with ri null; a missing instruction is blank');
    assert.deepStrictEqual(d.problems.map(p => [p.type, p.label]), [['dup', 'RI 7'], ['dup', 'RI 7'], ['noRI', 'row 4'], ['noRI', 'row 5'], ['noRI', 'row 6'], ['value', 'RI 8']], 'listed by RI or by row position'); }

  // ---- times in a file ----
  for (const [t, s] of [[0, '00:00:00'], [32410.2, '09:00:10.2'], [27 * 3600 + 5 * 60 + 10.5, '27:05:10.5'], [99 * 3600 + 3599.999, '99:59:59.999'], [3600.25, '01:00:00.25'], [59.0004, '00:00:59']]) {
    assert.strictEqual(RF.fmtLong(t), s, 'fmtLong ' + t); }
  assert.strictEqual(RF.fmtLong(100 * 3600), null); assert.strictEqual(RF.fmtLong(-1), null); assert.strictEqual(RF.fmtLong(NaN), null); assert.strictEqual(RF.fmtLong('5'), null);
  for (const [s, t] of [['27:05:10.5', 27 * 3600 + 310.5], ['00:00:00', 0], ['9:00:10.25', 32410.25], ['99:59:59.999', 99 * 3600 + 3599.999]]) assert.ok(Math.abs(RF.parseLong(s) - t) < 1e-9, 'parseLong ' + s);
  for (const s of ['09:60:00', '09:00:60', '100:00:00', '09:00', '9:00:00.1234', 'x', '', null, 5, '-1:00:00']) assert.strictEqual(RF.parseLong(s), null, 'parseLong rejects ' + s);
  for (const [om, r, s] of [[5.94, false, '5.94'], [5.94, true, '5.94/0.00'], [0, true, '/0.00'], [null, true, '/0.00'], [null, false, null], [1.234, false, '1.234'], [0, false, '0.00'], [10, false, '10.00']]) assert.strictEqual(RF.fmtOM(om, r), s, 'fmtOM ' + om + r);
  { const d = await RF.decode(fileOf(docOf({ ris: [{ ri: 1, doneAt: '2026-05-02T16:00:05Z' }, { ri: 2, doneAt: '2026-05-02T09:00:05.250-07:00' }, { ri: 3, doneAt: '2026-05-02 16:00' }, { ri: 4, doneAt: '2026-05-02T25:00:00Z' }] })));
    assert.strictEqual(d.rows[0].doneAt, Date.UTC(2026, 4, 2, 16, 0, 5)); assert.strictEqual(d.rows[1].doneAt, Date.UTC(2026, 4, 2, 16, 0, 5, 250));
    assert.deepStrictEqual([d.rows[2].doneAt, d.rows[3].doneAt], [null, null], 'an ISO 8601 date and time with a zone only'); assert.strictEqual(d.problems.filter(p => p.field === 'completion time').length, 2); }

  // ---- Time Allowances ----
  { const d = await RF.decode(fileOf(docOf({ ris: [{ ri: 5, instruction: 'a' }, { ri: '6A', instruction: 'b' }, { ri: 7, instruction: 'c' }], ta: [
      { ri: 5, ta: '1:05', at: '2026-05-02T16:00:05Z' }, { ri: '6A', ta: 90 }, { ri: 5, ta: '0:10' }, { ri: 99, ta: '0:10' }, { ri: 7, ta: '90:01' }, { ri: 7, ta: '1:75' },
      { ri: 7, ta: '-5' }, { ri: 7, ta: '' }, { ri: 7, ta: '0:20', at: 'noon' }, null, { ta: '0:05' }] })));
    assert.deepStrictEqual(d.ta, [{ ri: 5, ta: 65, at: Date.UTC(2026, 4, 2, 16, 0, 5) }, { ri: '6A', ta: 90, at: null }, { ri: 7, ta: 20, at: null }], 'TAs: m:ss and whole seconds, the first of two for an RI wins, and only valid ones load');
    assert.deepStrictEqual(d.problems.map(p => `${p.type} ${p.label}${p.field ? ' ' + p.field : ''}`),
      ['ta RI 5', 'ta RI 99', 'value RI 7 TA', 'value RI 7 TA', 'value RI 7 TA', 'value RI 7 TA', 'value RI 7 TA time', 'ta item 10', 'ta item 11'], 'and the others are listed'); }

  // ---- images ----
  { const d = await RF.decode(fileOf(docOf({ ris: [
      { ri: 1, instruction: '[sign: a] [sign: b]', signs: ['signs/a.jpg', 'x\\b.png'] },
      { ri: 2, instruction: '[sign: c]', signs: ['signs/a.jpg'] },
      { ri: 3, instruction: '[sign: d] [sign: e] [sign: f] [sign: g]', signs: ['./signs/a.jpg', 'signs/missing.jpg', 'signs/A.jpg', 'signs/notimage.jpg', 'signs/empty.png'] }] }),
    [{ name: 'signs/a.jpg', data: JPG, method: 8 }, { name: 'x/b.png', data: PNG }, { name: 'signs/notimage.jpg', data: enc('GIF89a....') }, { name: 'signs/empty.png', data: new Uint8Array(0) }, { name: 'unused.jpg', data: JPG }]));
    assert.deepStrictEqual(d.rows.map(r => r.signs), [['signs/a.jpg', 'x/b.png'], ['signs/a.jpg'], ['signs/a.jpg']], 'paths are normalised and kept in order; images that are not read are dropped');
    assert.deepStrictEqual([...d.images.keys()].sort(), ['signs/a.jpg', 'x/b.png'], 'only referenced, readable images come back');
    assert.deepStrictEqual([d.images.get('signs/a.jpg').type, d.images.get('x/b.png').type, [...d.images.get('signs/a.jpg').bytes]], ['image/jpeg', 'image/png', [...JPG]], 'the type comes from the bytes, not the name (and a deflate entry is unpacked)');
    assert.deepStrictEqual(d.problems.map(p => [p.type, p.label]), [['image', 'RI 3'], ['image', 'RI 3'], ['image', 'RI 3'], ['image', 'RI 3']], 'a missing path (also by case), a non-image, and an empty file: one problem each'); }
  { const d = await RF.decode(fileOf(docOf({ ris: [{ ri: 1, instruction: 'x', signs: ['s.jpg'] }] }), [{ name: 's.jpg', data: enc('<svg/>') }]));
    assert.deepStrictEqual([d.rows[0].signs, d.problems.map(p => p.type)], [[], ['image']], 'a name ending .jpg does not make a file an image'); }
  { const d = await RF.decode(fileOf(docOf({ ris: [{ ri: 1, instruction: 'x', signs: ['s.jpg'] }] }), [{ name: 's.jpg', data: JPG, crc: 3 }]));
    assert.deepStrictEqual([d.rows[0].signs, d.problems.map(p => p.type)], [[], ['image']], 'a damaged image is a content problem, not a rejection'); }

  // ---- the load notice (the text of docs/RALLY-FILE.md § Loading and the brief) ----
  assert.strictEqual(RF.noticeText('X', []), 'Loaded “X”.');
  assert.strictEqual(RF.noticeText('', []), 'Loaded “Untitled rally”.');
  assert.strictEqual(RF.noticeText('X', [{ type: 'image', label: 'RI 16' }, { type: 'image', label: 'RI 25' }, { type: 'value', label: 'RI 40', field: 'OM' }]),
    'Loaded “X”. 2 sign images could not be read (RI 16, RI 25). 1 value was left blank (RI 40 OM).');
  assert.strictEqual(RF.noticeText('X', [{ type: 'image', label: 'RI 16' }, { type: 'image', label: 'RI 16' }]), 'Loaded “X”. 2 sign images could not be read (RI 16).', 'an RI is named once');
  assert.strictEqual(RF.noticeText('X', [{ type: 'image', label: 'RI 9' }]), 'Loaded “X”. 1 sign image could not be read (RI 9).');
  assert.strictEqual(RF.noticeText('X', [{ type: 'value', label: '', field: 'OCF' }, { type: 'value', label: 'RI 2', field: 'CZT' }, { type: 'noRI', label: 'row 3' }, { type: 'dup', label: 'RI 5' }, { type: 'ta', label: 'RI 99' }, { type: 'kind', label: 'pocket' }]),
    'Loaded “X”. 2 values were left blank (OCF, RI 2 CZT). 1 row has no RI (row 3). 1 duplicate RI was dropped (RI 5). 1 Time Allowance was dropped (RI 99). The file’s kind “pocket” is not known, so the rally opens on Setup.');

  // ---- save and load: the round trip ----
  const mkRally = () => {
    const r = { ...JSON.parse(JSON.stringify(SAMPLE.rally)), id: 'rtrip1', date: '2026-05-02', speedo: 41.5, closeMi: 0.3, created: 1, updated: 2, rows: Core.mergeRows([], SAMPLE.rows).rows, taEvents: [] };
    r.rows[3].czt = 9 * 3600 + 17 * 0.6;                                                                       // a time read as H:MM.cc has fractional seconds
    r.rows[4].instr = 'Sign [sign: one] and [sign: two].'; r.rows[4].signs = ['sgA', 'sgB']; r.rows[9].instr = 'x [sign: three]'; r.rows[9].signs = ['sgA'];
    r.taEvents = Core.setTA(r, 5, 65, 1780000000000);
    r.taEvents = [...r.taEvents.filter(e => !Core.sameRI(e.ri, r.rows[20].ri)), ...Core.setTA({ ...r, taEvents: [] }, 20, 125, 1780000100000)];
    for (let k = 0; k < 25; k++) r.rows = Core.completeActive(r, 1780000000000 + k * 1000);
    return r;
  };
  { const r = mkRally(), images = new Map([['sgA', { bytes: JPG, type: 'image/jpeg' }], ['sgB', { bytes: PNG, type: 'image/png' }]]);
    const bytes = RF.encode(r, images, '2026-05-02T20:00:00.000Z'), z = RF.zipOpen(bytes);
    assert.deepStrictEqual([...z.keys()].sort(), ['rally.json', 'signs/0001.jpg', 'signs/0002.png'], 'one rally.json and one entry per distinct image (a shared image is stored once)');
    assert.ok([...z.values()].every(e => e.method === 0), 'the app writes entries stored');
    const doc = JSON.parse(new TextDecoder().decode(await RF.zipRead(bytes, z.get('rally.json'))));
    assert.deepStrictEqual([doc.format, doc.version, doc.kind, doc.savedAt], ['rally-monte-style', 1, 'saved', '2026-05-02T20:00:00.000Z']);
    assert.ok(!/"band"|imgCheck|created|updated|theme|model|apikey/i.test(JSON.stringify(doc)), 'no bands, imgCheck, timestamps, or preferences in the file');
    assert.deepStrictEqual(doc.ris[4].signs, ['signs/0001.jpg', 'signs/0002.png']); assert.deepStrictEqual(doc.ris[9].signs, ['signs/0001.jpg']);
    assert.strictEqual(doc.rally.class, 'C'); assert.strictEqual(doc.rally.carNumber, 7); assert.strictEqual(doc.ris[0].om, '/0.00'); assert.strictEqual(doc.ris[9].om, '23.70/0.00');
    const d = await RF.decode(bytes);
    assert.deepStrictEqual(d.problems, []); assert.strictEqual(d.kind, 'saved');
    const back = { ...d.rally, rows: d.rows, taEvents: d.ta };
    assert.deepStrictEqual(round3(Core.compute(back)), round3(Core.compute(r)), 'Core.compute is the same before and after');
    assert.deepStrictEqual(round3(back.rows.map(({ signs, ...x }) => x)), round3(r.rows.map(({ signs, ...x }) => x)), 'every row field survives, run state included');
    assert.deepStrictEqual(back.rows.map(x => x.signs.length), r.rows.map(x => x.signs.length), 'and the number of sign images');
    assert.deepStrictEqual([back.rows[4].signs, back.rows[9].signs], [['signs/0001.jpg', 'signs/0002.png'], ['signs/0001.jpg']]);
    assert.deepStrictEqual([...d.images.get('signs/0001.jpg').bytes], [...JPG]); assert.deepStrictEqual([...d.images.get('signs/0002.png').bytes], [...PNG]);
    assert.deepStrictEqual(round3(back.taEvents), round3(r.taEvents), 'Time Allowances survive');
    assert.deepStrictEqual([back.id, back.name, back.date, back.cn, back.cls, back.ocf, back.closeMi, back.speedo, back.vehicle, back.crew], [r.id, r.name, r.date, r.cn, r.cls, r.ocf, r.closeMi, r.speedo, r.vehicle, r.crew], 'Setup survives');
    assert.deepStrictEqual(RF.encode({ ...back, crew: back.crew }, new Map([['signs/0001.jpg', { bytes: JPG, type: 'image/jpeg' }], ['signs/0002.png', { bytes: PNG, type: 'image/png' }]]), '2026-05-02T20:00:00.000Z'), bytes, 'saving what was loaded gives the same file'); }
  { const r = mkRally(), bytes = RF.encode(r, new Map([['sgA', { bytes: JPG, type: 'image/jpeg' }]]), 'now'), d = await RF.decode(bytes);   // sgB is gone from this device
    assert.deepStrictEqual(d.rows[4].signs.length, 1, 'an image that is missing at save time is left out of its row'); assert.deepStrictEqual(d.problems, []);
    const bare = await RF.decode(RF.encode(r, new Map(), 'now')); assert.ok(bare.rows.every(x => x.signs.length === 0) && bare.images.size === 0, 'no images at all'); }
  { const r = { id: 'a1', name: 'Tiny', cn: '', ocf: 1, rows: [{ ...Core.normRow({ ri: 1, om: 1 }) }], taEvents: [{ ri: 1, ta: 10, at: 1 }, { ri: 77, ta: 10, at: 1 }], crew: { driver: '', navigator: '', passengers: [] } };
    const d = await RF.decode(RF.encode(r, new Map(), 'now'));
    assert.deepStrictEqual(d.ta.map(t => t.ri), [1], 'a Time Allowance for no row is not saved'); assert.ok(!('cls' in d.rally) && !('closeMi' in d.rally) && !('speedo' in d.rally), 'an absent class, close limit, and speedometer stay absent'); }
  { const r = { id: 'a1', name: 'T', rows: [{ ...Core.normRow({ ri: 1, om: 1 }), done: true, doneAt: 1780000000000, ttDone: 100 * 3600, estLock: -4 }], taEvents: [] };
    const d = await RF.decode(RF.encode(r, new Map(), 'now'));
    assert.deepStrictEqual([d.rows[0].ttDone, d.rows[0].estLock, d.rows[0].doneAt], [null, null, 1780000000000], 'a time that does not fit the file is not written'); }

  // ---- a file built by hand from docs/RALLY-FILE.md alone, deflated by a zip tool ----
  { const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'hand-built.rally'))), z = RF.zipOpen(bytes);
    assert.ok([...z.values()].some(e => e.method === 8), 'the fixture is deflated');
    const d = await RF.decode(bytes);
    assert.deepStrictEqual(d.problems, [], 'the hand-built file loads clean'); assert.strictEqual(d.kind, 'distributed');
    assert.deepStrictEqual(d.rally, { name: 'Example Rally', date: '2026-05-02', crew: { driver: 'Jane Driver', navigator: 'John Navigator' }, cn: 7, cls: 'C', ocf: 1.01 });
    assert.deepStrictEqual(d.rows.map(r => [r.ri, r.om, r.restart, r.czt, r.cp, r.done]), [[1, 0, true, 32400, '1', true], [2, 0.31, false, null, null, false], [3, 1.62, false, 9 * 3600 + 270, '2', false]]);
    assert.deepStrictEqual([d.rows[0].doneAt, d.rows[0].ttDone], [Date.UTC(2026, 4, 2, 16, 0, 5), 9 * 3600 + 7 * 60]);
    assert.deepStrictEqual(d.rows.map(r => r.signs), [[], [], ['signs/0001.png']]); assert.strictEqual(d.images.get('signs/0001.png').type, 'image/png');
    assert.deepStrictEqual(d.ta, [{ ri: 2, ta: 65, at: null }]);
    const r = { ...d.rally, rows: d.rows, taEvents: d.ta }, C = Core.compute(r);
    assert.strictEqual(C[0].tt, 32400 + 7 * 60, 'TT = CZT + car number minutes, as the file says ttDone');
    assert.strictEqual(C[2].tt, 9 * 3600 + 270 + 7 * 60 + 65, 'a Time Allowance applies from its RI to the end of the leg');
  }

  console.log('rallyfile tests: all passed');
})().catch(e => { console.error(e); process.exit(1); });
