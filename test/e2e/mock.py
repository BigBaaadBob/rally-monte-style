# Mocks the Claude runtime: db returns FROZEN snapshot data (as the real one does), sample returns rows.
import asyncio, json, sys
from playwright.async_api import async_playwright
sys.path.insert(0, '/home/claude/rt')
MOCK = r"""
(() => {
  const deepFreeze = o => { Object.values(o).forEach(v => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
  const remote = window.__REMOTE__;
  const db = { collection: path => ({
      get: async () => ({ docs: remote.map(r => ({ id: r.id, exists: true, data: () => deepFreeze(JSON.parse(JSON.stringify({ rally: r, updated: r.updated }))) })) }),
      doc: id => ({ set: async d => { window.__writes = (window.__writes||0)+1; }, delete: async () => {} }) }) };
  const sample = Object.assign(async (input, opts) => {
      window.__sampleCalls = (window.__sampleCalls||0)+1; window.__sampleImgs = opts.images.length;
      return { text: JSON.stringify([{ri:300, om:'1.10', czt:null, instr:'L at T', info:''},{ri:301, om:'1.30', czt:'16:10:00', cp:80, instr:'CHECKPOINT', info:''}]) }; },
    { limits: async () => ({ images: true }) });
  const caps = { db, user: { id: async () => 'u1' }, sample: Object.freeze(sample), downloads: null };
  window.claude = Object.freeze({ use: async n => caps[n] ?? null });
})();
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        ctx = await b.new_context(viewport={'width':820,'height':1180}, has_touch=True)
        remote = {'id':'rCLOUD','name':'Made on another device','date':'2026-11-11','crew':{'driver':'Bob','navigator':'','passengers':[]},
                  'cn':12,'ocf':1.02,'speedo':30,'rows':[{'ri':299,'om':0.5,'restart':False,'czt':None,'cp':None,'instr':'x','info':''}],
                  'taEvents':[],'created':1,'updated':9999999999999}
        await ctx.add_init_script(f"window.__REMOTE__ = {json.dumps([remote])};" + MOCK)
        pg = await ctx.new_page(); errs=[]
        pg.on('pageerror', lambda e: errs.append('pageerror: '+str(e)))
        await pg.goto('file:///home/claude/rt/dist/index.html'); await pg.evaluate('localStorage.clear()'); await pg.reload()
        await pg.wait_for_function("document.getElementById('cloud').textContent.includes('account')", timeout=5000)
        await pg.click('[data-open="rCLOUD"]'); await pg.click('#tabs button[data-v=route]')
        # fake a photo
        png = await pg.evaluate("""(async()=>{const c=document.createElement('canvas');c.width=60;c.height=80;c.getContext('2d').fillRect(0,0,10,10);
            return await new Promise(r=>c.toBlob(b=>{const fr=new FileReader();fr.onload=()=>r(fr.result.split(',')[1]);fr.readAsDataURL(b)},'image/png'))})()""")
        import base64; open('/home/claude/rt/test/e2e/page.png','wb').write(base64.b64decode(png))
        await pg.set_input_files('#fPages', '/home/claude/rt/test/e2e/page.png')
        await pg.click('#btnRead'); await pg.wait_for_selector('#modal.on', timeout=8000)
        print('dialog:', (await pg.inner_text('#mBody')).replace('\n',' | ')[:200])
        await pg.click('#mOk')
        print('rows now:', await pg.evaluate("R().rows.map(r=>r.ri).join(',')"), 'sample calls', await pg.evaluate('window.__sampleCalls'))
        await pg.click('#tabs button[data-v=run]'); await pg.click('#btnDone')
        print('after complete:', await pg.evaluate("R().rows.filter(r=>r.done).length"))
        print('ERRORS', errs); await b.close()
asyncio.run(main())
