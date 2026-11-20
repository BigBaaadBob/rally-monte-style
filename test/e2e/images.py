"""Page images (issue #6): band from the reader's row/y, page copies in IndexedDB, Run card and Route images,
tap to expand, Data line, freeing, JSON import/Duplicate, and the two failure paths. The Anthropic API is mocked
and the page is a synthetic ruled table drawn in the browser from invented content (no real pages).
Run from the repo root after a build:
  Windows:    .venv/Scripts/python build.py && .venv/Scripts/python test/e2e/images.py
  Linux/WSL:  .venv/bin/python build.py && .venv/bin/python test/e2e/images.py
Exits 1 if any check fails or an unexpected page error is captured."""
from _common import APP_URL, OUT_DIR, LAYOUTS, launch_browser, check, capture_errors, run
import asyncio, base64, json, re
from playwright.async_api import async_playwright

# A ruled page: heading band, then rows of very different heights (short, sign, tall photo, short, short).
DRAW = """() => {
  const W = 800, H = 1200, T = 4, hs = [40, 36, 90, 420, 36, 40];            // heading + 5 rows
  const vx = [20, 70, 120, 190, 400, 590, 780];                              // 7 rules: Instruction starts at vx[4]
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); c.fillStyle = '#000';
  const rules = []; let y = 20;
  for (const h of hs) { rules.push(y); y += T + h; } rules.push(y);
  for (const r of rules) c.fillRect(vx[0], r, vx[6] + T - vx[0], T);
  for (const x of vx) c.fillRect(x, rules[0], T, rules[rules.length - 1] + T - rules[0]);
  c.fillStyle = '#444'; c.font = '14px sans-serif';
  rules.slice(0, -1).forEach((r, i) => c.fillText(i ? 'Row ' + i + ' sample text' : 'RI  OM  CZT  Target  Instruction  Info', 430, r + T + 16));
  c.fillStyle = '#c00'; c.beginPath(); c.arc(480, rules[2] + T + 50, 30, 0, 7); c.fill();           // a "sign"
  const g = c.createLinearGradient(0, rules[3], 0, rules[3] + 400); g.addColorStop(0, '#2a7'); g.addColorStop(1, '#27a');
  c.fillStyle = g; c.fillRect(420, rules[3] + T + 24, 160, 360);                                    // a "photo"
  const centre = n => (rules[n] + T + hs[n] / 2) / H;
  return { b64: cv.toDataURL('image/jpeg', 0.92).split(',')[1], W, H, T, rules, hs, vx, ys: [1, 2, 3, 4, 5].map(centre) };
}"""

IDB_KEYS = """() => new Promise(res => { const q = indexedDB.open('rallyMonteStyle.pages');
  q.onupgradeneeded = () => q.result.createObjectStore('pages');
  q.onsuccess = () => { const g = q.result.transaction('pages').objectStore('pages').getAllKeys(); g.onsuccess = () => res(g.result); }; })"""

# All checks for "what is on screen for this row" are by property, not by RI number.
PICK = {
    'none':  "R().rows.findIndex(x => !x.band)",
    'tall':  "(() => { let k = -1, m = -1; R().rows.forEach((x, i) => { const h = x.band ? x.band.bottom - x.band.top : -1; if (h > m) { m = h; k = i; } }); return k; })()",
    'short': "(() => { let k = -1, m = 9; R().rows.forEach((x, i) => { const h = x.band ? x.band.bottom - x.band.top : 9; if (h < m) { m = h; k = i; } }); return k; })()",
    'sign':  "(() => { let k = -1, m = 9; R().rows.forEach((x, i) => { const h = x.band && /\\[sign:/.test(x.instr) ? x.band.bottom - x.band.top : 9; if (h < m) { m = h; k = i; } }); return k; })()",
}


