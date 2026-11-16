"""Route screen: paste/CSV import, offline copy, and Read without an API key.
Run from the repo root after a build:
  Windows:    .venv/Scripts/python build.py && .venv/Scripts/python test/e2e/e2e7.py
  Linux/WSL:  .venv/bin/python build.py && .venv/bin/python test/e2e/e2e7.py
Exits 1 if any check fails or an unexpected page error is captured."""
from _common import APP_URL, OUT_DIR, launch_browser, check, capture_errors, run
import json, pathlib
from playwright.async_api import async_playwright
PAGE = str(pathlib.Path(__file__).resolve().parent / 'page.png')   # committed fixture image

START_SPEEDO = 35          # DESIGN "Computation": a new rally starts at 35 mph

# The reply replaces a row that already exists in the loaded sample (RI filled in from the page) and adds a new "<RI>A" row.
REPLY = '''Here are the rows. RI {ri} is at the [curve-left sign].
```json
[{{"ri":{ri},"om":"2.29","czt":"15:42:00","cp":65,"instr":"CHECKPOINT at [curve-left sign, 30 MPH].","info":"(CP 65.)"}},
 {{"ri":"{ri}A","om":"2.40","czt":null,"cp":null,"instr":"new row","info":""}}]
```'''
CSV = '210,1.50,,,"R at [sign]",note\n211,1.70,16:20:00,90,CHECKPOINT,'
INJECT = """new MutationObserver((m, o) => { if (document.head && !document.getElementById('fakecsp')) {
  const meta = document.createElement('meta'); meta.httpEquiv = 'Content-Security-Policy'; meta.content = "connect-src 'self'"; meta.id = 'fakecsp';
  document.head.prepend(meta); const sc = document.createElement('script'); sc.textContent = 'window.__injected=1'; document.head.appendChild(sc); o.disconnect(); } })
  .observe(document, { childList: true, subtree: true });"""
ROWS = "R().rows.map(r => r.ri + ':' + r.instr).join('|')"

