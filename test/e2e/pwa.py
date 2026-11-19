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

def canned(n, model):
    # Invented reader reply: the first read returns RI 301 and RI 302; a re-read returns only 301, with the model in its text.
    ris = [301, 302] if n == 1 else [301]
    return [{'ri': ri, 'om': '1.10', 'czt': None, 'cp': None, 'instr': f'L at T by {model}', 'info': ''} for ri in ris]

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
                rows = canned(len(calls), body['model'])
                await route.fulfill(status=200, content_type='application/json',
                                    body=json.dumps({'content': [{'type': 'text', 'text': '```json\n' + json.dumps(rows) + '\n```'}], 'stop_reason': 'end_turn'}),
                                    headers={'access-control-allow-origin': '*'})
            await ctx.route('https://api.anthropic.com/**', api)
            pg = await ctx.new_page(); capture_errors(pg)
            url = f'http://127.0.0.1:{PORT}/'
            await pg.goto(url); await pg.evaluate('localStorage.clear()')
            await pg.wait_for_function('navigator.serviceWorker.ready.then(() => true)')
            await pg.reload(); await pg.wait_for_function('!!navigator.serviceWorker.controller')
            # DESIGN Hosting and install: app name `Rally: Monte Style`, short_name `Monte Style`.
            man = await pg.evaluate("fetch(document.querySelector('link[rel=manifest]').href).then(r => r.json())")
            check(man['name'] == 'Rally: Monte Style', f"manifest name is Rally: Monte Style ({man['name']!r})")
            check(man['short_name'] == 'Monte Style', f"manifest short_name is Monte Style ({man['short_name']!r})")
            check(await pg.title() == 'Rally: Monte Style', f'document.title is Rally: Monte Style ({await pg.title()!r})')
            print('version:', await pg.evaluate('APP_VERSION'))
            # DESIGN Storage: the old rallyRT.* keys are deleted unread on load; nothing is migrated.
            await pg.evaluate("localStorage.setItem('rallyRT.v1', '{\"rallies\":{}}'); localStorage.setItem('rallyRT.apikey', 'sk-ant-stale')")
            await pg.reload(); await pg.wait_for_selector('#tabs')
            check(await pg.evaluate("localStorage.getItem('rallyRT.v1')") is None, 'the old rallyRT.v1 key is deleted on load')
            check(await pg.evaluate("localStorage.getItem('rallyRT.apikey')") is None, 'the old rallyRT.apikey key is deleted on load')
            check(await pg.evaluate("localStorage.getItem('rallyMonteStyle.apikey')") is None, 'the old API key is not carried to the new key')
            # DESIGN Hosting: caches with the old and new prefixes that are not current are deleted on update.
            await pg.evaluate("Promise.all(['route-table-old', 'rally-monte-style-old', 'unrelated-cache'].map(n => caches.open(n)))")
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
            check(await pg.evaluate("localStorage.getItem('rallyMonteStyle.apikey')") is None, 'a malformed key is rejected and not stored')
            KEY = 'sk-ant-test-123'
            await pg.fill('#fKey', KEY); await pg.click('#bKey')
            check(await pg.evaluate("localStorage.getItem('rallyMonteStyle.apikey')") == KEY, 'a key starting sk-ant- is saved on the device')
            await pg.set_input_files('#fPages', str(PAGE))
            await pg.click('#btnRead'); await pg.wait_for_selector('#modal.on'); await pg.click('#mOk')
            cap = await pg.inner_text('.thumbs figcaption')
            check('Sonnet' in cap, f'the page thumbnail names the model that read it ({cap!r})')
            check(await pg.evaluate('ri => R().rows.some(r => r.ri === ri)', 300 + 1), 'the rows from the first read are in the table')
            # Re-read uses the model selected now (not a fixed one) and merges by RI: a returned row replaces the same RI, other rows stay.
            await pg.select_option('#fModel', 'claude-haiku-5-5')
            check(await pg.evaluate('store.prefs.model') == 'claude-haiku-5-5', 'the chosen model is saved')
            check(await pg.query_selector('[data-opus]') is None and (await pg.inner_text('[data-reread="0"]')).strip() == 'Re-read', 'the page offers "Re-read" (no "Re-read: Opus")')
            before = await pg.evaluate('R().rows')
            expected = await pg.evaluate("([before, rows]) => Core.mergeRows(before, rows).rows.map(r => r.ri + ':' + r.instr).join('|')", [before, canned(2, 'claude-haiku-5-5')])
            await pg.click('[data-reread="0"]'); await pg.wait_for_selector('#modal.on'); await pg.click('#mOk')
            cap = await pg.inner_text('.thumbs figcaption')
            check('Haiku' in cap and 'Sonnet' not in cap, f'the thumbnail shows the model that read the page last ({cap!r})')
            check(await pg.evaluate("R().rows.map(r => r.ri + ':' + r.instr).join('|')") == expected, 'the re-read merged by RI: the returned row was replaced')
            check(await pg.evaluate('ri => R().rows.some(r => r.ri === ri)', 302), 'a row the re-read did not return stays')
            # DESIGN l.57-59: each read goes straight to the API with the user's key and the model in use.
            print('API calls:', calls)
            check(len(calls) == 2, 'one API call for the read and one for the re-read')
            check(all(c['key'] == KEY for c in calls), 'every API call carries the saved key')
            check(all(c['direct'] == 'true' for c in calls), 'every API call sets anthropic-dangerous-direct-browser-access: true')
            check([c['model'] for c in calls] == ['claude-sonnet-5-5', 'claude-haiku-5-5'], 'the read uses Sonnet 5.5 and the re-read uses the selected model, Haiku 5.5')
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
            names = await pg.evaluate('caches.keys()')
            check('route-table-old' not in names and 'rally-monte-style-old' not in names, f'stale caches are deleted by the real service-worker update ({names})')
            check('unrelated-cache' in names, 'a cache with neither prefix is left alone')
            check(sum(n.startswith('rally-monte-style-') for n in names) == 1, 'exactly one current-version cache remains')
            await b.close()
    finally:
        srv.terminate()

run(main)
