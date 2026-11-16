"""Hosted-app checks: offline cache, update prompt, and API-key reading (Anthropic API mocked).
Run from the repo root after a build:
  Windows:    .venv/Scripts/python build.py && .venv/Scripts/python test/e2e/pwa.py
  Linux/WSL:  .venv/bin/python build.py && .venv/bin/python test/e2e/pwa.py"""
from _common import ROOT, OUT_DIR, launch_browser, check, capture_errors, run
import json, socket, subprocess, sys, time
from playwright.async_api import async_playwright

PORT = 8765
PAGE = ROOT / 'test/e2e/page.png'

def serve():
    proc = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--bind', '127.0.0.1', '-d', str(ROOT / 'dist')],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    deadline = time.monotonic() + 10
    while True:
        try:
            socket.create_connection(('127.0.0.1', PORT), timeout=1).close(); return proc
        except OSError:
            if time.monotonic() > deadline:
                proc.terminate(); raise RuntimeError(f'http.server did not start on 127.0.0.1:{PORT} within 10 s')
            time.sleep(0.1)

async def main():
    srv = serve()
    calls = []
    try:
        async with async_playwright() as p:
            b = await launch_browser(p)
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
            pg = await ctx.new_page(); capture_errors(pg)
            url = f'http://127.0.0.1:{PORT}/'
            await pg.goto(url); await pg.evaluate('localStorage.clear()')
            await pg.wait_for_function('navigator.serviceWorker.ready.then(() => true)')
            await pg.reload(); await pg.wait_for_function('!!navigator.serviceWorker.controller')
            print('version:', await pg.evaluate('APP_VERSION'))
            # DESIGN l.50: sw.js caches the app's own files, so the installed app opens and reloads offline.
            check(await pg.evaluate('!!navigator.serviceWorker.controller'), 'the service worker controls the page')
            await pg.click('#btnNewSample')
            n_rallies = await pg.evaluate('Object.keys(store.rallies).length')
            await ctx.set_offline(True)
            await pg.reload(); await pg.wait_for_selector('#tabs')
            check(await pg.evaluate('Object.keys(store.rallies).length') == n_rallies and n_rallies > 0, f'offline reload keeps the saved rally ({n_rallies})')
            await ctx.set_offline(False)
            # reader settings and API reading
            await pg.click('#tabs button[data-v=route]')
            check(await pg.input_value('#fModel') == 'claude-sonnet-5-5', 'the model picker defaults to Sonnet 5.5 (DESIGN l.58)')
            # DESIGN l.57: only a key starting sk-ant- is saved; anything else is rejected and nothing is stored.
            await pg.fill('#fKey', 'not-a-key'); await pg.click('#bKey')
            check(await pg.evaluate("localStorage.getItem('rallyRT.apikey')") is None, 'a malformed key is rejected and not stored')
            KEY = 'sk-ant-test-123'
            await pg.fill('#fKey', KEY); await pg.click('#bKey')
            check(await pg.evaluate("localStorage.getItem('rallyRT.apikey')") == KEY, 'a key starting sk-ant- is saved on the device')
            await pg.set_input_files('#fPages', str(PAGE))
            await pg.click('#btnRead'); await pg.wait_for_selector('#modal.on'); await pg.click('#mOk')
            cap = await pg.inner_text('.thumbs figcaption')
            check('Sonnet' in cap, f'the page thumbnail names the model that read it ({cap!r})')
            check(await pg.evaluate('ri => R().rows.some(r => r.ri === ri)', 300 + 1), 'the rows from the first read are in the table')
            await pg.click('[data-opus="0"]'); await pg.wait_for_selector('#modal.on'); await pg.click('#mOk')
            cap = await pg.inner_text('.thumbs figcaption')
            check('Opus' in cap and await pg.query_selector('[data-opus="0"]') is None, f'the Opus re-read renames the thumbnail and the button goes ({cap!r})')
            await pg.select_option('#fModel', 'claude-haiku-5-5')
            check(await pg.evaluate('store.prefs.model') == 'claude-haiku-5-5', 'the chosen model is saved')
            # DESIGN l.57-59: each read goes straight to the API with the user's key and the model in use.
            print('API calls:', calls)
            check(len(calls) == 2, 'one API call for the read and one for the Opus re-read')
            check(all(c['key'] == KEY for c in calls), 'every API call carries the saved key')
            check(all(c['direct'] == 'true' for c in calls), 'every API call sets anthropic-dangerous-direct-browser-access: true')
            check([c['model'] for c in calls] == ['claude-sonnet-5-5', 'claude-opus-5-5'], 'the read uses Sonnet 5.5 and the re-read uses Opus 5.5')
            await pg.screenshot(path=str(OUT_DIR / 'pwa-route.png'))
            # DESIGN l.52: a new version shows a banner and is applied only when the user taps Reload.
            subprocess.run([sys.executable, str(ROOT / 'build.py')], check=True, stdout=subprocess.DEVNULL)
            await pg.evaluate('navigator.serviceWorker.getRegistration().then(r => r.update())')
            await pg.wait_for_selector('#updBar.on', timeout=10000)
            check(True, 'the update banner appears when a new version is published')
            old = await pg.evaluate('APP_VERSION')
            async with pg.expect_navigation():
                await pg.click('#btnUpd')
            await pg.wait_for_selector('#tabs')
            new = await pg.evaluate('APP_VERSION')
            check(old != new, f'Reload applies the new version ({old} -> {new})')
            await b.close()
    finally:
        srv.terminate()

run(main)
