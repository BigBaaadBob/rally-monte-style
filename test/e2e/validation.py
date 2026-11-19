"""Entry validation (DESIGN "Setup entry rules", "Computation" OM forms, "Run controls" speedometer):
CN, close-RI limit, OCF, OM, and speedometer. A bad entry shows its message and reverts; nothing is partly applied.
Run from the repo root after a build:
  Windows:    .venv/Scripts/python build.py && .venv/Scripts/python test/e2e/validation.py
  Linux/WSL:  .venv/bin/python build.py && .venv/bin/python test/e2e/validation.py
Exits 1 if any check fails or an unexpected page error is captured."""
from _common import APP_URL, launch_browser, check, capture_errors, run
from playwright.async_api import async_playwright

MSG_CN = 'Car number must be a whole number from 0 to 999'
MSG_CLOSE = 'Close RI limit must be between 0 and 5.0 miles'
MSG_OCF = 'OCF must be a positive number.'
MSG_OM = 'OM format: x.xx, x.xx/0.00, or /0.00'
MSG_SPEEDO = 'Speedometer must be between 1 and 100 mph'

SNAP = "JSON.stringify(R())"                               # the stored rally, for "unchanged" checks
COMPUTED = "JSON.stringify(Core.compute(R()).map(c => [c.vm, c.tt, c.close]))"


async def enter(pg, sel, text):
    """Type into a Setup or Route field and commit it by tabbing away (the browser fires the change event)."""
    await pg.fill(sel, text)
    await pg.press(sel, 'Tab')


async def rejects(pg, sel, text, msg, label):
    """An invalid entry shows msg, the field shows its previous value, and the stored rally is unchanged."""
    before_val, before = await pg.input_value(sel), await pg.evaluate(SNAP)
    await pg.evaluate("$('toast').textContent = ''")
    await enter(pg, sel, text)
    check(await pg.text_content('#toast') == msg, f'{label}: {text!r} shows the message')
    check(await pg.input_value(sel) == before_val, f'{label}: {text!r} reverts the field to {before_val!r}')
    check(await pg.evaluate(SNAP) == before, f'{label}: {text!r} leaves the stored rally unchanged')


