"""Page and sign images (issues #6 and #66): bands from the reader's row/y, the page copy and sign images in IndexedDB,
inline sign images on Route and Run, the Page control, tap to expand, Data line, lifecycle (edit, Delete row, Clear, Re-read,
Duplicate, JSON import, Delete rally), orientation, and the two failure paths. The Anthropic API is mocked and the page is a
synthetic ruled table drawn in the browser from invented content (no real pages).
Run from the repo root after a build:
  Windows:    .venv/Scripts/python build.py && .venv/Scripts/python test/e2e/images.py
  Linux/WSL:  .venv/bin/python build.py && .venv/bin/python test/e2e/images.py
Exits 1 if any check fails or an unexpected page error is captured."""
from _common import APP_URL, OUT_DIR, LAYOUTS, launch_browser, check, capture_errors, run
import asyncio, base64, io, json, re
from PIL import Image, ImageChops, ImageStat
from playwright.async_api import async_playwright

# A ruled page (logical 1000 x 1650, drawn at 2x so the page copy is smaller than the original): a heading band, then rows of very
# different heights, with drawn signs in the Instruction cell: row 2 one sign, row 4 two side by side, row 5 none (a tag only),
# row 6 one graphic for two tags, row 7 and 8 short.  turn: 0 upright, 180 upside down, 90 page turned a quarter clockwise.
DRAW = """(turn) => {
  const PW = 1000, PH = 1650, K = 2, T = 3, vx = [60, 110, 170, 240, 300, 360, 700, 940], hs = [50, 90, 300, 60, 160, 75, 170, 30, 200];
  const cv = document.createElement('canvas'); cv.width = PW * K; cv.height = PH * K;
  const c = cv.getContext('2d'); c.scale(K, K); c.fillStyle = '#fff'; c.fillRect(0, 0, PW, PH); c.fillStyle = '#000'; c.strokeStyle = '#000';
  const rules = [220]; for (const h of hs) rules.push(rules[rules.length - 1] + h);
  for (const r of rules) c.fillRect(vx[0], r, vx[7] - vx[0] + T, T);
  for (const x of vx) c.fillRect(x, rules[0], T, rules[rules.length - 1] - rules[0] + T);
  let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const letters = (x0, y0, wmax) => { let x = x0; while (x + 7 < x0 + wmax) { c.fillRect(x, y0, 7, 14); x += 11; } };
  const boxes = {};
  for (let k = 1; k < hs.length; k++) {
    const y0 = rules[k] + T;
    for (let col = 0; col < 7; col++) if (col !== 5) letters(vx[col] + 10, y0 + 12, Math.min(60, vx[col + 1] - vx[col] - 20));
    letters(vx[5] + 12, y0 + 12, 150);
  }
  const diamond = (x, y) => { const cx = x + 40, cy = y + 30; c.lineWidth = 4; c.beginPath(); c.moveTo(cx, cy - 30); c.lineTo(cx + 30, cy); c.lineTo(cx, cy + 30); c.lineTo(cx - 30, cy); c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(cx - 18, cy - 10); c.lineTo(cx + 2, cy - 10); c.lineTo(cx - 18, cy + 8); c.closePath(); c.fill(); c.fillRect(cx - 30, cy + 32, 34, 22); c.fillStyle = '#fff'; for (let i = 0; i < 3; i++) c.fillRect(cx - 26 + i * 11, cy + 36, 7, 14); c.fillStyle = '#000'; return [cx - 32, cy - 32, cx + 32, cy + 54]; };
  const rect = (x, y) => { c.lineWidth = 3; c.strokeRect(x, y, 90, 56); letters(x + 10, y + 12, 70); letters(x + 10, y + 32, 50); return [x, y, x + 90, y + 56]; };
  const photo = (x, y) => { for (let j = 0; j < 64; j += 2) for (let i = 0; i < 96; i += 2) { const v = 30 + Math.floor(rnd() * 190); c.fillStyle = `rgb(${v},${v},${v})`; c.fillRect(x + i, y + j, 2, 2); } c.fillStyle = '#000'; return [x, y, x + 96, y + 64]; };
  const cell = n => ({ x: vx[5] + 20, y: rules[n] + T + 40 });
  boxes[2] = [diamond(cell(2).x, cell(2).y)];
  boxes[4] = [rect(cell(4).x, cell(4).y), diamond(cell(4).x + 160, cell(4).y)];
  boxes[6] = [photo(cell(6).x, cell(6).y)];
  let out = cv;
  if (turn) {
    const o = document.createElement('canvas'), q = o.getContext('2d');
    if (turn === 180) { o.width = cv.width; o.height = cv.height; q.translate(o.width, o.height); q.rotate(Math.PI); }
    else { o.width = cv.height; o.height = cv.width; q.translate(o.width, 0); q.rotate(Math.PI / 2); }   // 90: the page turned a quarter clockwise
    q.drawImage(cv, 0, 0); out = o;
  }
  const centre = n => (rules[n] + T + hs[n] / 2) / PH;                     // vertical centre of row n as a fraction of the upright page
  return { b64: out.toDataURL('image/jpeg', 0.92).split(',')[1], PW, PH, K, T, rules, hs, vx, boxes, ys: [1, 2, 3, 4, 5, 6, 7, 8].map(centre) };
}"""

