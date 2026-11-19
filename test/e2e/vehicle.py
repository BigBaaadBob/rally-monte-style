"""Vehicle on the set-up form (issue #23): placement, persistence, JSON round trip, old files, CSV.
Run from the repo root after a build:
  Windows:    .venv/Scripts/python build.py && .venv/Scripts/python test/e2e/vehicle.py
  Linux/WSL:  .venv/bin/python build.py && .venv/bin/python test/e2e/vehicle.py
Exits 1 if any check fails or an unexpected page error is captured."""
from _common import APP_URL, OUT_DIR, LAYOUTS, launch_browser, check, capture_errors, run
import json
from playwright.async_api import async_playwright

VEHICLE = 'Blue hatchback, "test"'
PROPS = "R().rows.map(r => { const n = Core.normRow(r); return [n.ri, n.om, n.restart, n.czt, n.cp, n.instr, n.info]; })"


async def main():
    async with async_playwright() as p:
        b = await launch_browser(p)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); capture_errors(pg, label='vehicle')
        await pg.goto(APP_URL); await pg.evaluate('localStorage.clear()'); await pg.reload()
        await pg.click('#btnNew')
        check(await pg.evaluate("R().vehicle") == '', 'a new rally has an empty Vehicle')
        await pg.click('#tabs button[data-v=rallies]'); await pg.click('#btnNewSample')
        check(await pg.evaluate("R().vehicle") == 'Rally Car', 'a rally from the sample has Vehicle "Rally Car" (DESIGN Scope)')

        # Placement: card heading, and a full-width Vehicle field below Passengers and Add passenger
        for w, h, _label in LAYOUTS:
            await pg.set_viewport_size({'width': w, 'height': h})
            card = await pg.evaluate("""() => { const f = document.getElementById('fVeh'), card = f.closest('.card'),
              add = document.getElementById('btnPax'), pax = document.getElementById('paxList');
              const fr = f.getBoundingClientRect(), cr = card.getBoundingClientRect(), ar = add.getBoundingClientRect();
              return { head: card.querySelector('h2').textContent, below: fr.top >= ar.bottom && fr.top >= pax.getBoundingClientRect().bottom,
                       full: fr.width >= (cr.width - 40) * 0.95, ph: f.placeholder }; }""")
            check(card['head'] == 'Crew and vehicle', f'{w}x{h}: card heading is "Crew and vehicle"')
            check(card['below'], f'{w}x{h}: Vehicle is below Passengers and Add passenger')
            check(card['full'], f'{w}x{h}: Vehicle is full width')
            check(card['ph'] == '', f'{w}x{h}: Vehicle has no placeholder')
        await pg.set_viewport_size({'width': 390, 'height': 844})
        await pg.screenshot(path=str(OUT_DIR / 'vehicle-setup.png'))

        # Persistence across a reload
        await pg.fill('#fVeh', VEHICLE)
        await pg.reload()
        check(await pg.input_value('#fVeh') == VEHICLE, 'Vehicle is still there after a reload')
        check(await pg.evaluate("R().vehicle") == VEHICLE, 'Vehicle is stored on the rally')

        # Vehicle appears only on the set-up form
        await pg.click('#tabs button[data-v=run]')
        check(VEHICLE not in await pg.inner_text('body'), 'Vehicle is not shown on the Run screen')

        # JSON export contains Vehicle; import restores it and the rest of the rally
        text = await pg.evaluate("JSON.stringify({ app: 'rally-monte-style', version: 1, rally: R() }, null, 1)")
        check(json.loads(text)['rally']['vehicle'] == VEHICLE, 'the JSON export contains Vehicle')
        orig_rows = await pg.evaluate(PROPS)
        orig = await pg.evaluate("({ name: R().name, cn: R().cn, ocf: R().ocf, crew: R().crew })")
        await pg.click('#tabs button[data-v=data]')
        n0 = await pg.evaluate("Object.keys(store.rallies).length")
        await pg.set_input_files('#fImport', files=[{'name': 'r.json', 'mimeType': 'application/json', 'buffer': text.encode()}])
        await pg.wait_for_function("n => Object.keys(store.rallies).length > n", arg=n0)
        check(await pg.evaluate("R().vehicle") == VEHICLE, 'JSON import restores Vehicle')
        check(await pg.evaluate(PROPS) == orig_rows, 'JSON import restores the Route Instructions')
        got = await pg.evaluate("({ cn: R().cn, ocf: R().ocf, crew: R().crew })")
        check(got == {k: orig[k] for k in ('cn', 'ocf', 'crew')}, 'JSON import restores the other set-up fields')

        # An older JSON file with no Vehicle imports with Vehicle empty and the rest unchanged
        old = json.loads(text); del old['rally']['vehicle']
        n1 = await pg.evaluate("Object.keys(store.rallies).length")
        await pg.set_input_files('#fImport', files=[{'name': 'old.json', 'mimeType': 'application/json', 'buffer': json.dumps(old).encode()}])
        await pg.wait_for_function("n => Object.keys(store.rallies).length > n", arg=n1)
        check(await pg.evaluate("R().vehicle") == '', 'import of a file without Vehicle leaves it empty')
        check(await pg.evaluate(PROPS) == orig_rows, 'import of a file without Vehicle keeps the Route Instructions')

        # A stored rally saved without Vehicle loads with it empty
        await pg.evaluate("() => { delete R().vehicle; save(R()); }")
        await pg.reload()
        check(await pg.evaluate("R().vehicle") == '', 'a stored rally without Vehicle loads with it empty')

        # CSV: Vehicle line after the crew lines, quoted; Paste rows gives the same Route Instructions with or without it
        await pg.evaluate("v => { R().vehicle = v; }", VEHICLE)
        csv_text = await pg.evaluate('Core.toCSV(R(), store.prefs.fmt)')
        lines = csv_text.split('\n')
        iv = next(i for i, l in enumerate(lines) if l.startswith('Vehicle,'))
        check(lines[iv] == 'Vehicle,"Blue hatchback, ""test"""', 'the CSV Vehicle line is quoted')
        check(lines[iv - 1].startswith('Passengers,') and iv < next(i for i, l in enumerate(lines) if l.startswith('RI,')),
              'the CSV Vehicle line follows the crew lines and precedes the RI header')
        without = '\n'.join(l for l in lines if not l.startswith('Vehicle,'))
        await pg.click('#tabs button[data-v=route]')
        results = []
        for t in (csv_text, without):
            await pg.click('#btnClearRI'); await pg.click('#mOk')
            await pg.click('#btnPaste'); await pg.fill('#pasteBox', t); await pg.click('#mOk')
            results.append(await pg.evaluate(PROPS))
        check(results[0] == results[1] and len(results[0]) > 0, f'Paste rows gives the same {len(results[0])} Route Instructions with or without the Vehicle line')
        await b.close()
run(main)
