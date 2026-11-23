// Rally file: encode and decode a rally as a zip (docs/RALLY-FILE.md). Pure: bytes in, values out; no DOM, no clock
// (the caller passes the save time). It uses Core for the entry rules, so a value in a file is checked as if typed by hand.
// An image is {bytes: Uint8Array, type: 'image/jpeg' | 'image/png'}; decoding the pixels is the app's job.
(function (root) {
  'use strict';
  const Core = (typeof module !== 'undefined' && module.exports) ? require('./core.js') : root.Core;

  const FORMAT = 'rally-monte-style', VERSION = 1;
  const MAX_BYTES = 50 * 1024 * 1024;          // a file over this is refused before it is read
  const MAX_ENTRY = 20 * 1024 * 1024;          // one entry, uncompressed
  const MAX_IMAGES_TOTAL = 100 * 1024 * 1024;  // all images read from one file, uncompressed
  const KINDS = ['saved', 'distributed'];

  class RallyFileError extends Error { constructor(m, code) { super(m); this.name = 'RallyFileError'; this.code = code || ''; } }
  const bad = (m, code) => new RallyFileError(m, code);

  // ---------- CRC-32 and zip ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  // Entry names as the reader matches them: forward slashes, no leading "./" or "/". Case matters.
  const normPath = s => String(s).replace(/\\/g, '/').replace(/^(\.?\/)+/, '');

  // entries: [{name, data: Uint8Array}] -> a zip with every entry stored (no compression).
  function zipWrite(entries) {
    const enc = new TextEncoder(), u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    const chunks = [], cd = []; let off = 0;
    for (const e of entries) {
      const name = enc.encode(e.name), data = e.data, crc = crc32(data);
      const lh = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
      chunks.push(lh, name, data);
      cd.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length),
        ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
      off += lh.length + name.length + data.length;
    }
    const cdSize = cd.reduce((n, c) => n + c.length, 0), n = entries.length;
    const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(n), ...u16(n), ...u32(cdSize), ...u32(off), ...u16(0)]);
    const all = [...chunks, ...cd, end], out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
    let p = 0; for (const c of all) { out.set(c, p); p += c.length; }
    return out;
  }

  const DAMAGED = 'That rally file is damaged (its zip directory cannot be read).';
  // The entries of a zip: Map(normalized name -> {name, method, crc, csize, usize, off}). Directories are skipped.
  function zipOpen(b) {
    const n = b.length, dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let e = -1;
    for (let i = n - 22; i >= Math.max(0, n - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw bad('That file is not a rally file (it is not a zip archive).', 'notzip');
    const unsupported = what => bad(`That rally file uses a zip feature this app does not read (${what}).`);
    if (e >= 20 && dv.getUint32(e - 20, true) === 0x07064b50) throw unsupported('ZIP64');
    const cnt = dv.getUint16(e + 10, true), cdSize = dv.getUint32(e + 12, true), cdOff = dv.getUint32(e + 16, true);
    if (cnt === 0xFFFF || cdSize === 0xFFFFFFFF || cdOff === 0xFFFFFFFF) throw unsupported('ZIP64');
    if (dv.getUint16(e + 4, true) !== 0 || dv.getUint16(e + 6, true) !== 0) throw unsupported('a zip split over several files');
    const out = new Map(); let p = cdOff;
    for (let i = 0; i < cnt; i++) {
      if (p + 46 > n || dv.getUint32(p, true) !== 0x02014b50) throw bad(DAMAGED);
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true);
      const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const off = dv.getUint32(p + 42, true);
      if (p + 46 + nl > n) throw bad(DAMAGED);
      const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
      p += 46 + nl + el + cl;
      if (name.endsWith('/')) continue;
      if (flags & 1) throw unsupported('an encrypted entry');
      if (csize === 0xFFFFFFFF || usize === 0xFFFFFFFF || off === 0xFFFFFFFF) throw unsupported('ZIP64');
      if (method !== 0 && method !== 8) throw unsupported(`compression method ${method}`);
      const key = normPath(name);
      if (!out.has(key)) out.set(key, { name, method, crc, csize, usize, off });
    }
    return out;
  }

  async function inflateRaw(raw, expect) {
    const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter(), r = ds.readable.getReader();
    w.write(raw).catch(() => {}); w.close().catch(() => {});
    const parts = []; let total = 0;
    for (;;) {
      const { done, value } = await r.read();
      if (done) break;
      total += value.length;
      if (total > expect) { try { await r.cancel(); } catch (e) {} throw new Error('too long'); }
      parts.push(value);
    }
    const out = new Uint8Array(total); let p = 0; for (const c of parts) { out.set(c, p); p += c.length; }
    return out;
  }

  // The bytes of one entry (stored or deflate), checked against its size and CRC-32.
  async function zipRead(b, ent, limit) {
    const where = `“${ent.name}”`;
    if (ent.usize > (limit || MAX_ENTRY)) throw bad(`That rally file has an entry (${where}) that is too large.`);
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), off = ent.off;
    if (off + 30 > b.length || dv.getUint32(off, true) !== 0x04034b50) throw bad(`That rally file is damaged (${where} cannot be read).`);
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), end = start + ent.csize;
    if (end > b.length) throw bad(`That rally file is damaged (${where} is cut off).`);
    const raw = b.subarray(start, end);
    let out;
    if (ent.method === 0) out = raw;
    else { try { out = await inflateRaw(raw, ent.usize); } catch (e) { throw bad(`That rally file is damaged (${where} cannot be unpacked).`); } }
    if (out.length !== ent.usize || crc32(out) !== ent.crc) throw bad(`That rally file is damaged (${where} fails its checksum).`);
    return out;
  }

  function sniffImage(b) {
    if (b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 && b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A) return 'image/png';
    return null;
  }

  // ---------- times in a file ----------
  const p2 = n => String(n).padStart(2, '0');
  // HH:MM:SS with up to 3 decimals, unwrapped (hours 0-99): the form of ttDone, estLock, and CZT. null when out of range.
  function fmtLong(t) {
    if (typeof t !== 'number' || !isFinite(t) || t < 0 || t >= 360000) return null;
    let ms = Math.round(t * 1000);
    const h = Math.floor(ms / 3600000); ms -= h * 3600000;
    const m = Math.floor(ms / 60000); ms -= m * 60000;
    const s = Math.floor(ms / 1000), f = ms % 1000;
    return `${p2(h)}:${p2(m)}:${p2(s)}${f ? '.' + String(f).padStart(3, '0').replace(/0+$/, '') : ''}`;
  }
  function parseLong(s) {
    const m = typeof s === 'string' && s.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
    if (!m || +m[2] > 59 || +m[3] > 59) return null;
    return +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +('0.' + m[4]) : 0);
  }
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
  const parseISO = s => { if (typeof s !== 'string' || !ISO.test(s)) return null; const t = Date.parse(s); return isFinite(t) ? t : null; };
  const isoOf = ms => { try { return typeof ms === 'number' && isFinite(ms) ? new Date(ms).toISOString() : null; } catch (e) { return null; } };
  // OM as printed: "5.94", "5.94/0.00", or "/0.00" (a restart with OM 0, or with no OM).
  function fmtOM(om, restart) {
    const s = om == null ? null : Math.abs(om * 100 - Math.round(om * 100)) < 1e-9 ? om.toFixed(2) : String(om);
    return restart ? (om == null || om === 0 ? '/0.00' : s + '/0.00') : s;
  }

  // ---------- encode ----------
  // rally: a stored rally. images: Map(image id -> {bytes, type}) for the sign images that exist on this device (an id with no
  // entry is left out of its row's list). nowISO: the save time. Returns the zip bytes (kind "saved").
  function encode(rally, images, nowISO) {
    const paths = new Map(), files = [];
    const pathOf = id => {
      if (paths.has(id)) return paths.get(id);
      const im = images.get(id); let p = null;
      if (im) { p = `signs/${String(files.length + 1).padStart(4, '0')}.${im.type === 'image/png' ? 'png' : 'jpg'}`; files.push({ name: p, data: im.bytes }); }
      paths.set(id, p); return p;
    };
    const rows = rally.rows || [];
    const ris = rows.map(x => {
      const o = {};
      if (x.ri != null) o.ri = x.ri;
      const om = fmtOM(x.om, x.restart); if (om != null) o.om = om;
      const cz = x.czt == null ? null : fmtLong(x.czt); if (cz) o.czt = cz;
      if (x.cp != null) o.cp = x.cp;
      o.instruction = x.instr || '';
      if (x.info) o.info = x.info;
      const sg = (x.signs || []).map(pathOf).filter(Boolean); if (sg.length) o.signs = sg;
      o.done = !!x.done;
      const at = isoOf(x.doneAt); if (at) o.doneAt = at;
      const tt = fmtLong(x.ttDone); if (tt) o.ttDone = tt;
      const el = fmtLong(x.estLock); if (el) o.estLock = el;
      return o;
    });
    const crew = rally.crew || {}, r = {};
    if (rally.id) r.id = rally.id;
    r.name = rally.name || ''; if (rally.date) r.date = rally.date;
    r.driver = crew.driver || ''; r.navigator = crew.navigator || ''; r.passengers = (crew.passengers || []).map(String);
    r.vehicle = rally.vehicle || ''; r.carNumber = rally.cn === '' || rally.cn == null ? '' : rally.cn;
    if (rally.cls) r.class = rally.cls;
    r.ocf = rally.ocf;
    if (rally.closeMi !== '' && rally.closeMi != null) r.closeLimitMi = rally.closeMi;
    if (typeof rally.speedo === 'number' && isFinite(rally.speedo)) r.speedometer = rally.speedo;
    const ta = (rally.taEvents || []).filter(e => rows.some(x => Core.sameRI(x.ri, e.ri))).map(e => {
      const t = { ri: e.ri, ta: Core.fmtTA(e.ta) }; const at = isoOf(e.at); if (at) t.at = at; return t;
    });
    const doc = { format: FORMAT, version: VERSION, kind: 'saved', savedAt: nowISO, rally: r, ris, ta };
    return zipWrite([{ name: 'rally.json', data: new TextEncoder().encode(JSON.stringify(doc, null, 2) + '\n') }, ...files]);
  }

  // ---------- decode ----------
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const looksLikeJSON = b => {
    const t = new TextDecoder().decode(b.subarray(0, Math.min(b.length, MAX_BYTES))).trim();
    if (!/^[{[]/.test(t)) return false;
    try { JSON.parse(t); return true; } catch (e) { return false; }
  };

  // Returns {kind: 'saved' | 'distributed' | null, rally: validated setup fields, rows, ta, images: Map(path -> {bytes, type}), problems}.
  // rows have signs as zip paths (valid images only). Throws RallyFileError for a broken structure; every content problem
  // is left blank, dropped, or defaulted and added to problems: {type: 'value'|'image'|'noRI'|'dup'|'ta'|'kind', label, field?}.
  async function decode(bytes) {
    if (bytes.length > MAX_BYTES) throw bad('That file is over 50 MB, so it was not read.');
    let zip;
    try { zip = zipOpen(bytes); }
    catch (e) {
      if (e.code === 'notzip') throw bad(looksLikeJSON(bytes) ? 'That is an earlier version’s JSON export, which this version cannot load.' : e.message);
      throw e;
    }
    const ent = zip.get('rally.json');
    if (!ent) throw bad('That rally file has no rally.json.');
    let d;
    try { d = JSON.parse(new TextDecoder().decode(await zipRead(bytes, ent))); } catch (e) { throw e instanceof RallyFileError ? e : bad('That rally file’s rally.json is not valid JSON.'); }
    if (!isObj(d)) throw bad('That rally file’s rally.json does not hold a JSON object.');
    if (d.format !== FORMAT) throw bad(`That file is not a rally file (its format must be “${FORMAT}”).`);
    if (!Number.isInteger(d.version) || d.version < 1) throw bad('That rally file has no valid version.');
    if (d.version > VERSION) throw bad(`That rally file is from a newer version of the app (file version ${d.version}; this app reads up to ${VERSION}). Update the app and try again.`);
    if (!isObj(d.rally)) throw bad('In that rally file, “rally” must be an object.');
    if (!Array.isArray(d.ris)) throw bad('In that rally file, “ris” must be a list.');
    if (d.ta != null && !Array.isArray(d.ta)) throw bad('In that rally file, “ta” must be a list.');
    d.ris.forEach((it, i) => {
      if (!isObj(it)) throw bad(`In that rally file, item ${i + 1} of “ris” must be an object.`);
      if (it.signs != null && (!Array.isArray(it.signs) || it.signs.some(s => typeof s !== 'string'))) throw bad(`In that rally file, “signs” of item ${i + 1} of “ris” must be a list of paths.`);
    });

    const problems = [], val = (label, field) => problems.push({ type: 'value', label, field });
    const kind = d.kind === undefined || d.kind === null ? null : KINDS.includes(d.kind) ? d.kind : null;
    if (d.kind != null && kind === null) problems.push({ type: 'kind', label: String(d.kind) });

    // rally fields (the same rules as the Setup screen)
    const src = d.rally, rally = {}, str = (k, to) => { if (src[k] === undefined || src[k] === null) return; if (typeof src[k] === 'string') rally[to] = src[k]; else val('', k); };
    if (src.id != null) { if (typeof src.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(src.id)) rally.id = src.id; else val('', 'id'); }
    str('name', 'name'); str('vehicle', 'vehicle');
    if (src.date != null) { if (typeof src.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(src.date) && isFinite(Date.parse(src.date))) rally.date = src.date; else val('', 'date'); }
    const crew = {}; let anyCrew = false;
    for (const k of ['driver', 'navigator']) if (src[k] != null) { anyCrew = true; if (typeof src[k] === 'string') crew[k] = src[k]; else val('', k); }
    if (src.passengers != null) {
      anyCrew = true;
      if (Array.isArray(src.passengers)) { crew.passengers = src.passengers.filter(p => typeof p === 'string'); if (crew.passengers.length !== src.passengers.length) val('', 'passengers'); }
      else val('', 'passengers');
    }
    if (anyCrew) rally.crew = crew;
    const asText = v => typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
    if (src.carNumber != null) { const t = asText(src.carNumber), v = t == null ? undefined : Core.parseCN(t); if (v === undefined) val('', 'car number'); else rally.cn = v; }
    if (src.ocf != null) { const t = asText(src.ocf), v = t == null ? undefined : Core.parseOCF(t); if (v === undefined) val('', 'OCF'); else rally.ocf = v; }
    if (src.closeLimitMi != null) { const t = asText(src.closeLimitMi), v = t == null ? undefined : Core.parseCloseMi(t); if (v === undefined) val('', 'close limit'); else rally.closeMi = v; }
    if (src.speedometer != null) { const t = asText(src.speedometer), v = t == null ? undefined : Core.parseSpeedo(t); if (v === undefined) val('', 'speedometer'); else rally.speedo = Math.round(v * 10) / 10; }
    if (src.class != null) { if (src.class === '' || ['A', 'B', 'C', 'D'].includes(src.class)) { if (src.class) rally.cls = src.class; } else val('', 'class'); }

    // Route Instructions, in the file's order
    const rows = [], images = new Map(), imgCache = new Map(); let budget = MAX_IMAGES_TOTAL;
    const readImage = async path => {
      const key = normPath(path);
      if (imgCache.has(key)) return imgCache.get(key) ? key : null;
      let im = null; const e = zip.get(key);
      if (e && e.usize <= budget) {
        try { const data = await zipRead(bytes, e); budget -= data.length; const type = sniffImage(data); if (type) im = { bytes: data, type }; } catch (err) { im = null; }
      }
      imgCache.set(key, im); if (im) images.set(key, im);
      return im ? key : null;
    };
    for (let i = 0; i < d.ris.length; i++) {
      const it = d.ris[i];
      let ri = typeof it.ri === 'string' || typeof it.ri === 'number' ? Core.normRow({ ri: it.ri }).ri : null;
      if (ri != null && rows.some(r => r.ri != null && Core.sameRI(r.ri, ri))) { problems.push({ type: 'dup', label: `RI ${ri}` }); continue; }
      const label = ri != null ? `RI ${ri}` : `row ${i + 1}`;
      if (ri == null) problems.push({ type: 'noRI', label });
      let om = null, restart = false;
      const omT = it.om == null ? '' : asText(it.om);
      const pom = omT == null ? null : Core.parseOM(omT);
      if (!pom) val(label, 'OM'); else { om = pom.om; restart = !!pom.restart; }
      let czt = null;
      if (it.czt != null && it.czt !== '') { czt = typeof it.czt === 'string' ? Core.parseTOD(it.czt) : null; if (czt == null) val(label, 'CZT'); }
      let cp = null;
      if (it.cp != null && it.cp !== '') { const t = asText(it.cp); if (t == null) val(label, 'CP'); else cp = t; }
      let instr = '';
      if (typeof it.instruction === 'string') instr = it.instruction; else val(label, 'instruction');
      let info = '';
      if (it.info != null) { if (typeof it.info === 'string') info = it.info; else val(label, 'info'); }
      let done = false;
      if (it.done != null) { if (typeof it.done === 'boolean') done = it.done; else val(label, 'done'); }
      let doneAt = null;
      if (it.doneAt != null) { doneAt = parseISO(it.doneAt); if (doneAt == null) val(label, 'completion time'); }
      let ttDone = null, estLock = null;
      if (it.ttDone != null) { ttDone = parseLong(it.ttDone); if (ttDone == null) val(label, 'ttDone'); }
      if (it.estLock != null) { estLock = parseLong(it.estLock); if (estLock == null) val(label, 'estLock'); }
      const signs = [];
      for (const p of it.signs || []) { const k = await readImage(p); if (k) signs.push(k); else problems.push({ type: 'image', label }); }
      rows.push({ ...Core.normRow({ ri, om, restart, czt, cp, instr, info, done, ttDone, doneAt, estLock }), signs });
    }

    // Time Allowances
    const ta = [];
    (d.ta || []).forEach((e, i) => {
      let ok = isObj(e), label = `item ${i + 1}`, row = null;
      if (ok) {
        const ri = typeof e.ri === 'string' || typeof e.ri === 'number' ? Core.normRow({ ri: e.ri }).ri : null;
        if (ri != null) label = `RI ${ri}`;
        row = ri == null ? null : rows.find(r => r.ri != null && Core.sameRI(r.ri, ri));
      }
      if (!row) { problems.push({ type: 'ta', label }); return; }
      if (ta.some(t => Core.sameRI(t.ri, row.ri))) { problems.push({ type: 'ta', label }); return; }
      const t = typeof e.ta === 'number' ? String(e.ta) : typeof e.ta === 'string' && e.ta.trim() ? e.ta : null;
      const sec = t == null ? null : Core.parseTA(t);
      if (sec == null || sec > Core.TA_MAX) { val(label, 'TA'); return; }
      let at = null;
      if (e.at != null) { at = parseISO(e.at); if (at == null) val(label, 'TA time'); }
      ta.push({ ri: row.ri, ta: sec, at });
    });

    return { kind, rally, rows, ta, images, problems };
  }

  // The one notice for a load (plain text; the caller escapes it).
  function noticeText(name, problems) {
    const out = [`Loaded “${name || 'Untitled rally'}”.`], of = t => problems.filter(p => p.type === t);
    const uniq = a => [...new Set(a)].join(', ');
    const n1 = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    let a = of('image'); if (a.length) out.push(`${n1(a.length, 'sign image', 'sign images')} could not be read (${uniq(a.map(p => p.label))}).`);
    a = of('value'); if (a.length) out.push(`${a.length} ${a.length === 1 ? 'value was' : 'values were'} left blank (${a.map(p => p.label ? `${p.label} ${p.field}` : p.field).join(', ')}).`);
    a = of('noRI'); if (a.length) out.push(`${a.length} ${a.length === 1 ? 'row has' : 'rows have'} no RI (${a.map(p => p.label).join(', ')}).`);
    a = of('dup'); if (a.length) out.push(`${a.length} ${a.length === 1 ? 'duplicate RI was' : 'duplicate RIs were'} dropped (${a.map(p => p.label).join(', ')}).`);
    a = of('ta'); if (a.length) out.push(`${a.length} ${a.length === 1 ? 'Time Allowance was' : 'Time Allowances were'} dropped (${a.map(p => p.label).join(', ')}).`);
    a = of('kind'); if (a.length) out.push(`The file’s kind “${a[0].label}” is not known, so the rally opens on Setup.`);
    return out.join(' ');
  }

  const RallyFile = { FORMAT, VERSION, MAX_BYTES, RallyFileError, crc32, zipWrite, zipOpen, zipRead, sniffImage, fmtLong, parseLong, fmtOM, encode, decode, noticeText };
  if (typeof module !== 'undefined' && module.exports) module.exports = RallyFile; else root.RallyFile = RallyFile;
})(typeof window !== 'undefined' ? window : globalThis);