# The orientation fixtures (below): the upright page is drawn larger than the page-copy limit, and Pillow writes every file.
ORIENT_INV = {1: None, 2: Image.Transpose.FLIP_LEFT_RIGHT, 3: Image.Transpose.ROTATE_180, 4: Image.Transpose.FLIP_TOP_BOTTOM,
              5: Image.Transpose.TRANSPOSE, 6: Image.Transpose.ROTATE_90, 7: Image.Transpose.TRANSVERSE, 8: Image.Transpose.ROTATE_270}
CROP_LIMIT = 12.0     # mean absolute grey-level difference of two sign crops at 64 x 64: the limit for "the same crop" (see the check on its margin)


def jpeg_with_tag(im, tag):
    """Every fixture goes through this one JPEG encoding; tag is the EXIF orientation written (the pixels are already stored as given)."""
    ex = Image.Exif(); ex[0x0112] = tag
    out = io.BytesIO(); im.save(out, 'JPEG', quality=90, exif=ex)
    return out.getvalue()


def thumb(b64):
    return Image.open(io.BytesIO(base64.b64decode(b64))).convert('L').resize((64, 64), Image.BILINEAR)


def diff64(a, b):
    return ImageStat.Stat(ImageChops.difference(a, b)).mean[0]


IDB_SIZES = """() => new Promise(res => { const q = indexedDB.open('rallyMonteStyle.pages');
  q.onupgradeneeded = () => q.result.createObjectStore('pages');
  q.onsuccess = () => { const out = {}; const c = q.result.transaction('pages').objectStore('pages').openCursor();
    c.onsuccess = () => { const k = c.result; if (k) { out[k.key] = k.value.size; k.continue(); } else res(out); }; }; })"""

# All checks for "what is on screen for this row" are by property, not by RI number.
ROW = {
    'plain':       "R().rows.findIndex(x => x.band && !/\\[sign:/.test(x.instr))",
    'inline':      "R().rows.findIndex(x => x.signs.length === 1 && (x.instr.match(/\\[sign:/g) || []).length === 1)",
    'two':         "R().rows.findIndex(x => x.signs.length === 2 && (x.instr.match(/\\[sign:/g) || []).length === 2)",
    'mismatch':    "R().rows.findIndex(x => x.signs.length === 1 && (x.instr.match(/\\[sign:/g) || []).length === 2)",
    'placeholder': "R().rows.findIndex(x => x.signs.length === 0 && /\\[sign:/.test(x.instr))",
    'nobandrow':   "R().rows.findIndex(x => !x.band)",
}
GO = """(pick) => { R().rows.forEach(x => { x.done = false; x.ttDone = null; x.doneAt = null; x.estLock = null; });
  const k = eval(pick); for (let i = 0; i < k; i++) R().rows = Core.completeActive(R(), 0); save(R()); show('run'); }"""


