"""Route screen: paste/CSV import and Read without an API key.
Run from the repo root after a build:
  Windows:    .venv/Scripts/python build.py && .venv/Scripts/python test/e2e/e2e7.py
  Linux/WSL:  .venv/bin/python build.py && .venv/bin/python test/e2e/e2e7.py
Exits 1 if any check fails or an unexpected page error is captured."""
from _common import APP_URL, OUT_DIR, launch_browser, check, capture_errors, run
import json, pathlib
from playwright.async_api import async_playwright
PAGE = str(pathlib.Path(__file__).resolve().parent / 'page.png')   # committed fixture image

START_SPEEDO = 35          # DESIGN "Computation": a new rally starts at 35 mph

# A JSON reply in the old chat-read format; Paste rows no longer reads it (RI filled in from a row of the loaded sample).
REPLY = '''Here are the rows. RI {ri} is at the [curve-left sign].
```json
[{{"ri":{ri},"om":"2.29","czt":"15:42:00","cp":65,"instr":"CHECKPOINT at [curve-left sign, 30 MPH].","info":"(CP 65.)"}},
 {{"ri":"{ri}A","om":"2.40","czt":null,"cp":null,"instr":"new row","info":""}}]
```'''
CSV = 'RI,OM,CZT,CP,Instruction,Info\n210,1.50,,,"R at [sign]",note\n211,1.70,16:20:00,90,CHECKPOINT,'
ROWS = "R().rows.map(r => r.ri + ':' + r.instr).join('|')"

