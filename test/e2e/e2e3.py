import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('console', lambda m: m.type=='error' and errs.append(m.text))
        await pg.goto('file:///home/claude/rt/dist/index.html'); await pg.evaluate('localStorage.clear()'); await pg.reload()
        await pg.click('#btnNewSample')
        await pg.select_option('#fCls', 'C'); await pg.fill('#fClose', '0.3')
        await pg.screenshot(path='/tmp/rtt/11-setup.png')
        print('header', await pg.inner_text('#hdrTitle'))
        await pg.click('#tabs button[data-v=run]')
        print('close rows', await pg.eval_on_selector_all('#runTbl tr.close', 'els=>els.map(e=>e.dataset.i).join(",")'))
        for k in ['-1','-1','5']: await pg.click(f'[data-sp="{k}"]')
        print('speedo', await pg.input_value('#fSpeedo'))
        for k in ['60','15','-5']: await pg.click(f'[data-ta="{k}"]')
        print('TA', await pg.input_value('#fTA'))
        await pg.screenshot(path='/tmp/rtt/12-run.png')
        await pg.click('#fTA'); await pg.screenshot(path='/tmp/rtt/13-edit.png'); await pg.click('.ac-instr')
        await pg.set_viewport_size({'width':844,'height':390}); await pg.wait_for_timeout(200)
        await pg.screenshot(path='/tmp/rtt/14-land.png')
        print('ERRORS', errs); await b.close()
asyncio.run(main())
