"""Rally files (issue #62): the Rallies-tab and Data-tab controls, Save (share sheet, download, cancelling), Load (storage refused,
over 50 MB, kinds, a file built by hand from docs/RALLY-FILE.md), and Delete on the Rallies list. The Save-then-Load round trip with
sign images, Replace, Keep both, and the pending-image cases are in images.py; Replace during a read is in pwa.py.
Run from the repo root after a build:
  Windows:    .venv/Scripts/python build.py && .venv/Scripts/python test/e2e/rallyfile.py
  Linux/WSL:  .venv/bin/python build.py && .venv/bin/python test/e2e/rallyfile.py
Exits 1 if any check fails or an unexpected page error is captured."""
from _common import APP_URL, OUT_DIR, ROOT, LAYOUTS, launch_browser, check, capture_errors, run
import datetime, io, json, zipfile
from playwright.async_api import async_playwright

FIXTURE = ROOT / 'test' / 'fixtures' / 'hand-built.rally'


async def main():
    async with async_playwright() as p:
        b = await launch_browser(p)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); capture_errors(pg, label='rallyfile')
        downloads = []
        pg.on('download', lambda d: downloads.append(d))
        await pg.goto(APP_URL); await pg.evaluate("localStorage.clear(); indexedDB.deleteDatabase('rallyMonteStyle.pages')"); await pg.reload()
        await pg.click('#btnNewSample')
        sample = await pg.evaluate("({ id: R().id, name: R().name, rows: SAMPLE.rows.length, base: fileBase(R()) })")
        await pg.click('#tabs button[data-v=rallies]')

        # ---- Rallies tab (DESIGN § Rallies and navigation) ----
        top = await pg.evaluate("[...document.querySelectorAll('#v-rallies > .narrow > .row > *')].map(e => e.textContent.trim())")
        check(top == ['New rally', 'New from sample', 'Load'], f'the Rallies tab starts with New rally, New from sample, and Load ({top})')
        check(not await pg.evaluate("document.getElementById('fLoad').hasAttribute('accept')"), 'Load has no accept filter')
        per = await pg.evaluate("[...document.querySelectorAll('#rallyList .rally-item')].map(i => [...i.querySelectorAll('button')].map(x => x.textContent.trim()))")
        check(per == [['Open', 'Save', 'Delete']], f'each rally has Open, Save, and Delete ({per})')
        for w, h, label in LAYOUTS:
            await pg.set_viewport_size({'width': w, 'height': h})
            fit = await pg.evaluate("[...document.querySelectorAll('#rallyList .rally-btns button')].every(x => x.getBoundingClientRect().right <= innerWidth) && document.documentElement.scrollWidth <= innerWidth")
            check(fit, f'the rally controls fit the width at {label}')
        await pg.set_viewport_size({'width': 390, 'height': 844})

        # ---- Data tab (DESIGN § Data) ----
        await pg.click(f'[data-open="{sample["id"]}"]'); await pg.click('#tabs button[data-v=data]')
        gone = await pg.evaluate("['fImport', 'cJSON', 'bDup', 'bDel'].filter(id => document.getElementById(id))")
        check(gone == [], f'Import JSON, Copy JSON, Duplicate rally, and Delete rally are off the Data tab ({gone})')
        kept = await pg.evaluate("['xCSV', 'xJSON', 'cCSV', 'bResetRun'].filter(id => !document.getElementById(id))")
        check(kept == [], 'Download CSV, Download JSON, Copy CSV, and Clear run data stay')
        text = await pg.inner_text('#dataBody')
        check('Duplicate' not in text and 'Import' not in text and 'Copy JSON' not in text, 'the Data tab no longer mentions the removed controls')

        # ---- Save: download, share sheet, cancelling the share sheet, a failed share ----
        await pg.click('#tabs button[data-v=rallies]')
        n = len(downloads)
        await pg.click(f'[data-save="{sample["id"]}"]'); await pg.wait_for_timeout(600)
        check(len(downloads) == n + 1 and downloads[-1].suggested_filename == sample['base'] + '.rally', f'Save downloads <date>_<name>.rally ({downloads[-1].suggested_filename if downloads else None})')
        f = OUT_DIR / 'sample.rally'; await downloads[-1].save_as(f)
        z = zipfile.ZipFile(f); doc = json.loads(z.read('rally.json'))
        check(doc['format'] == 'rally-monte-style' and doc['version'] == 1 and doc['kind'] == 'saved' and doc['rally']['name'] == sample['name'] and len(doc['ris']) == sample['rows'], 'the file is a rally-monte-style version 1 file of the rally, kind saved')
        await pg.evaluate("() => { window.__shared = null; navigator.canShare = () => true; navigator.share = async d => { window.__shared = d.files.map(f => [f.name, f.type]); }; }")
        n = len(downloads)
        await pg.click(f'[data-save="{sample["id"]}"]'); await pg.wait_for_timeout(600)
        shared = await pg.evaluate("window.__shared")
        check(shared == [[sample['base'] + '.rally', 'application/octet-stream']] and len(downloads) == n, f'where the device can share the file, Save opens the share sheet and does not download ({shared})')
        await pg.wait_for_function("!document.getElementById('toast').classList.contains('on')")      # the earlier download's toast
        await pg.evaluate("() => { window.__shared = null; navigator.share = async () => { throw new DOMException('cancelled', 'AbortError'); }; }")
        await pg.click(f'[data-save="{sample["id"]}"]'); await pg.wait_for_timeout(600)
        check(len(downloads) == n and not await pg.evaluate("document.getElementById('toast').classList.contains('on')") and not await pg.evaluate("document.getElementById('modal').classList.contains('on')"), 'cancelling the share sheet saves nothing and shows no message')
        await pg.evaluate("() => { navigator.share = async () => { throw new DOMException('no', 'NotAllowedError'); }; }")
        await pg.click(f'[data-save="{sample["id"]}"]'); await pg.wait_for_timeout(600)
        check(len(downloads) == n + 1, 'any other share failure falls back to the download')
        await pg.evaluate("() => { navigator.canShare = undefined; navigator.share = undefined; }")

        # ---- Load: storage that cannot save, and a file over 50 MB ----
        async def load(data, name='x.rally'):
            await pg.click('#tabs button[data-v=rallies]')
            if isinstance(data, bytes): data = {'name': name, 'mimeType': 'application/octet-stream', 'buffer': data}
            await pg.set_input_files('#fLoad', files=[data])
        async def dlg():
            await pg.wait_for_selector('#modal.on', timeout=10000)
            return await pg.inner_text('#mTitle'), await pg.inner_text('#mBody')
        n_r = await pg.evaluate("Object.keys(store.rallies).length")
        await pg.evaluate("lsOK = false")
        await load(f.read_bytes()); title, body = await dlg()
        check(title == 'Rally file not loaded' and body.startswith('This browser is not letting the page save on the device.'), f'Load is refused when the device cannot save ({body[:60]!r})')
        await pg.click('#mOk'); await pg.evaluate("lsOK = true")
        big = OUT_DIR / 'big.rally'
        with open(big, 'wb') as fh: fh.truncate(50 * 1024 * 1024 + 1)
        await load(str(big)); title, body = await dlg()
        big.unlink()
        check(title == 'Rally file not loaded' and 'over 50 MB' in body, 'a file over 50 MB is refused with a message')
        await pg.click('#mOk')
        check(await pg.evaluate("Object.keys(store.rallies).length") == n_r, 'neither changed the rallies')

        # ---- a file built by hand from docs/RALLY-FILE.md, deflated by a zip tool ----
        await load(str(FIXTURE))
        await pg.wait_for_function("(n) => Object.keys(store.rallies).length > n", arg=n_r)
        check(await pg.evaluate("document.getElementById('v-setup').classList.contains('on')") and not await pg.evaluate("document.getElementById('modal').classList.contains('on')"), 'a distributed file opens on Setup, with no notice when nothing is wrong')
        got = await pg.evaluate("({ name: R().name, date: R().date, cn: R().cn, cls: R().cls, ocf: R().ocf, crew: R().crew, n: R().rows.length, ta: R().taEvents.length })")
        check(got == {'name': 'Example Rally', 'date': '2026-05-02', 'cn': 7, 'cls': 'C', 'ocf': 1.01, 'crew': {'driver': 'Jane Driver', 'navigator': 'John Navigator', 'passengers': []}, 'n': 3, 'ta': 1}, f'the Setup fields and rows are as the spec says ({got})')
        done_at = datetime.datetime(2026, 5, 2, 16, 0, 5, tzinfo=datetime.timezone.utc).timestamp() * 1000
        rows = await pg.evaluate("R().rows.map(x => [x.done, x.doneAt, x.ttDone, x.signs.length, x.restart])")
        check(rows == [[True, done_at, 9 * 3600 + 7 * 60, 0, True], [False, None, None, 0, False], [False, None, None, 1, False]], f'run state and sign images are as the spec says ({rows})')
        tt = await pg.evaluate("Core.compute(R())[2].tt")
        check(tt == 9 * 3600 + 4 * 60 + 30 + 7 * 60 + 65, 'TT = CZT + car number minutes + the Time Allowance that applies from RI 2')
        await pg.click('#tabs button[data-v=route]')
        await pg.wait_for_function("document.querySelector('#rtEdit img.sgimg') && document.querySelector('#rtEdit img.sgimg').naturalWidth === 2")
        check(True, 'the sign image of RI 3 shows on Route, replacing its tag')
        check('sign image' not in await pg.inner_text('#routeBody') and 'page image' not in await pg.inner_text('#routeBody'), 'no flags: one tag, one image')
        await pg.click('#tabs button[data-v=run]')
        check(await pg.evaluate("document.querySelector('.active-card .ac-ri').textContent.trim()") == 'RI 2', 'Run is at the first RI not complete')
        await pg.click('#tabs button[data-v=data]')
        check((await pg.inner_text('#dataBody')).count('Page images: none; sign images 0.0 MB') == 1, 'the Data line for a rally with sign images only')

        # ---- kind decides where a loaded rally opens ----
        src = zipfile.ZipFile(FIXTURE)
        def with_doc(edit):
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, 'w', zipfile.ZIP_STORED) as zo:
                d = json.loads(src.read('rally.json')); edit(d); zo.writestr('rally.json', json.dumps(d))
                for nme in src.namelist():
                    if nme != 'rally.json': zo.writestr(nme, src.read(nme))
            return buf.getvalue()
        def set_kind(k):
            def edit(d):
                if k is None: d.pop('kind', None)
                else: d['kind'] = k
            return edit
        for k, view, notice in [('saved', 'run', False), ('distributed', 'setup', False), (None, 'setup', False), ('pocket', 'setup', True)]:
            await load(with_doc(set_kind(k)))
            if notice:
                title, body = await dlg()
                check(title == 'Rally file loaded' and 'kind “pocket” is not known' in body and 'opens on Setup' in body, f'an unknown kind opens Setup with a notice ({body!r})')
                await pg.click('#mOk')
            else:
                await pg.wait_for_timeout(300)
                check(not await pg.evaluate("document.getElementById('modal').classList.contains('on')"), f'kind {k}: no notice')
            check(await pg.evaluate(f"document.getElementById('v-{view}').classList.contains('on')"), f'kind {k!r} opens on {view}')

        # ---- Delete on the Rallies list ----
        await pg.click('#tabs button[data-v=rallies]')
        ids = await pg.evaluate("Object.keys(store.rallies)")
        cur = await pg.evaluate("store.cur"); other = next(i for i in ids if i != cur)
        name = await pg.evaluate("(i) => store.rallies[i].name || 'Untitled rally'", other)
        await pg.click(f'[data-rdel="{other}"]')
        check(await pg.inner_text('#mTitle') == 'Delete rally' and (await pg.inner_text('#mOk')).strip() == 'Delete' and
              await pg.inner_text('#mBody') == f'Delete “{name}” and all its data from this device? This cannot be undone. Save it to a file first if you want to keep it.', 'the Delete text names saving to a file')
        await pg.click('#mCancel')
        check(await pg.evaluate("Object.keys(store.rallies).length") == len(ids), 'Cancel keeps the rally')
        await pg.click(f'[data-rdel="{other}"]'); await pg.click('#mOk')
        check(await pg.evaluate("[Object.keys(store.rallies).length, store.cur]") == [len(ids) - 1, cur], 'deleting another rally leaves the open one open')
        await pg.click(f'[data-rdel="{cur}"]'); await pg.click('#mOk')
        check(await pg.evaluate("store.cur") is None and await pg.evaluate("document.getElementById('v-rallies').classList.contains('on')"), 'deleting the open rally closes it and stays on the list')
        await b.close()

run(main)
