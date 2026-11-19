"""Mocks the Claude runtime: db returns FROZEN snapshot data (as the real one does), sample returns rows.
Run from the repo root after a build:
  Windows:    .venv/Scripts/python build.py && .venv/Scripts/python test/e2e/mock.py
  Linux/WSL:  .venv/bin/python build.py && .venv/bin/python test/e2e/mock.py"""
from _common import APP_URL, launch_browser, check, capture_errors, run
import json
from playwright.async_api import async_playwright
import pathlib
PAGE = str(pathlib.Path(__file__).resolve().parent / 'page.png')   # committed fixture image

MOCK = r"""
(() => {
  const deepFreeze = o => { Object.values(o).forEach(v => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
  const remote = window.__REMOTE__;
  const db = { collection: path => ({
      get: async () => ({ docs: remote.map(r => ({ id: r.id, exists: true, data: () => deepFreeze(JSON.parse(JSON.stringify({ rally: r, updated: r.updated }))) })) }),
      doc: id => ({ set: async d => { window.__writes = (window.__writes||0)+1; }, delete: async () => {} }) }) };
  const sample = Object.assign(async (input, opts) => {
      window.__sampleCalls = (window.__sampleCalls||0)+1; window.__sampleImgs = opts.images.length;
      await new Promise(r => setTimeout(r, window.__sampleDelay || 0));
      return { text: JSON.stringify(window.__sampleRows || __READ_ROWS__) }; },
    { limits: async () => ({ images: true }) });
  const caps = { db, user: { id: async () => 'u1' }, sample: Object.freeze(sample), downloads: null };
  window.claude = Object.freeze({ use: async n => caps[n] ?? null });
})();
"""
READ_ROWS = [{'ri':300, 'om':'1.10', 'czt':None, 'instr':'L at T', 'info':''},
             {'ri':301, 'om':'1.30', 'czt':'16:10:00', 'cp':80, 'instr':'CHECKPOINT', 'info':''}]
MOCK = MOCK.replace('__READ_ROWS__', json.dumps(READ_ROWS))

async def main():
    async with async_playwright() as p:
        b = await launch_browser(p)
        ctx = await b.new_context(viewport={'width':820,'height':1180}, has_touch=True)
        remote = {'id':'rCLOUD','name':'Made on another device','date':'2026-11-11','crew':{'driver':'Jane Driver','navigator':'','passengers':[]},
                  'cn':12,'ocf':1.02,'speedo':30,'rows':[{'ri':299,'om':0.5,'restart':False,'czt':None,'cp':None,'instr':'x','info':''}],
                  'taEvents':[],'created':1,'updated':9999999999999}
        await ctx.add_init_script(f"window.__REMOTE__ = {json.dumps([remote])};" + MOCK)
        pg = await ctx.new_page(); capture_errors(pg)    # the frozen account copy must load without a page error (DESIGN § Storage)
        await pg.goto(APP_URL); await pg.evaluate('localStorage.clear()'); await pg.reload()
        await pg.wait_for_function("document.getElementById('cloud').textContent.includes('account')", timeout=5000)
        await pg.click('[data-open="rCLOUD"]'); await pg.click('#tabs button[data-v=route]')
        before = await pg.evaluate("R().rows")
        await pg.set_input_files('#fPages', PAGE)
        await pg.click('#btnRead'); await pg.wait_for_selector('#modal.on', timeout=8000)
        print('dialog:', (await pg.inner_text('#mBody')).replace('\n',' | ')[:200])
        await pg.click('#mOk')
        # DESIGN § Getting the Route Instructions in and § Reading pages: one call per page photo, and the rows merge by RI and sort.
        want = await pg.evaluate("([before, rows]) => Core.mergeRows(before, rows).rows.map(r => r.ri).join(',')", [before, READ_ROWS])
        check(await pg.evaluate("R().rows.map(r => r.ri).join(',')") == want, f'Read merges the page rows into the account copy ({want})')
        check(await pg.evaluate('window.__sampleCalls') == 1, 'one sample call for one page photo')
        # DESIGN § Reading pages → Page photos: a read finishing after a rally switch merges into the rally that started it only.
        rid, rname = await pg.evaluate('R().id'), await pg.evaluate("R().name || 'Untitled rally'")
        after_read = await pg.evaluate('R().rows')
        later = [{'ri': 500 + k, 'om': '3.00', 'czt': None, 'instr': 'late', 'info': ''} for k in range(2)]
        await pg.evaluate("rows => { window.__sampleRows = rows; window.__sampleDelay = 800; }", later)
        await pg.click('[data-reread="0"]')
        await pg.click('#tabs button[data-v=rallies]'); await pg.click('#btnNew')
        other = await pg.evaluate('R().id'); await pg.click('#tabs button[data-v=route]')
        check(await pg.evaluate("document.querySelectorAll('.thumbs figure').length") == 0, "the other rally shows none of the first rally's photos")
        await pg.wait_for_function('readingBy.size === 0', timeout=10000)
        await pg.wait_for_selector('#modal.on')
        check((await pg.inner_text('#mBody')).startswith(f'“{rname}”:'), 'the summary names the rally that started the read')
        await pg.click('#mOk')
        want = await pg.evaluate("([rows, add]) => Core.mergeRows(rows, add).rows.map(r => r.ri + ':' + r.instr).join('|')", [after_read, later])
        check(await pg.evaluate("ri => store.rallies[ri].rows.map(r => r.ri + ':' + r.instr).join('|')", rid) == want, 'the late read merged into the rally that started it')
        check(await pg.evaluate("ri => store.rallies[ri].rows.length", other) == 0 and await pg.evaluate("ri => newOf(ri).size", other) == 0, 'the other rally has no rows and no highlight')
        await pg.evaluate("window.__sampleRows = null; window.__sampleDelay = 0")
        await pg.click('#tabs button[data-v=rallies]'); await pg.click(f'[data-open="{rid}"]'); await pg.click('#tabs button[data-v=route]')
        check(await pg.evaluate("document.querySelectorAll('.thumbs figure').length") == 1, 'reopening the first rally shows its photo')
        await pg.click('#tabs button[data-v=run]'); await pg.click('#btnDone')
        check(await pg.evaluate("R().rows.filter(r => r.done).length") == 1, 'Complete marks exactly one row done')
        # DESIGN § Tabs and settings (Data): inside Claude the Delete rally text names the Claude account.
        name = await pg.evaluate("R().name || 'Untitled rally'")
        await pg.click('#tabs button[data-v=data]'); await pg.click('#bDel')
        body = await pg.inner_text('#mBody')
        check(await pg.inner_text('#mTitle') == 'Delete rally' and (await pg.inner_text('#mOk')).strip() == 'Delete', 'Delete rally dialog title and OK label')
        check(body == f'Delete “{name}” and all its data from this device and your Claude account? This cannot be undone. Export it first if you want a record.', f'Delete rally text on the claude.ai path ({body})')
        await pg.click('#mCancel')
        await b.close()
run(main)