async def main():
    async with async_playwright() as p:
        b = await launch_browser(p)
        ctx = await b.new_context(viewport={'width':390,'height':844}, has_touch=True, is_mobile=True)
        await ctx.add_init_script(INJECT)
        await ctx.grant_permissions(['clipboard-read','clipboard-write'])
        pg = await ctx.new_page(); capture_errors(pg, label='live page')
        await pg.goto(APP_URL); await pg.evaluate('localStorage.clear()'); await pg.reload()
        # DESIGN l.39: the offline copy strips security-policy meta tags and scripts injected by the host.
        check(await pg.evaluate("!!document.getElementById('fakecsp') && window.__injected === 1"), 'test setup: the injected CSP meta and script are in the live page')
        selfhtml = await pg.evaluate('SELF_HTML')
        check('fakecsp' not in selfhtml, 'offline copy has no injected CSP meta')
        check('__injected' not in selfhtml, 'offline copy has no injected script')
        ours = await pg.evaluate("document.querySelectorAll('script[data-rt]').length")
        check(ours > 0 and selfhtml.count('<script data-rt') == ours, f"offline copy keeps the app's own scripts ({selfhtml.count('<script data-rt')} of {ours})")
        (OUT_DIR / 'offline.html').write_text(selfhtml, encoding='utf-8')
        await pg.click('#btnNewSample')
        # DESIGN l.19: the speedometer is saved with the rally (reloading keeps it).
        await pg.click('#tabs button[data-v=run]'); await pg.click('[data-sp="5"]'); await pg.click('[data-sp="1"]')
        await pg.reload(); await pg.click('#tabs button[data-v=run]')
        check(await pg.input_value('#fSpeedo') == str(START_SPEEDO + 6), f'speedometer after reload is {START_SPEEDO} +5 +1')
        # chat route: Copy instructions puts text on the clipboard (DESIGN l.40)
        await pg.click('#tabs button[data-v=route]')
        await pg.click('#btnChat'); await pg.click('#mBody button.primary')
        clip = await pg.evaluate('navigator.clipboard.readText()')
        check(len(clip.strip()) > 0, 'Copy instructions puts text on the clipboard')
        print('copied prompt starts:', clip[:60])
        ri0 = await pg.evaluate("R().rows.find(r => !r.restart).ri")
        before = await pg.evaluate("R().rows")
        reply = REPLY.format(ri=ri0)
        await pg.click('#mOk'); await pg.fill('#pasteBox', reply); await pg.click('#mOk')
        # DESIGN l.59 and Core.mergeRows: merge by RI, new text replaces old, then sort.
        merged = await pg.evaluate("([before, text]) => Core.mergeRows(before, Core.parseOCR(text)).rows.map(r => r.ri).join(',')", [before, reply])
        check(await pg.evaluate("R().rows.map(r => r.ri).join(',')") == merged, f'pasted reply merges by RI and sorts ({merged})')
        check(await pg.evaluate("ri => R().rows.find(r => String(r.ri) === String(ri)).instr", ri0) == 'CHECKPOINT at [curve-left sign, 30 MPH].', f'RI {ri0} text is replaced by the reply')
        check(await pg.evaluate("ri => R().rows.some(r => r.ri === ri + 'A' && r.instr === 'new row')", ri0), f'RI {ri0}A is added')
        # DESIGN l.40 (Paste rows): no rows found keeps the dialog open and leaves the table unchanged.
        rows_before = await pg.evaluate(ROWS)
        await pg.click('#btnPaste'); await pg.fill('#pasteBox', 'nothing useful'); await pg.click('#mOk')
        check(await pg.is_visible('#modal.on'), 'a paste with no rows keeps the dialog open')
        check(await pg.evaluate(ROWS) == rows_before, 'a paste with no rows leaves the table unchanged')
        await pg.click('#mCancel')
        # DESIGN l.40: Paste rows also accepts CSV lines (RI,OM,CZT,CP,Instruction,Info).
        await pg.click('#btnPaste'); await pg.fill('#pasteBox', CSV); await pg.click('#mOk')
        added = await pg.evaluate("R().rows.filter(r => r.ri >= 210).map(r => r.ri + ':' + r.instr).join(' | ')")
        check(added == '210:R at [sign] | 211:CHECKPOINT', f'CSV lines are added with their instruction text ({added})')
        # DESIGN Scope: the app's table is called Route Instructions in the UI (never Route Table, RT, or RIs).
        check(await pg.inner_text('#btnClearRT') == 'Clear Route Instructions', 'the Route tab clear button says "Clear Route Instructions"')
        check('Route Instructions' in await pg.inner_text('#routeBody strong'), 'the Route tab count says Route Instructions')
        # DESIGN Getting the Route Instructions in: Paste rows accepts a CSV exported by the app and restores the same rows.
        PROPS = "R().rows.map(r => { const n = Core.normRow(r); return [n.ri, n.om, n.restart, n.czt, n.cp, n.instr, n.info]; })"
        rows_exported = await pg.evaluate(PROPS)
        csv_text = await pg.evaluate('Core.toCSV(R(), store.prefs.fmt)')
        await pg.click('#btnClearRT')
        check(await pg.inner_text('#mTitle') == 'Clear Route Instructions', 'the clear dialog is titled "Clear Route Instructions"')
        await pg.click('#mOk')
        check(await pg.evaluate('R().rows.length') == 0, 'Clear Route Instructions empties the table')
        await pg.click('#tabs button[data-v=run]')
        check('No Route Instructions yet' in await pg.inner_text('#v-run'), 'the Run empty state says "No Route Instructions yet"')
        await pg.click('#tabs button[data-v=route]')
        await pg.click('#btnPaste'); await pg.fill('#pasteBox', csv_text); await pg.click('#mOk')
        check(await pg.evaluate(PROPS) == rows_exported and len(rows_exported) > 0, f'an exported CSV re-imports the same {len(rows_exported)} rows through Paste rows')
        # offline copy runs standalone; Read explains the API key (DESIGN l.38)
        pg2 = await (await b.new_context(viewport={'width':390,'height':844})).new_page(); capture_errors(pg2, label='offline copy')
        await pg2.goto((OUT_DIR / 'offline.html').as_uri()); await pg2.click('#btnNewSample'); await pg2.click('#tabs button[data-v=route]')
        await pg2.set_input_files('#fPages', PAGE); await pg2.click('#btnRead')
        body = await pg2.inner_text('#mBody')
        check(await pg2.is_visible('#modal.on') and 'api key' in body.lower(), f"offline Read without a key explains the API key ({await pg2.inner_text('#mTitle')!r})")
        await pg2.screenshot(path=str(OUT_DIR / '22-offline-read.png'))
        await pg2.click('#mOk'); await pg2.screenshot(path=str(OUT_DIR / '23-chat.png'))
        await b.close()
run(main)