async def main():
    async with async_playwright() as p:
        b = await launch_browser(p)
        ctx = await b.new_context(viewport={'width':390,'height':844}, has_touch=True, is_mobile=True)
        await ctx.grant_permissions(['clipboard-read','clipboard-write'])
        pg = await ctx.new_page(); capture_errors(pg, label='live page')
        await pg.goto(APP_URL); await pg.evaluate('localStorage.clear()'); await pg.reload()
        await pg.click('#btnNewSample')
        # DESIGN Scope, New from sample: each tap makes a separate rally with the sample's details; set-up opens.
        d = await pg.evaluate("(() => { const r = R(); return {name: r.name, cn: r.cn, cls: r.cls, ocf: r.ocf, veh: r.vehicle, crew: r.crew, ta: r.taEvents.length, done: r.rows.filter(x => x.done).length, n: r.rows.length, id: r.id}; })()")
        sdet = await pg.evaluate("[SAMPLE.rally.name, SAMPLE.rally.cn, SAMPLE.rally.cls, SAMPLE.rally.ocf, SAMPLE.rally.vehicle, SAMPLE.rows.length]")
        check([d['name'], d['cn'], d['cls'], d['ocf'], d['veh'], d['n']] == sdet and d['ta'] == 0 and d['done'] == 0, f'New from sample copies the sample details ({d})')
        check(await pg.input_value('#fCls') == d['cls'] and await pg.input_value('#fOCF') == f"{d['ocf']:.4f}", 'set-up opens showing the sample Class and OCF with four decimals')
        await pg.click('#tabs button[data-v=rallies]'); await pg.click('#btnNewSample')
        ids = await pg.evaluate("Object.keys(store.rallies).filter(k => store.rallies[k].name === SAMPLE.rally.name).length")
        check(ids == 2 and await pg.evaluate("R().id") != d['id'], 'a second tap makes a second, separate rally')
        await pg.evaluate("R().crew.passengers.push('x')")
        check(await pg.evaluate("store.rallies['%s'].crew.passengers.length" % d['id']) == 0, 'the two rallies do not share crew data')
        # DESIGN Computation: a row with no OM (the finish RI) can be completed like any other.
        done_last = await pg.evaluate("(() => { const r = R(); r.rows.forEach(x => x.done = true); const i = r.rows.findIndex(x => x.om == null); r.rows[i].done = false; r.rows.forEach((x, k) => { if (k > i) x.done = true; }); return Core.activeIndex(r) === i; })()")
        check(done_last, 'the no-OM row can be the active row')
        await pg.click('#tabs button[data-v=run]'); await pg.click('#btnDone')
        check(await pg.evaluate("R().rows.every(x => x.done)"), 'completing the no-OM row completes the rally')
        await pg.evaluate("R().rows.forEach(x => { x.done = false; x.ttDone = null; x.estLock = null; })")
        # DESIGN § Storage: the speedometer is saved with the rally (reloading keeps it).
        await pg.click('#tabs button[data-v=run]'); await pg.click('[data-sp="5"]'); await pg.click('[data-sp="1"]')
        await pg.reload(); await pg.click('#tabs button[data-v=run]')
        check(await pg.input_value('#fSpeedo') == str(START_SPEEDO + 6), f'speedometer after reload is {START_SPEEDO} +5 +1')
        # DESIGN Computation: renaming an RI moves its TA events to the new RI.
        await pg.click('#tabs button[data-v=route]')
        k = await pg.evaluate("(() => { const r = R(), C = Core.compute(r); return r.rows.findIndex((x, i) => !C[i].restart && i + 1 < r.rows.length && r.rows.slice(i + 1).some((y, j) => y.czt != null && !C[i + 1 + j].restart)); })()")
        check(k >= 0, 'sample has a non-restart row with a later CZT row in its leg')
        old = await pg.evaluate("k => R().rows[k].ri", k)
        new = f'{old}z'
        exp = await pg.evaluate("""([k, nri]) => { const r = JSON.parse(JSON.stringify(R())); r.taEvents = Core.setTA(r, k, 45, 1);
          r.rows[k].ri = nri; r.taEvents[0].ri = nri; return Core.compute(r).map(c => c.tt); }""", [k, new])
        await pg.evaluate("k => { const r = R(); r.taEvents = Core.setTA(r, k, 45, 1); save(r); renderRoute(); }", k)
        await pg.fill(f'#rtEdit [data-i="{k}"][data-k="ri"]', new); await pg.dispatch_event(f'#rtEdit [data-i="{k}"][data-k="ri"]', 'change')
        check(await pg.evaluate("k => R().rows[k].ri", k) == new, 'the row was renamed')
        check(await pg.evaluate("R().taEvents.map(e => e.ri)") == [new], 'the TA event moved to the new RI')
        check(await pg.evaluate("Core.compute(R()).map(c => c.tt)") == exp, 'TTs from the renamed row on equal Core with the TA on that row')
        await pg.click('#tabs button[data-v=data]')
        dt = await pg.inner_text('#v-data')
        check(f'RI {new} ' in dt and f'RI {old} ' not in dt, 'Data tab "TAs entered" lists the new RI, not the old')
        await pg.click('#tabs button[data-v=route]')
        dup = await pg.evaluate("k => R().rows[(k + 1) % R().rows.length].ri", k)
        await pg.fill(f'#rtEdit [data-i="{k}"][data-k="ri"]', str(dup)); await pg.dispatch_event(f'#rtEdit [data-i="{k}"][data-k="ri"]', 'change')
        check(await pg.evaluate("R().taEvents.map(e => e.ri)") == [new], 'a rejected rename leaves the TA on its RI')
        await pg.evaluate("([k, old]) => { const r = R(); r.rows[k].ri = old; r.taEvents = []; save(r); renderRoute(); }", [k, old])
        # DESIGN Getting the Route Instructions in: Paste rows accepts CSV only; a pasted JSON reply finds no rows.
        await pg.click('#tabs button[data-v=route]')
        ri0 = await pg.evaluate("R().rows.find(r => !r.restart).ri")
        rows_before = await pg.evaluate(ROWS)
        await pg.click('#btnPaste'); await pg.fill('#pasteBox', REPLY.format(ri=ri0)); await pg.click('#mOk')
        check(await pg.is_visible('#modal.on'), 'a pasted JSON reply keeps the Paste rows dialog open')
        check(await pg.evaluate(ROWS) == rows_before, 'a pasted JSON reply leaves the table unchanged')
        check('csv' in (await pg.inner_text('#mBody')).lower(), 'the Paste rows dialog says it takes CSV')
        await pg.click('#mCancel')
        check('claude chat' not in (await pg.inner_text('#routeBody')).lower(), 'the Route tab has no "Read in a Claude chat" text')
        # DESIGN § Getting the Route Instructions in (Paste rows): no rows found keeps the dialog open and leaves the table unchanged.
        rows_before = await pg.evaluate(ROWS)
        await pg.click('#btnPaste'); await pg.fill('#pasteBox', 'nothing useful'); await pg.click('#mOk')
        check(await pg.is_visible('#modal.on'), 'a paste with no rows keeps the dialog open')
        check(await pg.evaluate(ROWS) == rows_before, 'a paste with no rows leaves the table unchanged')
        await pg.click('#mCancel')
        # DESIGN § Getting the Route Instructions in (Paste rows): Paste rows also accepts CSV lines (RI,OM,CZT,CP,Instruction,Info).
        await pg.click('#btnPaste'); await pg.fill('#pasteBox', CSV); await pg.click('#mOk')
        added = await pg.evaluate("R().rows.filter(r => r.ri >= 210).map(r => r.ri + ':' + r.instr).join(' | ')")
        check(added == '210:R at [sign] | 211:CHECKPOINT', f'CSV lines are added with their instruction text ({added})')
        # DESIGN Scope: the app's table is called Route Instructions in the UI (never Route Table, RT, or RIs).
        check(await pg.inner_text('#btnClearRI') == 'Clear Route Instructions', 'the Route tab clear button says "Clear Route Instructions"')
        check('Route Instructions' in await pg.inner_text('#routeBody strong'), 'the Route tab count says Route Instructions')
        # DESIGN Getting the Route Instructions in: Paste rows accepts a CSV exported by the app and restores the same rows.
        PROPS = "R().rows.map(r => { const n = Core.normRow(r); return [n.ri, n.om, n.restart, n.czt, n.cp, n.instr, n.info]; })"
        rows_exported = await pg.evaluate(PROPS)
        csv_text = await pg.evaluate('Core.toCSV(R(), store.prefs.fmt)')
        # DESIGN § Tabs and settings (Route editor): Clear Route Instructions text, disabled state, and photos left in place.
        await pg.set_input_files('#fPages', PAGE)
        n_thumbs = await pg.evaluate("document.querySelectorAll('.thumbs figure').length")
        check(n_thumbs == 1, 'one page photo was added before Clear')
        n, name = await pg.evaluate("[R().rows.length, R().name || 'this rally']")
        await pg.click('#btnClearRI')
        check(await pg.inner_text('#mTitle') == 'Clear Route Instructions', 'the clear dialog is titled "Clear Route Instructions"')
        check((await pg.inner_text('#mOk')).strip() == 'Clear', 'the clear dialog OK button says Clear')
        body = await pg.inner_text('#mBody')
        check(n > 1 and body == f'Clear all {n} Route Instructions and their run data from “{name}”? This cannot be undone.', f'Clear Route Instructions text ({body})')
        await pg.click('#mOk')
        check(await pg.evaluate('R().rows.length') == 0, 'Clear Route Instructions empties the table')
        check(await pg.is_disabled('#btnClearRI'), 'Clear Route Instructions is disabled when there are no Route Instructions')
        check(await pg.evaluate("document.querySelectorAll('.thumbs figure').length") == n_thumbs, 'Clear Route Instructions leaves page photos in place')
        await pg.click('#btnAdd')
        check(not await pg.is_disabled('#btnClearRI'), 'Clear Route Instructions is enabled after Add row')
        await pg.click('#btnClearRI')
        body = await pg.inner_text('#mBody')
        check(body == f'Clear the 1 Route Instruction and its run data from “{name}”? This cannot be undone.', f'Clear Route Instructions text for one row ({body})')
        await pg.click('#mOk')
        check(await pg.evaluate('R().rows.length') == 0, 'the table is empty again')
        await pg.click('#tabs button[data-v=run]')
        check('No Route Instructions yet' in await pg.inner_text('#v-run'), 'the Run empty state says "No Route Instructions yet"')
        await pg.click('#tabs button[data-v=route]')
        await pg.click('#btnPaste'); await pg.fill('#pasteBox', csv_text); await pg.click('#mOk')
        check(await pg.evaluate(PROPS) == rows_exported and len(rows_exported) > 0, f'an exported CSV re-imports the same {len(rows_exported)} rows through Paste rows')
        # DESIGN § Getting the Route Instructions in: with no API key, Read explains that a key is needed.
        check(await pg.evaluate("localStorage.getItem('rallyMonteStyle.apikey')") is None, 'test setup: no API key is saved')
        await pg.click('#tabs button[data-v=route]')
        await pg.set_input_files('#fPages', PAGE); await pg.click('#btnRead')
        body = await pg.inner_text('#mBody')
        check(await pg.is_visible('#modal.on') and 'api key' in body.lower(), f"Read without a key explains the API key ({await pg.inner_text('#mTitle')!r})")
        await pg.screenshot(path=str(OUT_DIR / '22-read-no-key.png'))
        await pg.click('#mOk')
        # DESIGN § Storage / Data: no offline-copy button; the header shows the storage status.
        await pg.click('#tabs button[data-v=data]')
        check(await pg.query_selector('#xApp') is None and 'offline copy' not in (await pg.inner_text('#v-data')).lower(), 'the Data tab has no offline-copy button')
        check(await pg.inner_text('#storage') == 'Saved on device', 'the header says Saved on device')
        await b.close()
run(main)
