import asyncio
from playwright.async_api import async_playwright
import pathlib
HERE = pathlib.Path(__file__).resolve().parent
APP = 'file://' + str(HERE.parents[1] / 'dist/index.html')   # run python3 build.py first
PAGE = str(HERE / 'page.png')
OUT = pathlib.Path('/tmp/rally-e2e'); OUT.mkdir(exist_ok=True)   # screenshots

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(APP); await pg.evaluate('localStorage.clear()'); await pg.reload()
        await pg.click('#btnNewSample')
        await pg.click('#tabs button[data-v=route]')
        async with pg.expect_file_chooser(timeout=3000) as fc:
            await pg.tap('.filebtn.primary')
        print('photo button opens chooser:', (await fc.value).is_multiple())
        await pg.click('#tabs button[data-v=run]')
        print('speedo at start', await pg.input_value('#fSpeedo'))
        tts = await pg.eval_on_selector_all('#runTbl td.tt', 'e=>e.map(x=>x.textContent.trim())')
        print('TT column', tts)
        print('card', (await pg.inner_text('.ac-nums')).replace('\n',' | '))
        sc = lambda: pg.evaluate("document.getElementById('runWrap').scrollTop")
        await pg.evaluate("document.getElementById('runWrap').scrollTop = 400"); await pg.wait_for_timeout(100)
        await pg.click('#btnTA'); await pg.click('[data-st="15"]'); await pg.click('#mOk'); await pg.wait_for_timeout(100)
        print('scroll after TA (want 400):', await sc())
        await pg.click('[data-sp="5"]'); await pg.wait_for_timeout(100); print('scroll after speedo (want 400):', await sc())
        await pg.click('#btnDone'); await pg.wait_for_timeout(600)
        pos = await pg.evaluate("""(()=>{const w=document.getElementById('runWrap'),tr=w.querySelector('tr.active');
            return {scroll:w.scrollTop, activeTopInView: tr.getBoundingClientRect().top - w.getBoundingClientRect().top}})()""")
        print('after Complete', pos)
        for _ in range(5): await pg.click('#btnDone')
        await pg.wait_for_timeout(600)
        pos = await pg.evaluate("""(()=>{const w=document.getElementById('runWrap'),tr=w.querySelector('tr.active');
            return {ri:tr.children[1].textContent, scroll:w.scrollTop, activeTopInView: Math.round(tr.getBoundingClientRect().top - w.getBoundingClientRect().top)}})()""")
        print('after 6 completes', pos)
        before = await sc(); await pg.click('#btnUndo'); await pg.wait_for_timeout(300); print('undo keeps scroll', before, await sc())
        # completed no-TT rows keep estimate when speedo changes; others follow
        await pg.click('#btnDone')
        r192, r197 = await pg.inner_text('#runTbl tr[data-i="2"] td.tt'), await pg.inner_text('#runTbl tr[data-i="7"] td.tt')
        r198 = await pg.inner_text('#runTbl tr[data-i="8"] td.tt')
        for _ in range(3): await pg.click('[data-sp="5"]')
        print('192', r192, '->', await pg.inner_text('#runTbl tr[data-i="2"] td.tt'), '| 197', r197, '->', await pg.inner_text('#runTbl tr[data-i="7"] td.tt'),
              '| 198 (open)', r198, '->', await pg.inner_text('#runTbl tr[data-i="8"] td.tt'))
        await pg.screenshot(path=str(OUT / '21-run.png'))
        await pg.reload(); await pg.click('#tabs button[data-v=run]')
        print('speedo after restart', await pg.input_value('#fSpeedo'), '| 197 still', await pg.inner_text('#runTbl tr[data-i="7"] td.tt'))
        print('ERRORS', errs); await b.close()
asyncio.run(main())
