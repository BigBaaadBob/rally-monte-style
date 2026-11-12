"""Hosted-app checks: offline cache, update prompt, and API-key reading (Anthropic API mocked).
Run from the repo root after `python3 build.py`:  python3 test/e2e/pwa.py"""
import asyncio, json, pathlib, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parents[2]
PORT = 8765
PAGE = ROOT / 'test/e2e/page.png'
CHROME = '/usr/bin/google-chrome'

def serve():
    return subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '-d', str(ROOT / 'dist')],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

async def main():
    srv = serve(); time.sleep(0.8)
    calls = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
            ctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
            async def api(route):
                body = json.loads(route.request.post_data)
                calls.append({'model': body['model'], 'max_tokens': body['max_tokens'], 'key': route.request.headers.get('x-api-key'),
                              'direct': route.request.headers.get('anthropic-dangerous-direct-browser-access')})
                rows = [{'ri': 300 + len(calls), 'om': '1.10', 'czt': None, 'cp': None, 'instr': 'L at T', 'info': ''}]
                await route.fulfill(status=200, content_type='application/json',
                                    body=json.dumps({'content': [{'type': 'text', 'text': '```json\n' + json.dumps(rows) + '\n```'}], 'stop_reason': 'end_turn'}),
                                    headers={'access-control-allow-origin': '*'})
            await ctx.route('https://api.anthropic.com/**', api)
            pg = await ctx.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            url = f'http://localhost:{PORT}/'
            await pg.goto(url); await pg.evaluate('localStorage.clear()')
            await pg.wait_for_function('navigator.serviceWorker.ready.then(() => true)')
            await pg.reload(); await pg.wait_for_function('!!navigator.serviceWorker.controller')
            print('version:', await pg.evaluate('APP_VERSION'))
            print('controlled by service worker:', await pg.evaluate('!!navigator.serviceWorker.controller'))
            # offline reload
            await pg.click('#btnNewSample')
            await ctx.set_offline(True)
            await pg.reload(); await pg.wait_for_selector('#tabs')
            print('offline reload ok, rallies:', await pg.evaluate('Object.keys(store.rallies).length'), '| view:', await pg.evaluate('view'))
            await ctx.set_offline(False)
            # reader settings and API reading
            await pg.click('#tabs button[data-v=route]')
            print('model default:', await pg.input_value('#fModel'))
            await pg.fill('#fKey', 'not-a-key'); await pg.click('#bKey')
            print('bad key rejected:', await pg.evaluate("!localStorage.getItem('rallyRT.apikey')"))
            await pg.fill('#fKey', 'sk-ant-test-123'); await pg.click('#bKey')
            await pg.set_input_files('#fPages', str(PAGE))
            await pg.click('#btnRead'); await pg.wait_for_selector('#modal.on'); await pg.click('#mOk')
            print('after Sonnet read:', await pg.inner_text('.thumbs figcaption'), '| rows has 301:', await pg.evaluate('R().rows.some(r => r.ri === 301)'))
            await pg.click('[data-opus="0"]'); await pg.wait_for_selector('#modal.on'); await pg.click('#mOk')
            print('after Opus re-read:', await pg.inner_text('.thumbs figcaption'), '| Opus button gone:', await pg.query_selector('[data-opus="0"]') is None)
            await pg.select_option('#fModel', 'claude-haiku-5-5')
            print('model saved:', await pg.evaluate('store.prefs.model'))
            print('API calls:', calls)
            await pg.screenshot(path='/tmp/pwa-route.png')
            # update prompt: rebuild with a new version, then ask the worker to check
            subprocess.run([sys.executable, str(ROOT / 'build.py')], check=True, stdout=subprocess.DEVNULL)
            await pg.evaluate('navigator.serviceWorker.getRegistration().then(r => r.update())')
            await pg.wait_for_selector('#updBar.on', timeout=10000)
            print('update banner shown')
            old = await pg.evaluate('APP_VERSION')
            async with pg.expect_navigation():
                await pg.click('#btnUpd')
            await pg.wait_for_selector('#tabs')
            print('reloaded into new version:', old != await pg.evaluate('APP_VERSION'))
            print('ERRORS', errs)
            await b.close()
    finally:
        srv.terminate()

asyncio.run(main())
