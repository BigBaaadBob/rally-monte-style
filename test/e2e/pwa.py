"""Hosted-app checks: offline cache, update prompt, and API-key reading (Anthropic API mocked).
Run from the repo root after a build:
  Windows:    .venv/Scripts/python build.py && .venv/Scripts/python test/e2e/pwa.py
  Linux/WSL:  .venv/bin/python build.py && .venv/bin/python test/e2e/pwa.py"""
from _common import ROOT, OUT_DIR, launch_browser, check, capture_errors, run
import asyncio, json, socket, subprocess, sys, time
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
    return [{'ri': ri, 'om': '1.10', 'czt': None, 'cp': None, 'instr': f'L at T by {model}', 'info': '', 'row': k + 1, 'y': round(0.3 + 0.2 * k, 2)} for k, ri in enumerate(ris)]

async def main():
    srv = serve()
    calls = []
    hook = {'delay': 0.0, 'rows': None}      # a test sets rows (and a delay) to override the canned reply for the next reads
    try:
        async with async_playwright() as p:
            b = await launch_browser(p)
            ctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
            async def api(route):
                body = json.loads(route.request.post_data)
                calls.append({'model': body['model'], 'max_tokens': body['max_tokens'], 'key': route.request.headers.get('x-api-key'),
                              'direct': route.request.headers.get('anthropic-dangerous-direct-browser-access')})
                rows = hook['rows'] if hook['rows'] is not None else canned(len(calls), body['model'])
                if hook['delay']: await asyncio.sleep(hook['delay'])
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
            # DESIGN § Hosting and install: sw.js caches the app's own files, so the installed app opens and reloads offline.
            check(await pg.evaluate('!!navigator.serviceWorker.controller'), 'the service worker controls the page')
            await pg.click('#btnNewSample')
            # DESIGN § Tabs and settings (Rallies): the Delete rally text is as in DESIGN.
            name = await pg.evaluate("R().name || 'Untitled rally'")
            await pg.click('#tabs button[data-v=rallies]'); await pg.click(f'[data-rdel="{await pg.evaluate("R().id")}"]')
            body = await pg.inner_text('#mBody')
            check(body == f'Delete “{name}” and all its data from this device? This cannot be undone. Save it to a file first if you want to keep it.', f'Delete rally text on the API-key path ({body})')
            await pg.click('#mCancel')
            n_rallies = await pg.evaluate('Object.keys(store.rallies).length')
            await ctx.set_offline(True)
            await pg.reload(); await pg.wait_for_selector('#tabs')
            check(await pg.evaluate('Object.keys(store.rallies).length') == n_rallies and n_rallies > 0, f'offline reload keeps the saved rally ({n_rallies})')
            await ctx.set_offline(False)
            # reader settings and API reading
            await pg.click('#tabs button[data-v=route]')
            check(await pg.input_value('#fModel') == 'claude-sonnet-5-5', 'the model picker defaults to Sonnet 5.5 (DESIGN § Reading pages)')
            # DESIGN § Reading pages: only a key starting sk-ant- is saved; anything else is rejected and nothing is stored.
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
            # DESIGN § Reading pages: each read goes straight to the API with the user's key and the model in use.
            print('API calls:', calls)
            check(len(calls) == 2, 'one API call for the read and one for the re-read')
            check(all(c['key'] == KEY for c in calls), 'every API call carries the saved key')
            check(all(c['direct'] == 'true' for c in calls), 'every API call sets anthropic-dangerous-direct-browser-access: true')
            check([c['model'] for c in calls] == ['claude-sonnet-5-5', 'claude-haiku-5-5'], 'the read uses Sonnet 5.5 and the re-read uses the selected model, Haiku 5.5')
            await pg.screenshot(path=str(OUT_DIR / 'pwa-route.png'))
            # DESIGN § Reading pages → Page photos: photos are per rally, removable one at a time with a confirm, and reads merge into the owning rally.
            def tagged(tag, base):
                return [{'ri': base + k, 'om': '2.00', 'czt': None, 'cp': None, 'instr': tag, 'info': '', 'row': k + 1, 'y': round(0.3 + 0.2 * k, 2)} for k in range(2)]
            def png(name): return {'name': name, 'mimeType': 'image/png', 'buffer': PAGE.read_bytes()}
            async def open_route(rid):
                await pg.click('#tabs button[data-v=rallies]'); await pg.click(f'[data-open="{rid}"]'); await pg.click('#tabs button[data-v=route]')
            async def modal():
                await pg.wait_for_selector('#modal.on')
                return await pg.inner_text('#mTitle'), (await pg.inner_text('#mOk')).strip(), await pg.inner_text('#mBody')
            async def names(): return await pg.evaluate('pagesOf(R().id).map(p => p.file.name)')
            async def thumbs(): return await pg.evaluate("document.querySelectorAll('.thumbs figure').length")
            async def modal_on(): return await pg.evaluate("document.getElementById('modal').classList.contains('on')")
            await pg.evaluate("window.__revoked = []; const o = URL.revokeObjectURL; URL.revokeObjectURL = u => { __revoked.push(u); o.call(URL, u); }")
            A = await pg.evaluate('R().id'); A_name = await pg.evaluate("R().name || 'this rally'")
            await pg.set_input_files('#fPages', [png('a2.png'), png('a3.png')])
            a_names = await names()
            check(len(a_names) == 3 and await thumbs() == 3, f'rally A shows its 3 photos ({a_names})')
            a_rows = await pg.evaluate('R().rows')
            await pg.click('#tabs button[data-v=rallies]'); await pg.click('#btnNew')
            B = await pg.evaluate('R().id'); await pg.evaluate("R().name = 'Rally B'; save(R())")
            await pg.click('#tabs button[data-v=route]')
            check(B != A and await thumbs() == 0, "opening rally B shows none of A's photos")
            check(await pg.is_disabled('#btnRead'), 'Read is disabled on B, which has no photos')
            await pg.set_input_files('#fPages', [png('b1.png')])
            hook['rows'] = tagged('b-read', 700)
            await pg.click('#btnRead'); await modal(); await pg.click('#mOk')
            want_b = await pg.evaluate("rows => Core.mergeRows([], rows).rows.map(r => r.ri + ':' + r.instr).join('|')", hook['rows'])
            check(await pg.evaluate("R().rows.map(r => r.ri + ':' + r.instr).join('|')") == want_b, 'Read on B merges its page rows into B')
            check(await pg.evaluate('ri => store.rallies[ri].rows', A) == a_rows, "Read on B leaves A's Route Instructions unchanged")
            await open_route(A)
            check(await names() == a_names and await thumbs() == 3, "reopening A shows A's photos again")
            # A read started on A that finishes after B is opened merges into A only.
            b_rows = await pg.evaluate('ri => store.rallies[ri].rows', B); b_new = await pg.evaluate('ri => [...newOf(ri)]', B)
            hook['rows'] = tagged('a-inflight', 800); hook['delay'] = 1.0
            await pg.click('[data-reread="0"]')
            await open_route(B)
            await pg.wait_for_function('readingBy.size === 0', timeout=10000); hook['delay'] = 0.0
            title, ok, body = await modal()
            check(body.startswith(f'“{A_name}”:'), f'the Pages read summary names the owning rally when another is open ({body[:60]!r})')
            await pg.click('#mOk')
            want_a = await pg.evaluate("([rows, add]) => Core.mergeRows(rows, add).rows.map(r => r.ri + ':' + r.instr).join('|')", [a_rows, hook['rows']])
            check(await pg.evaluate("ri => store.rallies[ri].rows.map(r => r.ri + ':' + r.instr).join('|')", A) == want_a, 'the in-flight read merged into A')
            check(await pg.evaluate('ri => store.rallies[ri].rows', B) == b_rows, "the in-flight read left B's Route Instructions unchanged")
            check(await pg.evaluate('ri => [...newOf(ri)]', B) == b_new, "the in-flight read left B's last-read highlight unchanged")
            check(await pg.evaluate("ri => store.rallies[ri].rows.filter(r => r.instr === 'a-inflight').every(r => newOf(ri).has(String(r.ri)))", A), "the in-flight read set A's last-read highlight")
            await open_route(A)
            a_rows = await pg.evaluate('R().rows'); a_new = await pg.evaluate('[...newOf(R().id)]')
            # The remove button on a thumbnail removes one photo after a confirm.
            await pg.click('[data-rmphoto="1"]')
            check(await modal() == ('Remove photo', 'Remove', 'Remove this page photo? Route Instructions already read from it stay.'), 'the remove dialog title, OK label, and text')
            await pg.click('#mCancel')
            check(await names() == a_names, 'Cancel keeps the photo')
            await pg.click('[data-rmphoto="1"]'); await modal()
            await pg.mouse.click(3, 3)
            check(await names() == a_names and not await modal_on(), 'tapping outside keeps the photo and closes the dialog')
            gone_url = await pg.evaluate('pagesOf(R().id)[1].url')
            await pg.click('[data-rmphoto="1"]'); await modal(); await pg.click('#mOk')
            check(await names() == [a_names[0], a_names[2]] and await thumbs() == 2, 'Remove removes only that photo')
            check(await pg.evaluate('u => __revoked.includes(u)', gone_url), "Remove frees the photo's object URL")
            check(await pg.evaluate('R().rows') == a_rows and await pg.evaluate('[...newOf(R().id)]') == a_new, 'Remove leaves the Route Instructions and the highlight unchanged')
            # Clear photos: plural, singular, Cancel.
            urls = await pg.evaluate('pagesOf(R().id).map(p => p.url)')
            await pg.click('#btnClearPages')
            check(await modal() == ('Clear photos', 'Clear', f'Clear all 2 page photos from “{A_name}”? Route Instructions already read from them stay.'), 'Clear photos text with two photos')
            await pg.click('#mCancel')
            check(len(await names()) == 2, 'Cancel keeps all the photos')
            await pg.click('[data-rmphoto="0"]'); await modal(); await pg.click('#mOk')
            await pg.click('#btnClearPages')
            check(await modal() == ('Clear photos', 'Clear', f'Clear the 1 page photo from “{A_name}”? Route Instructions already read from it stay.'), 'Clear photos text with one photo')
            await pg.click('#mOk')
            check(await names() == [] and await pg.query_selector('#btnClearPages') is None, 'Clear removes the photos and the button goes away')
            check(await pg.evaluate('us => us.every(u => __revoked.includes(u))', urls), 'Clear frees the object URLs')
            check(await pg.evaluate('R().rows') == a_rows and await pg.evaluate('[...newOf(R().id)]') == a_new, 'Clear leaves the Route Instructions and the highlight unchanged')
            # Delete rally drops its photos; the remaining rally shows only its own.
            await pg.set_input_files('#fPages', [png('a-del.png')])
            a_url = await pg.evaluate('pagesOf(R().id)[0].url')
            await pg.click('#tabs button[data-v=rallies]'); await pg.click(f'[data-rdel="{await pg.evaluate("R().id")}"]'); await modal(); await pg.click('#mOk')
            check(await pg.evaluate('([a, u]) => !(a in pagesByRally) && __revoked.includes(u)', [A, a_url]), "Delete rally drops the rally's photos and frees their URLs")
            await open_route(B)
            check(await names() == ['b1.png'] and await thumbs() == 1, "the remaining rally shows only its own photo, none of A's")
            # Replace (loading a rally file with the same id) while one of its reads is running: the rows are discarded, with no message; the photos stay.
            b_rows = await pg.evaluate("store.rallies[%r].rows.length" % B)
            await pg.click('#tabs button[data-v=rallies]')
            async with pg.expect_download() as dl:
                await pg.click(f'[data-save="{B}"]')
            saved_b = OUT_DIR / 'pwa-b.rally'; await (await dl.value).save_as(saved_b)
            await open_route(B)
            hook['rows'] = tagged('b-replaced', 950); hook['delay'] = 1.0
            await pg.click('[data-reread="0"]')
            await pg.click('#tabs button[data-v=rallies]')
            await pg.set_input_files('#fLoad', files=[{'name': 'b.rally', 'mimeType': 'application/octet-stream', 'buffer': saved_b.read_bytes()}])
            await modal(); await pg.click('#mOk')
            await pg.wait_for_function('readingBy.size === 0', timeout=10000); hook['delay'] = 0.0; hook['rows'] = None
            check(not await modal_on() and await pg.evaluate("store.rallies[%r].rows.length" % B) == b_rows, 'replacing a rally during its read discards the rows with no message')
            check(await pg.evaluate("pagesOf(%r).length" % B) == 1 and await pg.evaluate("pagesOf(%r)[0].state" % B) != 'busy', "Replace keeps the rally's page photos, and the discarded read leaves none of them reading")
            await open_route(B)
            # Delete rally while one of its reads is running: the rows are discarded, with no message and no error.
            hook['rows'] = tagged('b-late', 900); hook['delay'] = 1.0
            await pg.click('[data-reread="0"]')
            await pg.click('#tabs button[data-v=rallies]'); await pg.click(f'[data-rdel="{await pg.evaluate("R().id")}"]'); await modal(); await pg.click('#mOk')
            await pg.wait_for_function('readingBy.size === 0', timeout=10000); hook['delay'] = 0.0; hook['rows'] = None
            check(not await modal_on() and B not in await pg.evaluate('Object.keys(store.rallies)'), 'deleting a rally during its read discards the rows with no message')
            # DESIGN § Hosting and install: a new version shows a banner and is applied only when the user taps Reload.
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
