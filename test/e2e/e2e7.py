import asyncio, json
from playwright.async_api import async_playwright
import pathlib
HERE = pathlib.Path(__file__).resolve().parent
APP = 'file://' + str(HERE.parents[1] / 'dist/index.html')   # run python3 build.py first
PAGE = str(HERE / 'page.png')
OUT = pathlib.Path('/tmp/rally-e2e'); OUT.mkdir(exist_ok=True)   # screenshots

REPLY = '''Here are the rows. RI 193 is at the [curve-left sign].
```json
[{"ri":193,"om":"2.29","czt":"15:42:00","cp":65,"instr":"CHECKPOINT at [curve-left sign, 30 MPH].","info":"(CP 65.)"},
 {"ri":"193A","om":"2.40","czt":null,"cp":null,"instr":"new row","info":""}]
```'''
INJECT = """new MutationObserver((m, o) => { if (document.head && !document.getElementById('fakecsp')) {
  const meta = document.createElement('meta'); meta.httpEquiv = 'Content-Security-Policy'; meta.content = "connect-src 'self'"; meta.id = 'fakecsp';
  document.head.prepend(meta); const sc = document.createElement('script'); sc.textContent = 'window.__injected=1'; document.head.appendChild(sc); o.disconnect(); } })
  .observe(document, { childList: true, subtree: true });"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':390,'height':844}, has_touch=True, is_mobile=True)
        await ctx.add_init_script(INJECT)
        await ctx.grant_permissions(['clipboard-read','clipboard-write'])
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(APP); await pg.evaluate('localStorage.clear()'); await pg.reload()
        print('injected present in live page:', await pg.evaluate("!!document.getElementById('fakecsp')"))
        selfhtml = await pg.evaluate('SELF_HTML')
        print('offline copy has CSP meta:', 'fakecsp' in selfhtml, '| injected script:', '__injected' in selfhtml, '| our scripts:', selfhtml.count('<script data-rt'))
        open(str(OUT / 'offline.html'),'w').write(selfhtml)
        await pg.click('#btnNewSample')
        # speedo persists across reload
        await pg.click('#tabs button[data-v=run]'); await pg.click('[data-sp="5"]'); await pg.click('[data-sp="1"]')
        await pg.reload(); await pg.click('#tabs button[data-v=run]'); print('speedo after reload (want 41):', await pg.input_value('#fSpeedo'))
        # chat route
        await pg.click('#tabs button[data-v=route]')
        await pg.click('#btnChat'); await pg.click('#mBody button.primary')
        clip = await pg.evaluate('navigator.clipboard.readText()'); print('copied prompt starts:', clip[:60])
        await pg.click('#mOk'); await pg.fill('#pasteBox', REPLY); await pg.click('#mOk')
        print('rows:', await pg.evaluate("R().rows.map(r=>r.ri).join(',')"))
        print('193 instr:', await pg.evaluate("R().rows.find(r=>r.ri==193).instr"))
        await pg.click('#btnPaste'); await pg.fill('#pasteBox', 'nothing useful'); await pg.click('#mOk')
        print('bad paste keeps dialog:', await pg.is_visible('#modal.on')); await pg.click('#mCancel')
        await pg.click('#btnPaste'); await pg.fill('#pasteBox', '210,1.50,,,"R at [sign]",note\n211,1.70,16:20:00,90,CHECKPOINT,'); await pg.click('#mOk')
        print('csv rows added:', await pg.evaluate("R().rows.filter(r=>r.ri>=210).map(r=>r.ri+':'+r.instr).join(' | ')"))
        print('ERRORS', errs)
        # offline copy runs standalone; Read explains the API key
        pg2 = await (await b.new_context(viewport={'width':390,'height':844})).new_page(); e2=[]
        pg2.on('pageerror', lambda e: e2.append(str(e)))
        await pg2.goto('file://' + str(OUT / 'offline.html')); await pg2.click('#btnNewSample'); await pg2.click('#tabs button[data-v=route]')
        await pg2.set_input_files('#fPages', PAGE); await pg2.click('#btnRead')
        print('offline Read ->', await pg2.inner_text('#mTitle'))
        await pg2.screenshot(path=str(OUT / '22-offline-read.png'))
        await pg2.click('#mOk'); await pg2.screenshot(path=str(OUT / '23-chat.png'))
        print('offline ERRORS', e2)
        await b.close()
asyncio.run(main())