async def main():
    async with async_playwright() as p:
        b = await launch_browser(p)
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); capture_errors(pg, label='validation')
        await pg.goto(APP_URL); await pg.evaluate('localStorage.clear()'); await pg.reload()
        await pg.click('#btnNewSample')            # opens set-up with the sample rally

        # ---- CN: blank or a whole number 0-999; blank computes as 0 minutes
        for bad in ['1000', '-1', '1.5', 'abc', '7a']:
            await rejects(pg, '#fCN', bad, MSG_CN, 'CN')
        for good, minutes in [('', 0), ('0', 0), ('999', 999)]:
            await enter(pg, '#fCN', good)
            exp = await pg.evaluate("""m => { const r = JSON.parse(JSON.stringify(R())); r.cn = m; r.rows.forEach(x => { x.done = false; });
              return JSON.stringify(Core.compute(r).map(c => [c.vm, c.tt, c.close])); }""", minutes)
            check(await pg.evaluate("R().cn") == (int(good) if good else ''), f'CN {good!r} is accepted and stored')
            check(await pg.evaluate(COMPUTED) == exp, f'CN {good!r} computes TT with {minutes} minutes (equals Core)')

        # ---- Close-RI limit: blank (0.5 default) or 0-5.0 vehicle miles
        for bad in ['5.1', '-0.1', 'abc', '1,5']:
            await rejects(pg, '#fClose', bad, MSG_CLOSE, 'close limit')
        for good, lim in [('0', 0), ('5', 5), ('5.0', 5), ('', 0.5)]:
            await enter(pg, '#fClose', good)
            exp = await pg.evaluate("""l => { const r = JSON.parse(JSON.stringify(R())); r.closeMi = l; return JSON.stringify(Core.compute(r).map(c => [c.vm, c.tt, c.close])); }""", lim)
            check(await pg.evaluate("R().closeMi") == lim, f'close limit {good!r} is accepted and stored as {lim}')
            check(await pg.input_value('#fClose') == str(lim), f'close limit {good!r} shows {lim}')
            check(await pg.evaluate(COMPUTED) == exp, f'close limit {good!r} flags close rows as Core does with {lim}')

        # ---- OCF: a number greater than 0, shown to four decimals
        for bad in ['', '0', '-1', 'abc', '1.0x']:
            vms = await pg.evaluate("JSON.stringify(Core.compute(R()).map(c => c.vm))")
            await rejects(pg, '#fOCF', bad, MSG_OCF, 'OCF')
            check(await pg.evaluate("JSON.stringify(Core.compute(R()).map(c => c.vm))") == vms, f'OCF {bad!r}: every row VM is unchanged')
        await enter(pg, '#fOCF', '1.05')
        exp = await pg.evaluate("() => { const r = JSON.parse(JSON.stringify(R())); r.ocf = 1.05; return JSON.stringify(Core.compute(r).map(c => c.vm)); }")
        check(await pg.evaluate("R().ocf") == 1.05, 'OCF 1.05 is accepted and stored')
        check(await pg.input_value('#fOCF') == '1.0500', 'OCF is shown to four decimals')
        check(await pg.evaluate("JSON.stringify(Core.compute(R()).map(c => c.vm))") == exp, 'OCF 1.05 gives VMs equal to Core')

        # ---- OM (Route editor): blank, x.xx, x.xx/0.00, or /0.00; anything else is rejected
        await pg.click('#tabs button[data-v=route]')
        k = await pg.evaluate("(() => { const r = R(), C = Core.compute(r); return r.rows.findIndex((x, i) => !C[i].restart && x.om != null); })()")
        check(k >= 0, 'sample has a non-restart row with an OM')
        om = f'#rtEdit [data-i="{k}"][data-k="om"]'
        before = await pg.evaluate("k => { const x = R().rows[k]; return [x.om, x.restart]; }", k)
        await pg.evaluate("$('toast').textContent = ''")
        await enter(pg, om, '5/3')
        check(await pg.text_content('#toast') == MSG_OM, 'OM 5/3 shows the message')
        check(await pg.evaluate("k => { const x = R().rows[k]; return [x.om, x.restart]; }", k) == before, 'OM 5/3 leaves the row OM and Rst unchanged')
        check(await pg.input_value(om) == f'{before[0]:.2f}', 'OM 5/3 reverts the field')
        await enter(pg, om, 'abc')
        check(await pg.evaluate("k => { const x = R().rows[k]; return [x.om, x.restart]; }", k) == before, 'OM abc leaves the row OM and Rst unchanged')
        for text, exp_om, exp_rst in [('', None, False), ('3.25', 3.25, False), ('4.5/0.00', 4.5, True), ('/0.00', 0, True)]:
            await enter(pg, f'#rtEdit [data-i="{k}"][data-k="om"]', text)
            got = await pg.evaluate("k => { const x = R().rows[k]; return [x.om, x.restart]; }", k)
            check(got[0] == exp_om and (got[1] or False) == exp_rst, f'OM {text!r} is accepted: OM {exp_om}, restart {exp_rst} (got {got})')
            await pg.evaluate("k => { const x = R().rows[k]; x.restart = false; renderRoute(); }", k)

        # ---- Speedometer (Run): 1-100 mph; a blank entry is invalid; reload keeps the last valid value
        await pg.click('#tabs button[data-v=run]')
        sp = '#fSpeedo'
        for bad in ['', '0', '101', 'abc']:
            before_val, before = await pg.input_value(sp), await pg.evaluate("R().speedo")
            await pg.evaluate("$('toast').textContent = ''")
            await pg.fill(sp, bad); await pg.press(sp, 'Enter')
            check(await pg.text_content('#toast') == MSG_SPEEDO, f'speedometer {bad!r} shows the message')
            check(await pg.input_value(sp) == before_val and await pg.evaluate("R().speedo") == before, f'speedometer {bad!r} reverts and the stored value is unchanged')
        await pg.fill(sp, '42'); await pg.press(sp, 'Enter')
        check(await pg.evaluate("R().speedo") == 42, 'speedometer 42 is accepted')
        await pg.fill(sp, ''); await pg.press(sp, 'Enter')
        await pg.reload(); await pg.click('#tabs button[data-v=run]')
        check(await pg.input_value(sp) == '42', 'after a reload the speedometer shows the last valid value')
        await b.close()

run(main)