async def main():
    api = {'rows': [], 'calls': 0}
    async with async_playwright() as p:
        b = await launch_browser(p)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        await ctx.add_init_script("""(() => { const put = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function (...a) { if (window.__failPut) throw new DOMException('forced', 'QuotaExceededError'); return put.apply(this, a); }; })()""")

        async def handler(route):
            api['calls'] += 1
            await route.fulfill(status=200, content_type='application/json', headers={'access-control-allow-origin': '*'},
                                body=json.dumps({'content': [{'type': 'text', 'text': '```json\n' + json.dumps(api['rows']) + '\n```'}], 'stop_reason': 'end_turn'}))
        await ctx.route('https://api.anthropic.com/**', handler)
        pg = await ctx.new_page(); capture_errors(pg, label='images')
        await pg.goto(APP_URL)
        await pg.evaluate("localStorage.clear(); localStorage.setItem('rallyMonteStyle.apikey', 'sk-ant-test'); indexedDB.deleteDatabase('rallyMonteStyle.pages')")
        await pg.reload(); await pg.click('#btnNew')

        geo = await pg.evaluate(DRAW)
        jpeg = base64.b64decode(geo['b64'])
        ys = [round(y, 2) for y in geo['ys']]
        T, H, W, rules, hs, vx = geo['T'], geo['H'], geo['W'], geo['rules'], geo['hs'], geo['vx']

        def rows(ys):
            base = lambda ri, instr, **kw: {'ri': ri, 'om': '1.10', 'czt': None, 'cp': None, 'instr': instr, 'info': '', **kw}
            return [base(801, 'Turn left at the barn', row=1, y=ys[0]),
                    base(802, 'CHECKPOINT at [sign: deer crossing]', row=2, y=ys[1]),
                    base(803, 'Bear right at [sign: photo of a red barn]', row=3, y=ys[2]),
                    base(804, 'Stop at the mill'),                      # no row, no y: no image
                    base(805, 'Right at the creek', row=2, y=ys[4])]    # row names the sign band, y says band 5: y wins, flagged
        api['rows'] = rows(ys)

        async def read(files=True):
            if files:
                await pg.set_input_files('#fPages', files=[{'name': 'invented-page.jpg', 'mimeType': 'image/jpeg', 'buffer': jpeg}])
            await pg.click('#btnRead')
            await pg.wait_for_selector('#modal.on')
            txt = await pg.inner_text('#mBody')
            await pg.click('#mOk')
            return txt

        async def keys():
            return await pg.evaluate(IDB_KEYS)

        async def until(js, msg, timeout=4000):
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

        # ---- read: bands, page copy, Data line ----
        await pg.click('#tabs button[data-v=route]')
        txt = await read()
        check('could not be saved' not in txt, 'a normal read reports no page-image problem')
        info = await pg.evaluate("R().rows.map(x => ({ instr: x.instr, band: x.band || null, keys: Object.keys(x) }))")
        banded = [x for x in info if x['band']]
        check(len(banded) == 4 and len([x for x in info if not x['band']]) == 1, 'rows with valid row/y have a band; the row without them has none')
        check(all(set(x['band']) - {'check'} == {'page', 'top', 'bottom', 'left', 'right'} for x in banded), 'a band is {page, top, bottom, left, right}')
        check(all('row' not in x['keys'] and 'y' not in x['keys'] for x in info), 'the raw row and y are not stored')
        tall = max(banded, key=lambda x: x['band']['bottom'] - x['band']['top'])['band']
        check(abs(tall['top'] - (rules[3] + T) / H) < 0.003 and abs(tall['bottom'] - rules[4] / H) < 0.003, 'the tallest band follows the drawn rules')
        check(abs(tall['left'] - (vx[4] + T) / W) < 0.005 and abs(tall['right'] - vx[6] / W) < 0.005, 'the crop runs from the Instruction rule to the table edge')
        flagged = [x for x in banded if x['band'].get('check')]
        check(len(flagged) == 1 and abs(flagged[0]['band']['top'] - (rules[5] + T) / H) < 0.003, 'when y disagrees with row, y decides and the band is marked check')
        k1 = await keys()
        check(len(k1) == 1, f'one page copy is stored ({len(k1)})')
        line = await data_line()
        check(re.fullmatch(r'Page images: 1 page, \d+\.\d MB on this device', line) is not None, f'Data line, singular ({line})')

        # ---- Route tab ----
        await until("document.querySelectorAll('#rtEdit img.pgimg[src]').length === 4", 'Route shows one image per row with a band')
        n_img = await pg.evaluate("document.querySelectorAll('#rtEdit img.pgimg').length")
        check(n_img == 4, f'rows with no band show no image ({n_img} images for 4 banded rows)')
        check(await pg.evaluate("[...document.querySelectorAll('#rtEdit img.pgimg')].every(i => i.naturalWidth > 0 && i.naturalHeight > 0)"), 'Route images decode')
        ftxt = await pg.inner_text('.flags')
        check(len(re.findall(r'RI \S+: check page image', ftxt)) == 1, 'Route lists one "check page image" flag')
        check('page image missing' not in ftxt, 'no "page image missing" flag while the copies exist')
        check(await pg.evaluate("document.querySelector('#rtEdit .pgrow').previousElementSibling.querySelector('input[data-k=instr]') !== null"), 'the image line sits under its row')
        await pg.screenshot(path=str(OUT_DIR / 'images-route.png'))

        # ---- Run card: layouts, tap to expand ----
        VIS = """() => { const top = document.querySelector('.runtop').getBoundingClientRect();
          const lim = { b: Math.min(innerHeight, top.bottom) + 0.5, r: Math.min(innerWidth, top.right) + 0.5 };
          return ['btnDone', 'btnUndo', 'btnTA', 'fSpeedo'].every(id => { const r = document.getElementById(id).getBoundingClientRect();
            return r.top >= -0.5 && r.left >= -0.5 && r.bottom <= lim.b && r.right <= lim.r && r.width > 0; }); }"""
        GEOM = """() => { const m = document.querySelector('.ac-media'), im = document.querySelector('.ac-img'), t = document.querySelector('.ac-text'),
          card = document.querySelector('.active-card').getBoundingClientRect();
          if (!m) return null; const mr = m.getBoundingClientRect(), tr = t.getBoundingClientRect(), r = im.getBoundingClientRect();
          return { below: mr.top >= tr.bottom - 1, beside: mr.left >= tr.right - 1, h: r.height, w: r.width, nw: im.naturalWidth, nh: im.naturalHeight, card: card.width, loaded: im.naturalWidth > 0 }; }"""
        for w, h, label in LAYOUTS:
            await pg.set_viewport_size({'width': w, 'height': h})
            land = w > h
            for kind in ['none', 'short', 'sign', 'tall']:
                await pg.evaluate("""(pick) => { R().rows.forEach(x => { x.done = false; x.ttDone = null; x.doneAt = null; x.estLock = null; });
                  const k = eval(pick); for (let i = 0; i < k; i++) R().rows = Core.completeActive(R(), 0); save(R()); show('run'); }""", PICK[kind])
                if kind != 'none':
                    await until("document.querySelector('.ac-img') && document.querySelector('.ac-img').naturalWidth > 0", f'{label} {kind}: the card image loads')
                g = await pg.evaluate(GEOM)
                if kind == 'none':
                    check(g is None, f'{label}: a row with no image has no media box (text uses the full width)')
                elif g:
                    check(g['loaded'], f'{label} {kind}: image decoded')
                    check(g['beside'] if land else g['below'], f'{label} {kind}: image is {"beside" if land else "below"} the card text')
                    check(g['h'] <= (110 if land else 120) + 0.5, f'{label} {kind}: image height {g["h"]:.0f} within the cap')
                    check(g['w'] <= g['nw'] + 0.5 and g['h'] <= g['nh'] + 0.5, f'{label} {kind}: not enlarged past natural size')
                    if land: check(g['w'] <= g['card'] * 0.4 + 1, f'{label} {kind}: image within 40% of the card width')
                    else: check(g['w'] <= g['card'] + 0.5, f'{label} {kind}: image within the card width')
                ok = await pg.evaluate(VIS)
                check(ok, f'{label} {kind}: Complete, Undo, TA and the speedometer stay fully visible')
            await pg.screenshot(path=str(OUT_DIR / f'images-run-{w}x{h}.png'))
        await pg.set_viewport_size({'width': 390, 'height': 844})

        # tap to expand (tall row is active from the loop above)
        await pg.evaluate("""(pick) => { R().rows.forEach(x => { x.done = false; x.ttDone = null; x.doneAt = null; x.estLock = null; });
          const k = eval(pick); for (let i = 0; i < k; i++) R().rows = Core.completeActive(R(), 0); save(R()); show('run'); }""", PICK['tall'])
        await until("document.querySelector('.ac-img') && document.querySelector('.ac-img').naturalWidth > 0", 'tall row: card image loads at 390')
        done0 = await pg.evaluate("R().rows.filter(x => x.done).length")
        await pg.click('.ac-img')
        check(await pg.evaluate("document.getElementById('imgView').classList.contains('on')"), 'tapping the image opens it full screen')
        check(await pg.evaluate("getComputedStyle(document.getElementById('imgView')).backgroundColor") == 'rgb(0, 0, 0)', 'the full-screen view has a dark background')
        covered = await pg.evaluate("""() => { const r = document.getElementById('btnDone').getBoundingClientRect();
          const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!e.closest('#imgView'); }""")
        check(covered, 'Complete is covered while the image is open')
        await pg.mouse.click(5, 5)
        check(not await pg.evaluate("document.getElementById('imgView').classList.contains('on')"), 'a tap anywhere closes it')
        check(await pg.evaluate("R().rows.filter(x => x.done).length") == done0, 'opening and closing changes no run state')

        # Night theme dims, never inverts
        await pg.evaluate("store.prefs.theme = 'night'; save(); applyTheme()")
        f = await pg.evaluate("getComputedStyle(document.querySelector('.ac-img')).filter")
        check('brightness(0.6)' in f and 'invert' not in f, f'Night dims the card image to 60% ({f})')
        await pg.evaluate("store.prefs.theme = 'day'; save(); applyTheme()")

        # reload keeps images
        await pg.reload(); await pg.wait_for_selector('#tabs')
        await until("document.querySelector('.ac-img') && document.querySelector('.ac-img').naturalWidth > 0", 'images survive a reload')

        # ---- JSON export, import, Duplicate ----
        j = await pg.evaluate("JSON.stringify({ app: 'rally-monte-style', version: 1, rally: R() })")
        check('data:image' not in j and len(j) < 20000, f'JSON export holds no image data ({len(j)} bytes)')
        await pg.click('#tabs button[data-v=data]')
        await pg.set_input_files('#fImport', files=[{'name': 'r.json', 'mimeType': 'application/json', 'buffer': j.encode()}])
        await pg.wait_for_function("R().rows.length > 0 && R().rows.every(x => !x.band)")
        check(True, 'a JSON-imported rally has no bands')
        await pg.click('#tabs button[data-v=route]')
        check('page image' not in (await pg.inner_text('#routeBody')), 'the imported rally has no page image flags and no images')
        check(await pg.evaluate("document.querySelectorAll('#rtEdit img.pgimg').length") == 0, 'the imported rally shows no images')
        check(await data_line() == 'Page images: none', 'the imported rally says Page images: none')
        await pg.evaluate("store.cur = Object.keys(store.rallies).find(k => R() && store.rallies[k].rows.some(x => x.band)); renderAll()")
        await pg.click('#tabs button[data-v=data]'); await pg.click('#bDup')
        check(await pg.evaluate("R().rows.length > 0 && R().rows.every(x => !x.band) && /\\(copy\\)$/.test(R().name)"), 'Duplicate rally drops the bands')
        check(len(await keys()) == 1, 'the original rally keeps its page copy after Duplicate')
        await pg.evaluate("store.cur = Object.keys(store.rallies).find(k => store.rallies[k].rows.some(x => x.band)); renderAll()")

        # ---- Re-read: a valid new band replaces the old and frees the copy; an invalid one keeps the old band ----
        old_ids = await keys()
        api['rows'] = rows(ys)[:3]
        api['rows'][0] = {k: v for k, v in api['rows'][0].items() if k not in ('row', 'y')}      # returned without row/y: keeps its old band
        await pg.click('#tabs button[data-v=route]')
        await read()
        await until("R().rows.filter(x => x.band).length === 4", 'Re-read keeps the old band of a row returned without row/y, and rows not returned')
        pages_used = await pg.evaluate("[...new Set(R().rows.filter(x => x.band).map(x => x.band.page))]")
        check(len(pages_used) == 2, f'old and new copies are both in use ({len(pages_used)})')
        await asyncio.sleep(0.3)
        check(len(await keys()) == 2, 'two page copies are stored while both are used')

        # ---- Delete row / Clear Route Instructions free copies ----
        tallest = await pg.evaluate(PICK['tall'])
        await pg.click(f'#rtEdit [data-del="{tallest}"]'); await pg.click('#mOk')
        check(len(await keys()) == 2, 'Delete row keeps a copy another row still uses')
        await pg.click('#btnClearRI'); await pg.click('#mOk')
        await asyncio.sleep(0.4)
        check(await keys() == [], 'Clear Route Instructions frees the unused page copies')
        check(await data_line() == 'Page images: none', 'the Data line falls to none')

        # ---- failure: the copy cannot be saved ----
        await pg.evaluate("window.__failPut = true")
        api['rows'] = rows(ys)
        await pg.set_input_files('#fPages', files=[{'name': 'invented-page.jpg', 'mimeType': 'image/jpeg', 'buffer': jpeg}])
        await pg.click('#btnRead'); await pg.wait_for_selector('#modal.on')
        txt = await pg.inner_text('#mBody'); await pg.click('#mOk')
        check('Page images could not be saved on this device; rows from this page have no image.' in txt, 'a failed save adds the summary message')
        check(await pg.evaluate("R().rows.length === 5 && R().rows.every(x => !x.band)"), 'the read still succeeds, with rows saved without bands')
        await pg.evaluate("window.__failPut = false")

        # ---- failure: a copy goes missing ----
        await pg.click('#tabs button[data-v=route]'); await read()
        await until("R().rows.filter(x => x.band).length === 4", 'Re-read after the failure gives the rows bands again')
        await pg.evaluate("""new Promise(res => { const q = indexedDB.open('rallyMonteStyle.pages'); q.onsuccess = () => {
          const tx = q.result.transaction('pages', 'readwrite'); tx.objectStore('pages').clear(); tx.oncomplete = () => res(); }; })""")
        await pg.reload(); await pg.wait_for_selector('#tabs'); await pg.click('#tabs button[data-v=route]')
        await until("document.querySelector('.flags') && /page image missing/.test(document.querySelector('.flags').textContent)", 'a deleted copy gives "page image missing"')
        ftxt = await pg.inner_text('.flags')
        check(len(re.findall(r'RI \S+: page image missing', ftxt)) == 4, 'one "page image missing" flag per banded row')
        check(await pg.evaluate("document.querySelectorAll('#rtEdit img.pgimg').length") == 0, 'rows with a missing copy show no image')
        await pg.evaluate("""(pick) => { const k = eval(pick); R().rows.forEach(x => { x.done = false; }); for (let i = 0; i < k; i++) R().rows = Core.completeActive(R(), 0); save(R()); show('run'); }""", PICK['tall'])
        check(await pg.evaluate("!document.querySelector('.ac-img') && !document.querySelector('.ac-media') && !/image/i.test(document.querySelector('.active-card').textContent)"), 'Run shows no image and no message when the copy is missing')
        check(await pg.evaluate("document.getElementById('btnDone') && !document.getElementById('btnDone').disabled"), 'a missing image never blocks Complete')

        # ---- Delete rally frees its copies ----
        await pg.click('#tabs button[data-v=route]'); api['rows'] = rows(ys); await read()
        await until("R().rows.filter(x => x.band).length > 0", 'rows have bands again before Delete rally')
        before = len(await keys())
        await pg.click('#tabs button[data-v=data]'); await pg.click('#bDel'); await pg.click('#mOk')
        await asyncio.sleep(0.5)
        left = await keys()
        check(before >= 1 and len(left) < before + 0 or not left, f'Delete rally frees its page copies ({before} before, {len(left)} after)')
        in_use = await pg.evaluate("[...new Set(Object.values(store.rallies).flatMap(r => r.rows.filter(x => x.band).map(x => x.band.page)))]")
        check(all(k in in_use for k in left), 'Delete rally frees its page copies (only copies other rallies use remain)')
        await b.close()

run(main)
