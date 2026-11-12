import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('file:///home/claude/rt/dist/index.html'); await pg.evaluate('localStorage.clear()'); await pg.reload()
        await pg.click('#btnNewSample'); await pg.click('#tabs button[data-v=run]')
        for _ in range(3): await pg.click('#btnDone')                     # active RI 193
        order = await pg.eval_on_selector_all('.ctl .grp', 'e=>e.map(x=>x.className)'); print('order', order)
        await pg.click('#btnTA'); await pg.click('[data-st="60"]'); await pg.click('[data-st="15"]'); await pg.click('[data-st="-5"]')
        print('pending', await pg.input_value('#taIn'))
        await pg.screenshot(path='/tmp/rtt/17-tadlg.png')
        await pg.click('#mCancel'); print('after cancel', await pg.inner_text('#btnTA'))
        await pg.click('#btnTA'); await pg.click('[data-st="60"]'); await pg.mouse.click(10, 830)   # tap outside
        print('after outside tap', await pg.inner_text('#btnTA'), 'modal open', await pg.is_visible('#modal.on'))
        await pg.click('#btnTA'); await pg.click('[data-st="60"]'); await pg.click('[data-st="15"]'); await pg.click('#mOk')
        print('after Set', await pg.inner_text('#btnTA'), '| card TT', (await pg.inner_text('.ac-nums')).split('\n')[3])
        await pg.click('#btnTA'); await pg.fill('#taIn', '-95:00'); await pg.click('#mOk')
        print('invalid keeps dialog', await pg.is_visible('#modal.on')); await pg.click('#mCancel')
        await pg.click('#btnTA'); await pg.click('#taIn'); await pg.keyboard.type('-0:30'); await pg.keyboard.press('Enter')
        print('typed + Enter', await pg.inner_text('#btnTA'))
        for k in ['5','5','-1']: await pg.click(f'[data-sp="{k}"]')
        print('speedo', await pg.input_value('#fSpeedo'))
        await pg.screenshot(path='/tmp/rtt/18-run.png')
        await pg.click('#btnFS'); await pg.wait_for_timeout(200)
        print('focus mode', await pg.evaluate("document.body.classList.contains('focus')"), 'header visible', await pg.is_visible('header'))
        await pg.screenshot(path='/tmp/rtt/19-full.png')
        await pg.click('#btnFSx'); print('exit', await pg.is_visible('header'))
        await pg.set_viewport_size({'width':844,'height':390}); await pg.click('#btnFS'); await pg.wait_for_timeout(200)
        await pg.screenshot(path='/tmp/rtt/20-full-land.png')
        print('ERRORS', errs); await b.close()
asyncio.run(main())
