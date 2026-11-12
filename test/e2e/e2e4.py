import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        for w,h,name in [(390,844,'p390'),(360,780,'p360'),(844,390,'land')]:
            ctx = await b.new_context(viewport={'width':w,'height':h}, device_scale_factor=2, has_touch=True, is_mobile=True)
            pg = await ctx.new_page(); errs=[]
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto('file:///home/claude/rt/dist/index.html'); await pg.evaluate('localStorage.clear()'); await pg.reload()
            await pg.click('#btnNewSample'); await pg.click('#tabs button[data-v=run]')
            m = await pg.evaluate("""(()=>{const c=document.querySelector('.ctl').getBoundingClientRect();
              const bs=[...document.querySelectorAll('.ctl button:not(.set), .ctl input')].map(e=>e.getBoundingClientRect());
              return {ctlW:c.width, right:c.right, vw:innerWidth, rows:new Set(bs.map(r=>Math.round(r.top))).size, minBtnW:Math.min(...bs.map(r=>r.width)).toFixed(1),
                      over:[...document.querySelectorAll('.ctl button,.ctl input')].some(e=>e.scrollWidth>e.clientWidth+1)}})()""")
            print(name, m)
            if name=='p390':
                for _ in range(16): await pg.click('[data-sp="5"]')
                print(' speedo max', await pg.input_value('#fSpeedo'))
                for _ in range(95): await pg.click('[data-ta="60"]')
                print(' TA max', await pg.input_value('#fTA'))
                await pg.click('#fTA'); await pg.keyboard.type('-91:00'); await pg.keyboard.press('Enter')
                print(' TA typed -91:00 ->', await pg.input_value('#fTA'))
                await pg.click('#fSpeedo'); await pg.keyboard.type('120'); await pg.keyboard.press('Enter')
                print(' speedo typed 120 ->', await pg.input_value('#fSpeedo'))
                await pg.click('#fSpeedo'); await pg.screenshot(path=f'/tmp/rtt/16-edit.png'); await pg.click('.ac-instr')
                await pg.fill('#fTA','') if False else None
            await pg.screenshot(path=f'/tmp/rtt/15-{name}.png')
            print(' errors', errs); await ctx.close()
        await b.close()
asyncio.run(main())
