"""Run screen: Time Allowance dialog and layouts.
Run from the repo root after a build:
  Windows:    .venv/Scripts/python build.py && .venv/Scripts/python test/e2e/e2e5.py
  Linux/WSL:  .venv/bin/python build.py && .venv/bin/python test/e2e/e2e5.py
Exits 1 if any check fails or an unexpected page error is captured."""
from _common import APP_URL, OUT_DIR, launch_browser, check, capture_errors, run
from playwright.async_api import async_playwright

# Values the checks compare against come from docs/DESIGN.md rules, or are computed in the page with Core.
START_SPEEDO = 35          # DESIGN "Run controls"/"Computation": a new rally starts at 35 mph

async def main():
    async with async_playwright() as p:
        b = await launch_browser(p)
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); capture_errors(pg)
        await pg.goto(APP_URL); await pg.evaluate('localStorage.clear()'); await pg.reload()
        await pg.click('#btnNewSample'); await pg.click('#tabs button[data-v=run]')
        for _ in range(3): await pg.click('#btnDone')
        # Completing in order leaves three rows done and the first uncompleted row active.
        st = await pg.evaluate("({done: R().rows.filter(r=>r.done).length, a: Core.activeIndex(R()), shown: +document.querySelector('#runTbl tr.active').dataset.i})")
        check(st['done'] == 3 and st['a'] == 3 and st['shown'] == st['a'], f'after 3 Complete taps the active row is the first uncompleted ({st})')
        # DESIGN "Run controls": one strip, TA button on the left, speedometer on the right.
        order = await pg.eval_on_selector_all('.ctl .grp', 'e=>e.map(x=>x.className.split(/\\s+/))')
        check(len(order) == 2 and 'ta' in order[0] and 'sp' in order[1], f'control strip order is TA then speedometer ({order})')

        zero = await pg.evaluate('fmtTA(0)')
        check(await pg.inner_text('#btnTA') == zero, f'TA button starts at {zero}')
        # TA dialog (DESIGN l.25): +60, +15, -5 are pending: 70 s until Set.
        await pg.click('#btnTA'); await pg.click('[data-st="60"]'); await pg.click('[data-st="15"]'); await pg.click('[data-st="-5"]')
        want = await pg.evaluate('fmtTA(70)')
        check(await pg.input_value('#taIn') == want, f'pending TA is +60 +15 -5 = 70 s, shown as {want}')
        await pg.screenshot(path=str(OUT_DIR / '17-tadlg.png'))
        await pg.click('#mCancel')
        check(await pg.inner_text('#btnTA') == zero, 'Cancel leaves TA unchanged')
        await pg.click('#btnTA'); await pg.click('[data-st="60"]'); await pg.mouse.click(10, 830)   # tap outside
        check(await pg.inner_text('#btnTA') == zero and not await pg.is_visible('#modal.on'), 'tapping outside closes the dialog and leaves TA unchanged')

        # Set applies the TA: the button and the active card's TT follow Core (TT = CZT + CN + TA, DESIGN l.14).
        await pg.click('#btnTA'); await pg.click('[data-st="60"]'); await pg.click('[data-st="15"]'); await pg.click('#mOk')
        want = await pg.evaluate('fmtTA(75)')
        check(await pg.inner_text('#btnTA') == want, f'Set applies +60 +15 = 75 s, shown as {want}')
        tt = await pg.evaluate("""(() => { const c = Core.compute(R())[Core.activeIndex(R())];
            return {want: c.tt != null ? fmtT(c.tt) : '≈' + fmtT(c.est), got: document.querySelectorAll('.ac-nums .big')[1].textContent.trim()}; })()""")
        check(tt['got'] == tt['want'], f"active card TT follows the TA (page {tt['got']!r}, Core {tt['want']!r})")

        await pg.click('#btnTA'); await pg.fill('#taIn', '-95:00'); await pg.click('#mOk')
        check(await pg.is_visible('#modal.on'), 'an entry beyond +/-90:00 keeps the dialog open')
        await pg.click('#mCancel')
        await pg.click('#btnTA'); await pg.click('#taIn'); await pg.keyboard.type('-0:30'); await pg.keyboard.press('Enter')
        want = await pg.evaluate('fmtTA(-30)')
        check(await pg.inner_text('#btnTA') == want, f'typed -0:30 plus Enter commits ({want})')

        for k in ['5','5','-1']: await pg.click(f'[data-sp="{k}"]')
        check(await pg.input_value('#fSpeedo') == str(START_SPEEDO + 5 + 5 - 1), f'speedometer is {START_SPEEDO} +5 +5 -1')
        await pg.screenshot(path=str(OUT_DIR / '18-run.png'))

        # Full screen (DESIGN l.27): always hides the header; the small x exits.
        await pg.click('#btnFS'); await pg.wait_for_timeout(200)
        check(await pg.evaluate("document.body.classList.contains('focus')") and not await pg.is_visible('header'), 'full screen hides the header')
        await pg.screenshot(path=str(OUT_DIR / '19-full.png'))
        await pg.click('#btnFSx')
        check(await pg.is_visible('header'), 'the exit button brings the header back')
        await pg.set_viewport_size({'width':844,'height':390}); await pg.click('#btnFS'); await pg.wait_for_timeout(200)
        check(not await pg.is_visible('header'), 'full screen hides the header in landscape')
        await pg.screenshot(path=str(OUT_DIR / '20-full-land.png'))
        await b.close()
run(main)