async def main():
    api = {'rows': [], 'rotation': 0, 'calls': 0}
    async with async_playwright() as p:
        b = await launch_browser(p)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        await ctx.add_init_script("""(() => { const put = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (...a) { if (window.__failPut) throw new DOMException('forced', 'QuotaExceededError'); return put.apply(this, a); }; })()""")

        async def handler(route):
            api['calls'] += 1
            body = {'rotation': api['rotation'], 'rows': api['rows']}
            await route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'},
                                body=json.dumps({'content': [{'type': 'text', 'text': '```json\n' + json.dumps(body) + '\n```'}], 'stop_reason': 'end_turn'}))
        await ctx.route('https://api.anthropic.com/**', handler)
        pg = await ctx.new_page(); capture_errors(pg, label='images')
        await pg.goto(APP_URL)
        await pg.evaluate("localStorage.clear(); localStorage.setItem('rallyMonteStyle.apikey', 'sk-ant-test'); indexedDB.deleteDatabase('rallyMonteStyle.pages')")
        await pg.reload(); await pg.click('#btnNew')

        geo = await pg.evaluate(DRAW, 0)
        jpeg = base64.b64decode(geo['b64'])
        ys = [round(y, 3) for y in geo['ys']]
        T, PH, PW, rules, hs, vx, K = geo['T'], geo['PH'], geo['PW'], geo['rules'], geo['hs'], geo['vx'], geo['K']
        upside = base64.b64decode((await pg.evaluate(DRAW, 180))['b64'])
        sideways = base64.b64decode((await pg.evaluate(DRAW, 90))['b64'])

        def rows(ys):
            base = lambda ri, instr, **kw: {'ri': ri, 'om': '1.10', 'czt': None, 'cp': None, 'instr': instr, 'info': '', **kw}
            return [base(801, 'Turn left at the barn', row=1, y=ys[0]),
                    base(802, 'CHECKPOINT at [sign: deer crossing]', row=2, y=ys[1]),
                    base(803, 'Bear right at the mill', row=3, y=ys[2]),
                    base(804, 'At [sign: stop] then [sign: yield]', row=4, y=ys[3]),
                    base(805, 'Right at [sign: unnamed marker]', row=5, y=ys[4]),
                    base(806, 'Left at [sign: red barn] and [sign: silo]', row=6, y=ys[5]),
                    base(807, 'Right at the creek', row=2, y=ys[6]),         # row names band 2, y says band 7: y wins, flagged
                    base(808, 'Stop at the mill')]                          # no row, no y: no image

        api['rows'] = rows(ys)

        async def read(files=True, data=jpeg):
            if files:
                await pg.set_input_files('#fPages', files=[{'name': 'invented-page.jpg', 'mimeType': 'image/jpeg', 'buffer': data}])
            await pg.click('#btnRead')
            await pg.wait_for_selector('#modal.on', timeout=60000)
            txt = await pg.inner_text('#mBody')
            await pg.click('#mOk')
            return txt

        async def sizes():
            return await pg.evaluate(IDB_SIZES)

        async def until(js, msg, timeout=6000):
            try:
                await pg.wait_for_function(js, timeout=timeout)
                return check(True, msg)
            except Exception:
                return check(False, msg)

        async def data_line():
            await pg.click('#tabs button[data-v=data]')
            t = await pg.inner_text('#dataBody')
            await pg.click('#tabs button[data-v=route]')
            return next((l for l in t.split('\n') if l.startswith('Page images:')), '(no Page images line)')

        # ---- read: bands, signs, page copy, Data line ----
        await pg.click('#tabs button[data-v=route]')
        txt = await read()
        check('could not be saved' not in txt, 'a normal read reports no image problem')
        info = await pg.evaluate("R().rows.map(x => ({ instr: x.instr, band: x.band || null, signs: x.signs, keys: Object.keys(x) }))")
        banded = [x for x in info if x['band']]
        check(len(banded) == 7 and len([x for x in info if not x['band']]) == 1, 'rows with valid row/y have a band; the row without them has none')
        check(all(set(x['band']) - {'check', 'pageCheck'} == {'page', 'top', 'bottom', 'left', 'right', 'src'} for x in banded), 'a band is {page, top, bottom, left, right, src} plus flags')
        check(all('row' not in x['keys'] and 'y' not in x['keys'] and 'tags' not in x['keys'] for x in info), 'the raw row, y, and tag count are not stored')
        tall = max(banded, key=lambda x: x['band']['bottom'] - x['band']['top'])['band']
        # the page copy is the whole sheet (the drawn page is the sheet), so expected fractions come from the drawn geometry
        fy = lambda y: y / PH
        fx = lambda x: x / PW
        check(abs(tall['top'] - fy(rules[2] + T)) < 0.006 and abs(tall['bottom'] - fy(rules[3])) < 0.006, 'the tallest band follows the drawn rules')
        check(abs(tall['left'] - fx(vx[5] + T)) < 0.01 and abs(tall['right'] - fx(vx[7])) < 0.01, 'the band runs from the Instruction rule to the table edge')
        check(all(x['band']['src'] in ('rules', 'y') for x in banded), 'every band has a src')
        flagged = [x for x in banded if x['band'].get('check')]
        check(len(flagged) == 1 and flagged[0]['band']['src'] == 'y' and abs(flagged[0]['band']['top'] - fy(rules[7] + T)) < 0.006, 'when y disagrees with row, y decides, src is y, and the band is marked check')
        counts = [(len(x['signs']), len(re.findall(r'\[sign:', x['instr']))) for x in info]
        check(sorted([c for c in counts if c[0]], reverse=True) == [(2, 2), (1, 2), (1, 1)], f'graphics found: one, two side by side, one for two tags ({counts})')
        check(sum(len(x['signs']) for x in info) == 4, 'four sign images in all; a row with a tag but no graphic gets none')
        k1 = await sizes()
        check(len([k for k in k1 if k.startswith('pg')]) == 1 and len([k for k in k1 if k.startswith('sg')]) == 4, f'one page copy and four sign images are stored ({len(k1)})')
        line = await data_line()
        m = re.fullmatch(r'Page images: 1 page, (\d+\.\d) MB on this device', line)
        check(m is not None, f'Data line, singular ({line})')
        check(m is not None and abs(float(m.group(1)) - sum(k1.values()) / 1048576) <= 0.051, 'the Data size includes the sign images')

        # ---- sign crops come from the original photo at full resolution ----
        await until("document.querySelectorAll('#rtEdit img.sgimg[src]').length >= 4", 'Route shows the sign images')
        dim = await pg.evaluate("""(pick) => { const x = R().rows[eval(pick)], im = document.querySelector('#rtEdit img.sgimg[data-sg="' + x.signs[0] + '"]'); return { w: im.naturalWidth, h: im.naturalHeight }; }""", ROW['inline'])
        want = (geo['boxes']['2'][0][3] - geo['boxes']['2'][0][1]) * K
        check(dim['h'] >= 0.85 * want, f'a sign image is cut from the original photo, not the smaller page copy ({dim["h"]} px for {want} drawn)')
        check(max(dim['w'], dim['h']) <= 800, 'sign images are at most 800 px on the long side')

        # ---- Route tab ----
        check(await pg.evaluate("[...document.querySelectorAll('#rtEdit img.sgimg')].every(i => i.naturalWidth > 0 && i.naturalHeight > 0)"), 'Route sign images decode')
        check(await pg.evaluate("document.querySelectorAll('#rtEdit button.pgbtn').length") == 7, 'Route has a Page control on each banded row')
        check(await pg.evaluate("document.querySelectorAll('#rtEdit img.pgimg').length") == 0, 'the whole-row band image is not shown inline')
        check(await pg.evaluate("document.querySelectorAll('#rtEdit .sgph').length") >= 3, 'a tag with no image is a placeholder (the tag-only row, and the two tags of the mismatched row)')
        ph = await pg.evaluate("(() => { const e = document.querySelector('#rtEdit .sgph'); const s = getComputedStyle(e); return { b: s.borderStyle, c: s.color, t: e.textContent }; })()")
        check(ph['b'] == 'dashed' and ph['t'] in ('unnamed marker', 'red barn', 'silo'), f'the placeholder is a dashed box with the tag words ({ph["t"]})')
        ftxt = await pg.inner_text('.flags')
        nb = await pg.evaluate("(() => { const x = R().rows.find(x => !x.band); return x && { ri: String(x.ri), tag: x.imgCheck && x.imgCheck.slice(0, 2) }; })()")
        check(nb is not None and nb['tag'] == 'pg', 'the row read from the page with no band stores the page copy id on the row')
        check(len(re.findall(r'RI \S+: check page image\b', ftxt)) == 2 and f"RI {nb['ri']}: check page image" in ftxt, 'Route lists "check page image" for the banded row to check and for the row with no band')
        check('page image missing' not in ftxt and 'check page images' not in ftxt, 'no missing flag while the copies exist, no page flag')
        check(await pg.evaluate("document.querySelector('#rtEdit .pgrow').previousElementSibling.querySelector('input[data-k=instr]') !== null"), 'the image line sits under its row')
        await pg.screenshot(path=str(OUT_DIR / 'images-route.png'))
        # the Page control opens the whole band full screen
        await pg.click('#rtEdit button.pgbtn >> nth=1')
        await until("document.getElementById('imgView').classList.contains('on') && document.getElementById('imgFull').naturalWidth > 0", 'the Page control opens the band full screen')
        check(await pg.evaluate("document.getElementById('imgFull').naturalWidth > document.getElementById('imgFull').naturalHeight"), 'the band is wide, not a sign')
        await pg.mouse.click(5, 5)
        check(not await pg.evaluate("document.getElementById('imgView').classList.contains('on')"), 'a tap closes it')

        # ---- Run card: layouts ----
        VIS = """() => { const top = document.querySelector('.runtop').getBoundingClientRect();
          const lim = { b: Math.min(innerHeight, top.bottom) + 0.5, r: Math.min(innerWidth, top.right) + 0.5 };
          return ['btnDone', 'btnUndo', 'btnTA', 'fSpeedo'].filter(id => { const r = document.getElementById(id).getBoundingClientRect();
            return !(r.top >= -0.5 && r.left >= -0.5 && r.bottom <= lim.b && r.right <= lim.r && r.width > 0); })
            .map(id => { const r = document.getElementById(id).getBoundingClientRect(); return id + ' bottom ' + Math.round(r.bottom) + ' > ' + Math.round(lim.b); }); }"""
        GEOM = """() => { const t = document.querySelector('.ac-instr'), card = document.querySelector('.active-card').getBoundingClientRect(),
          ims = [...t.querySelectorAll('img.sgimg')], cr = t.getBoundingClientRect();
          return { n: ims.length, inline: ims.filter(i => i.closest('.sgafter') === null).length, after: t.querySelectorAll('.sgafter img').length, ph: t.querySelectorAll('.sgph').length,
            maxh: Math.max(0, ...ims.map(i => i.getBoundingClientRect().height)), maxw: Math.max(0, ...ims.map(i => i.getBoundingClientRect().width)),
            inside: ims.every(i => { const r = i.getBoundingClientRect(); return r.left >= cr.left - 1 && r.right <= cr.right + 1; }), loaded: ims.every(i => i.naturalWidth > 0),
            card: card.width, page: !!document.querySelector('.active-card .pgbtn') }; }"""
        for w, h, label in LAYOUTS:
            await pg.set_viewport_size({'width': w, 'height': h})
            for kind, want in [('plain', (0, 0, 0, 0)), ('inline', (1, 1, 0, 0)), ('two', (2, 2, 0, 0)), ('mismatch', (1, 0, 1, 2)), ('placeholder', (0, 0, 0, 1)), ('nobandrow', (0, 0, 0, 0))]:
                await pg.evaluate(GO, ROW[kind])
                if want[0]:
                    await until("document.querySelectorAll('.ac-instr img.sgimg[src]').length > 0", f'{label} {kind}: the card images load')
                g = await pg.evaluate(GEOM)
                check((g['n'], g['inline'], g['after'], g['ph']) == want, f'{label} {kind}: images, inline, after, placeholders = {want} (got {(g["n"], g["inline"], g["after"], g["ph"])})')
                check(g['loaded'] and g['inside'], f'{label} {kind}: images decode and stay inside the instruction')
                check(g['maxh'] <= 76.5, f'{label} {kind}: image height {g["maxh"]:.0f} within the cap')
                check(g['maxw'] <= g['card'] + 0.5, f'{label} {kind}: image within the card width')
                check(g['page'] == (kind != 'nobandrow'), f'{label} {kind}: the Page control is there only when the row has a band')
                vis = await pg.evaluate(VIS)
                check(not vis, f'{label} {kind}: Complete, Undo, TA and the speedometer stay fully visible ({vis})')
                check(await pg.evaluate("!document.querySelector('.ac-img.pgimg') && !document.querySelector('.ac-media')"), f'{label} {kind}: no whole-row image on the card')
            await pg.screenshot(path=str(OUT_DIR / f'images-run-{w}x{h}.png'))
        await pg.set_viewport_size({'width': 390, 'height': 844})
        # the Run list shows the same images inline
        await pg.evaluate(GO, ROW['two'])
        await until("document.querySelectorAll('#runTbl img.sgimg[src]').length >= 4", 'the Run list shows sign images in the instruction cells')
        check(await pg.evaluate("document.querySelectorAll('#runTbl img.pgimg').length") == 0, 'the Run list has no whole-row images')

        # tap a sign to expand; the Page control opens the band
        done0 = await pg.evaluate("R().rows.filter(x => x.done).length")
        await pg.click('.ac-instr img.sgimg >> nth=0')
        check(await pg.evaluate("document.getElementById('imgView').classList.contains('on')"), 'tapping a sign opens it full screen')
        check(await pg.evaluate("getComputedStyle(document.getElementById('imgView')).backgroundColor") == 'rgb(0, 0, 0)', 'the full-screen view has a dark background')
        covered = await pg.evaluate("""() => { const r = document.getElementById('btnDone').getBoundingClientRect();
          const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e.closest('#imgView'); }""")
        check(covered, 'Complete is covered while the image is open')
        await pg.mouse.click(5, 5)
        check(not await pg.evaluate("document.getElementById('imgView').classList.contains('on')"), 'a tap anywhere closes it')
        await pg.click('.active-card .pgbtn')
        await until("document.getElementById('imgView').classList.contains('on') && document.getElementById('imgFull').naturalWidth > 0", 'the Run card Page control opens the band')
        await pg.mouse.click(5, 5)
        check(await pg.evaluate("R().rows.filter(x => x.done).length") == done0, 'opening and closing changes no run state')

        # Night theme dims, never inverts
        await pg.evaluate("store.prefs.theme = 'night'; save(); applyTheme()")
        f = await pg.evaluate("getComputedStyle(document.querySelector('.ac-instr img.sgimg')).filter")
        check('brightness(0.6)' in f and 'invert' not in f, f'Night dims the sign images to 60% ({f})')
        await pg.evaluate("store.prefs.theme = 'day'; save(); applyTheme()")

        # reload keeps images
        await pg.reload(); await pg.wait_for_selector('#tabs')
        await until("document.querySelector('.ac-instr img.sgimg') && document.querySelector('.ac-instr img.sgimg').naturalWidth > 0", 'images survive a reload')

        # ---- editing a row keeps its images; placement follows the counts ----
        await pg.click('#tabs button[data-v=route]')
        ix = await pg.evaluate(ROW['inline'])
        before = await pg.evaluate(f"R().rows[{ix}].signs.slice()")
        await pg.fill(f'#rtEdit input[data-i="{ix}"][data-k=instr]', 'CHECKPOINT at [sign: deer crossing] and [sign: extra]'); await pg.keyboard.press('Tab')
        check(await pg.evaluate(f"JSON.stringify(R().rows[{ix}].signs) === JSON.stringify({json.dumps(before)})"), 'editing the text keeps the sign images')
        await pg.evaluate("renderRoute()")
        check(await pg.evaluate(f"document.querySelectorAll('#rtEdit tr.pgrow')[{ix}].querySelectorAll('.sgafter img').length") == 1, 'counts now differ: the image follows the text')
        await pg.fill(f'#rtEdit input[data-i="{ix}"][data-k=instr]', 'CHECKPOINT at [sign: deer crossing]'); await pg.keyboard.press('Tab'); await pg.evaluate("renderRoute()")
        check(await pg.evaluate(f"document.querySelectorAll('#rtEdit tr.pgrow')[{ix}].querySelectorAll('.sgafter img').length") == 0, 'back to one tag: the image replaces it again')

        # ---- JSON export, import, Duplicate ----
        j = await pg.evaluate("JSON.stringify({ app: 'rally-monte-style', version: 1, rally: R() })")
        check('data:image' not in j and len(j) < 25000, f'JSON export holds no image data ({len(j)} bytes)')
        await pg.click('#tabs button[data-v=data]')
        await pg.set_input_files('#fImport', files=[{'name': 'r.json', 'mimeType': 'application/json', 'buffer': j.encode()}])
        await pg.wait_for_function("R().rows.length > 0 && R().rows.every(x => !x.band && x.signs.length === 0)")
        check(True, 'a JSON-imported rally has no bands and no sign images')
        await pg.click('#tabs button[data-v=route]')
        check('page image' not in (await pg.inner_text('#routeBody')), 'the imported rally has no page image flags')
        check(await pg.evaluate("document.querySelectorAll('#rtEdit img.sgimg').length") == 0 and await pg.evaluate("document.querySelectorAll('#rtEdit button.pgbtn').length") == 0, 'the imported rally shows no images and no Page control')
        check(await pg.evaluate("document.querySelectorAll('#rtEdit .sgph').length") >= 1, 'the imported rally shows its tags as placeholders')
        check(await data_line() == 'Page images: none', 'the imported rally says Page images: none')
        await pg.evaluate("store.cur = Object.keys(store.rallies).find(k => store.rallies[k].rows.some(x => x.band)); renderAll()")
        n_before = len(await sizes())
        await pg.click('#tabs button[data-v=data]'); await pg.click('#bDup')
        check(await pg.evaluate("R().rows.length > 0 && R().rows.every(x => !x.band && x.signs.length === 0) && /\\(copy\\)$/.test(R().name)"), 'Duplicate rally drops the bands and sign images')
        check(len(await sizes()) == n_before, 'the original rally keeps its page copy and sign images after Duplicate')
        await pg.evaluate("store.cur = Object.keys(store.rallies).find(k => store.rallies[k].rows.some(x => x.band)); renderAll()")

        # ---- Re-read: a valid new band replaces the old band and images; a row with no valid band keeps both ----
        old_ids = set((await sizes()).keys())
        api['rows'] = rows(ys)[:4]
        api['rows'][0] = {k: v for k, v in api['rows'][0].items() if k not in ('row', 'y')}      # returned without row/y: keeps its old band
        api['rows'][1] = {k: v for k, v in api['rows'][1].items() if k not in ('row', 'y')}      # a row with a sign, also keeps its old band and images
        await pg.click('#tabs button[data-v=route]')
        keep_signs = await pg.evaluate("R().rows.filter(x => /deer crossing/.test(x.instr))[0].signs.slice()")
        await read()
        await until("R().rows.filter(x => x.band).length === 7", 'Re-read keeps old bands for rows returned without row/y, and rows not returned')
        now = await pg.evaluate("R().rows.filter(x => /deer crossing/.test(x.instr))[0].signs")
        check(now == keep_signs, 'a row with no valid new band keeps its old images')
        sw = await pg.evaluate("R().rows.filter(x => /stop\\] then/.test(x.instr))[0].signs")
        check(len(sw) == 2 and not set(sw) & old_ids, 'a row with a valid new band gets new images, replacing the old')
        await asyncio.sleep(0.4)
        ids_now = set((await sizes()).keys())
        used = await pg.evaluate("[...new Set(R().rows.flatMap(x => [x.band && x.band.page, ...x.signs]).filter(Boolean))]")
        check(ids_now == set(used), 'every stored image is in use: the replaced sign images were freed')

        # ---- Delete row frees its sign images; Clear Route Instructions frees everything ----
        ix = await pg.evaluate(ROW['two'])
        mine = await pg.evaluate(f"R().rows[{ix}].signs.slice()")
        await pg.click(f'#rtEdit [data-del="{ix}"]'); await pg.click('#mOk')
        await asyncio.sleep(0.4)
        left = set((await sizes()).keys())
        check(not (left & set(mine)) and len(mine) == 2, 'Delete row frees the row\'s sign images')
        check(any(k.startswith('pg') for k in left), 'Delete row keeps the page copy other rows still use')
        await pg.click('#btnClearRI'); await pg.click('#mOk')
        await asyncio.sleep(0.5)
        check(await sizes() == {}, 'Clear Route Instructions frees the page copies and the sign images')
        check(await data_line() == 'Page images: none', 'the Data line falls to none')

        # ---- orientation: upside down (the reader says 180) and a page turned a quarter (the pre-pass turns it, the reader then says 180) ----
        for name, data, ys_sent in [('upside-down page', upside, [round(1 - y, 3) for y in ys]), ('sideways page', sideways, [round(1 - y, 3) for y in ys])]:
            api['rotation'] = 180; api['rows'] = rows(ys_sent)
            await pg.click('#tabs button[data-v=route]')
            await read(data=data)
            await until("R().rows.filter(x => x.band).length === 7", f'{name}: the rows have bands')
            info = await pg.evaluate("R().rows.map(x => ({ band: x.band || null, signs: x.signs }))")
            bb = [x['band'] for x in info if x['band']]
            tall = max(bb, key=lambda x: x['bottom'] - x['top'])
            check(abs(tall['top'] - fy(rules[2] + T)) < 0.006 and abs(tall['bottom'] - fy(rules[3])) < 0.006, f'{name}: the tallest band follows the drawn rules')
            check(len([x for x in bb if x.get('check')]) == 1 and all(x['src'] in ('rules', 'y') for x in bb), f'{name}: only the row whose y disagrees is flagged')
            check(sum(len(x['signs']) for x in info) == 4, f'{name}: four sign images')
            await pg.click('#btnClearRI'); await pg.click('#mOk'); await asyncio.sleep(0.4)
        api['rotation'] = 0

        # (rotation 90 or 270, when the pre-pass missed, is covered by the unit tests: it cannot be made to happen here)

        # ---- orientation: nine fixtures through the photo picker (DESIGN § Testing) ----
        # o1..o8 carry EXIF orientation 1..8 with the pixels stored by the inverse transform; o6_raw is o6's sideways pixels saved with tag 1.
        # All come from one upright page larger than the page-copy limit, written by Pillow through one JPEG encoding. The tests never apply
        # EXIF themselves: the browser's decode must give the same bands and sign images as o1.
        big = await pg.evaluate(DRAW.replace('K = 2,', 'K = 2.4,').replace("toDataURL('image/jpeg', 0.92)", "toDataURL('image/png')"), 0)
        upright = Image.open(io.BytesIO(base64.b64decode(big['b64']))).convert('RGB')
        check(upright.size[0] >= 2400 and upright.size[1] >= 3960 and max(upright.size) > 2000, f'the orientation page is above the page-copy limit ({upright.size})')
        fixtures = {f'o{n}': jpeg_with_tag(upright if t is None else upright.transpose(t), n) for n, t in ORIENT_INV.items()}
        fixtures['o6_raw'] = jpeg_with_tag(upright.transpose(ORIENT_INV[6]), 1)
        api['rotation'] = 0; api['rows'] = rows(ys)
        GRAB = r"""async () => { const db = await new Promise(r => { const q = indexedDB.open('rallyMonteStyle.pages'); q.onsuccess = () => r(q.result); });
          const get = id => new Promise(r => { const q = db.transaction('pages').objectStore('pages').get(id); q.onsuccess = () => r(q.result); });
          const b64 = bl => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(bl); });
          const out = []; for (const x of R().rows) { const s = []; for (const id of x.signs || []) s.push(await b64(await get(id)));
            out.push({ tags: (x.instr.match(/\[sign:/g) || []).length, band: x.band ? [x.band.top, x.band.bottom, x.band.left, x.band.right] : null, signs: s }); }
          return { rows: out, flags: document.querySelector('.flags') ? document.querySelector('.flags').textContent : '' }; }"""
        got = {}
        await pg.click('#tabs button[data-v=route]')
        for name, data in fixtures.items():
            await read(data=data)
            await until("R().rows.filter(x => x.band).length > 0", f'{name}: the rows have bands')
            got[name] = await pg.evaluate(GRAB)
            await pg.click('#btnClearRI'); await pg.click('#mOk'); await asyncio.sleep(0.4)
        ref = got['o1']
        tagged_banded = [i for i, r in enumerate(ref['rows']) if r['tags'] and r['band']]
        check(len(tagged_banded) >= 3 and sum(len(r['signs']) for r in ref['rows']) >= 4, 'the reference o1 has tagged rows with bands and sign images')
        noise = 0.0
        for name, g in got.items():
            if name == 'o1':
                continue
            check(len(g['rows']) == len(ref['rows']) and all((a['band'] is None) == (b['band'] is None) for a, b in zip(g['rows'], ref['rows'])), f'{name}: the same rows have bands as o1')
            check(all(a['band'] is None or max(abs(u - v) for u, v in zip(a['band'], b['band'])) < 0.004 for a, b in zip(g['rows'], ref['rows'])), f'{name}: the same bands as o1')
            check([len(r['signs']) for r in g['rows']] == [len(r['signs']) for r in ref['rows']], f'{name}: the same sign count per row as o1')
            ds = [diff64(thumb(ca), thumb(cr)) for ra, rb in zip(g['rows'], ref['rows']) for ca, cr in zip(ra['signs'], rb['signs'])]
            noise = max([noise] + ds)
            check(len(ds) >= 4 and max(ds) <= CROP_LIMIT, f'{name}: every sign crop matches o1 (largest difference {max(ds, default=-1):.1f} of {CROP_LIMIT})')
        check('no sign images found' not in ref['flags'], 'a normal read lists no "no sign images found" flag')
        # the measure must tell a wrong crop from a right one: o1's crops against mirrored and quarter-turned copies of themselves
        errs = []
        for r in ref['rows']:
            for cb in r['signs']:
                im = Image.open(io.BytesIO(base64.b64decode(cb))).convert('L')
                for t in (Image.Transpose.FLIP_LEFT_RIGHT, Image.Transpose.FLIP_TOP_BOTTOM, Image.Transpose.ROTATE_90):
                    errs.append(diff64(im.resize((64, 64), Image.BILINEAR), im.transpose(t).resize((64, 64), Image.BILINEAR)))
        print(f'info: crop noise ceiling {noise:.1f}, limit {CROP_LIMIT}, smallest error difference {min(errs):.1f}')
        check(len(errs) >= 12 and min(errs) >= 2 * CROP_LIMIT, f'the crop measure tells a mirrored or turned crop from a right one (smallest error {min(errs):.1f}, limit {CROP_LIMIT})')
        api['rows'] = rows(ys)

        # ---- the page flag for tagged rows that got no sign image ----
        await read()
        await until("R().rows.filter(x => x.band).length > 0", 'rows for the no-sign-images flag check')
        await pg.evaluate("() => { R().rows.forEach(x => { x.signs = []; }); save(R()); }")
        await pg.reload(); await pg.wait_for_selector('#tabs'); await pg.click('#tabs button[data-v=route]')
        want = await pg.evaluate(r"""() => { const t = R().rows.filter(x => x.band && /\[sign:/.test(x.instr)); return { a: String(t[0].ri), b: String(t[t.length - 1].ri), ris: t.map(x => String(x.ri)), n: t.length }; }""")
        await until("document.querySelector('.flags') && /no sign images found/.test(document.querySelector('.flags').textContent)", 'tagged rows with no sign images are flagged')
        ftxt = await pg.inner_text('.flags')
        check(want['n'] >= 2 and len(re.findall('no sign images found', ftxt)) == 1 and f"RI {want['a']}–{want['b']}: no sign images found" in ftxt, f"the flag is listed once, from the first to the last tagged row ({want['a']}–{want['b']})")
        lit = await pg.evaluate(r"""() => [...document.querySelectorAll('#rtEdit tr')].map(tr => ({ ri: (tr.querySelector('input[data-k=ri]') || {}).value, flag: tr.classList.contains('flag') }))""")
        by = {x['ri']: x['flag'] for x in lit if x['ri'] is not None}
        check(all(by.get(ri) for ri in want['ris']), 'every tagged row highlights')
        plain = await pg.evaluate(r"""() => R().rows.filter(x => x.band && !x.band.check && !x.band.pageCheck && !/\[sign:/.test(x.instr)).map(x => String(x.ri))""")
        check(len(plain) >= 1 and not any(by.get(ri) for ri in plain), 'banded rows with no tags do not highlight')
        await pg.evaluate(r"() => { R().rows.forEach(x => { x.instr = x.instr.replace(/\[sign:[^\]]*\]/g, 'x'); }); save(R()); }")
        await pg.reload(); await pg.wait_for_selector('#tabs'); await pg.click('#tabs button[data-v=route]')
        check('no sign images found' not in (await pg.inner_text('.flags') if await pg.query_selector('.flags') else ''), 'editing the tags out clears the flag')
        await pg.click('#btnClearRI'); await pg.click('#mOk'); await asyncio.sleep(0.4)

        # ---- failure: the copy cannot be saved ----
        await pg.evaluate("window.__failPut = true")
        api['rows'] = rows(ys)
        await pg.set_input_files('#fPages', files=[{'name': 'invented-page.jpg', 'mimeType': 'image/jpeg', 'buffer': jpeg}])
        await pg.click('#btnRead'); await pg.wait_for_selector('#modal.on', timeout=60000)
        txt = await pg.inner_text('#mBody'); await pg.click('#mOk')
        check('Page images could not be saved on this device; rows from this page have no image.' in txt, 'a failed save adds the summary message')
        check(await pg.evaluate("R().rows.length === 8 && R().rows.every(x => !x.band && x.signs.length === 0)"), 'the read still succeeds, with rows saved without bands or sign images')
        await pg.evaluate("window.__failPut = false")

        # ---- failure: images go missing ----
        await pg.click('#tabs button[data-v=route]'); await read()
        await until("R().rows.filter(x => x.band).length === 7", 'Re-read after the failure gives the rows bands again')
        await pg.evaluate("""new Promise(res => { const q = indexedDB.open('rallyMonteStyle.pages'); q.onsuccess = () => {
          const tx = q.result.transaction('pages', 'readwrite'); tx.objectStore('pages').clear(); tx.oncomplete = () => res(); }; })""")
        await pg.reload(); await pg.wait_for_selector('#tabs'); await pg.click('#tabs button[data-v=route]')
        await until("document.querySelector('.flags') && /page image missing/.test(document.querySelector('.flags').textContent)", 'a deleted copy gives "page image missing"')
        ftxt = await pg.inner_text('.flags')
        check(len(re.findall(r'RI \S+: page image missing', ftxt)) == 7, 'one "page image missing" flag per banded row')
        check(await pg.evaluate("document.querySelectorAll('#rtEdit img.sgimg').length") == 0 and await pg.evaluate("document.querySelectorAll('#rtEdit button.pgbtn').length") == 0, 'rows with missing images show no images and no Page control')
        check(await pg.evaluate("document.querySelectorAll('#rtEdit .sgph').length") >= 5, 'their tags show as placeholders')
        await pg.evaluate(GO, ROW['inline'].replace('x.signs.length === 1 &&', ''))
        check(await pg.evaluate("!document.querySelector('.ac-instr img.sgimg') && !document.querySelector('.active-card .pgbtn') && !/image/i.test(document.querySelector('.active-card').textContent)"), 'Run shows no image, no Page control, and no message when the images are missing')
        check(await pg.evaluate("document.getElementById('btnDone') && !document.getElementById('btnDone').disabled"), 'a missing image never blocks Complete')

        # ---- Delete rally frees its images ----
        await pg.click('#tabs button[data-v=route]'); api['rows'] = rows(ys); await read()
        await until("R().rows.filter(x => x.band).length > 0", 'rows have bands again before Delete rally')
        before = len(await sizes())
        await pg.click('#tabs button[data-v=data]'); await pg.click('#bDel'); await pg.click('#mOk')
        await asyncio.sleep(0.6)
        left = await sizes()
        check(before > 1 and len(left) < before, f'Delete rally frees its images ({before} before, {len(left)} after)')
        in_use = await pg.evaluate("[...new Set(Object.values(store.rallies).flatMap(r => r.rows.flatMap(x => [x.band && x.band.page, ...(x.signs || [])])).filter(Boolean))]")
        check(all(k in in_use for k in left), 'only images other rallies use remain')
        await b.close()

run(main)
