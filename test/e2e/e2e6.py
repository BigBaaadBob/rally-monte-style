"""Run screen: computation display and scroll logic (390 px portrait), plus scroll, columns, and first-visit placement at every supported layout.
Run from the repo root after a build:
  Windows:    .venv/Scripts/python build.py && .venv/Scripts/python test/e2e/e2e6.py
  Linux/WSL:  .venv/bin/python build.py && .venv/bin/python test/e2e/e2e6.py
Exits 1 if any check fails or an unexpected page error is captured."""
from _common import APP_URL, OUT_DIR, LAYOUTS, WIDE_PORTRAIT, wide_run_layout, launch_browser, check, capture_errors, run
from playwright.async_api import async_playwright

START_SPEEDO = 35          # DESIGN "Computation": a new rally starts at 35 mph

# TT column vs Core (DESIGN § Computation): a row with a CZT shows TT, one without shows an estimate (italic ≈) when an earlier TT exists in its leg.
TT_COLUMN = """(() => {
  const C = Core.compute(R()), bad = []; let est = 0;
  document.querySelectorAll('#runTbl tbody tr').forEach((tr, i) => {
    const c = C[i], want = c.tt != null ? fmtT(c.tt) + (c.taSet ? 'TA' : '') : (c.est != null ? '≈' + fmtT(c.est) : '');
    const got = tr.querySelector('td.tt').textContent.trim(); if (c.tt == null && c.est != null) est++;
    if (got !== want) bad.push({i, got, want});
  });
  return {bad, est};
})()"""

# DESIGN § Computation (Close rows): the active card shows "NEXT IN x.xx" when the gap to the next RI is within the close limit.
NEXT_IN = """(() => {
  const a = Core.activeIndex(R()); if (a < 0) return null;
  const c = Core.compute(R())[a], lim = Core.closeMi(R());
  const want = c.gapNext != null && c.gapNext <= lim + 1e-9 ? 'NEXT IN ' + c.gapNext.toFixed(2) : null;
  const el = document.querySelector('.active-card .ac-head .badge.close');
  return {ri: R().rows[a].ri, want, got: el ? el.textContent.trim() : null};
})()"""

# Where the active row sits: its top relative to the list's top, the sticky header height, the row height.
ACTIVE_POS = """(() => {
  const w = document.getElementById('runWrap'), tr = w.querySelector('tr.active');
  return {ri: tr.children[1].textContent.trim(), scroll: w.scrollTop, rel: tr.getBoundingClientRect().top - w.getBoundingClientRect().top,
          head: w.querySelector('thead').offsetHeight, h: tr.offsetHeight, prev: tr.previousElementSibling ? tr.previousElementSibling.offsetHeight : 0, atEnd: w.scrollTop >= w.scrollHeight - w.clientHeight - 1};
})()"""

# Pick rows by property: a completed row with a locked estimate, and an open row whose estimate moves when the speedometer changes.
PICK_EST = """(() => {
  const r = R(), C = Core.compute(r), alt = Core.compute({...r, speedo: (+r.speedo || 0) + 15});
  const lockedIdx = r.rows.findIndex((x, i) => x.done && x.czt == null && C[i].estLocked && x.estLock != null);
  const openIdx = r.rows.findIndex((x, i) => !x.done && x.czt == null && C[i].estLive != null && fmtT(alt[i].estLive) !== fmtT(C[i].estLive));
  return {lockedIdx, openIdx};
})()"""

def near_top(pos):
    lo, hi = pos['head'] + pos['prev'] / 2, pos['head'] + pos['prev'] * 1.5     # header + the one row above (its own height), +/- half a row
    return lo <= pos['rel'] <= hi if not pos['atEnd'] else pos['rel'] >= lo


async def scroll_checks(pg, tag):
    sc = lambda: pg.evaluate("document.getElementById('runWrap').scrollTop")
    # DESIGN § Run controls (Scrolling): the list keeps its scroll position through every change.
    await pg.evaluate("document.getElementById('runWrap').scrollTop = 400"); await pg.wait_for_timeout(100)
    s0 = await sc()
    check(s0 > 0, f'{tag}: the list is long enough to scroll (scrollTop {s0})')
    await pg.click('#btnTA'); await pg.click('[data-st="15"]'); await pg.click('#mOk'); await pg.wait_for_timeout(100)
    check(await sc() == s0, f'{tag}: scroll is kept after a TA change ({s0})')
    await pg.click('[data-sp="5"]'); await pg.wait_for_timeout(100)
    check(await sc() == s0, f'{tag}: scroll is kept after a speedometer change ({s0})')

    # DESIGN § Run controls (Scrolling): Complete scrolls so the new active RI sits near the top with one row above it.
    await pg.click('#btnDone'); await pg.wait_for_timeout(600)
    pos = await pg.evaluate(ACTIVE_POS)
    check(near_top(pos), f'{tag}: after Complete the active row is near the top with one row above ({pos})')
    for _ in range(5): await pg.click('#btnDone')
    await pg.wait_for_timeout(600)
    pos = await pg.evaluate(ACTIVE_POS)
    want_ri = await pg.evaluate("String(R().rows[Core.activeIndex(R())].ri)")
    check(pos['ri'].startswith(want_ri), f"{tag}: after 6 Completes the active RI is the first uncompleted ({pos['ri']!r} vs {want_ri})")
    check(near_top(pos), f'{tag}: after 6 Completes the active row is near the top with one row above ({pos})')
    before = await sc(); await pg.click('#btnUndo'); await pg.wait_for_timeout(300)
    check(await sc() == before, f'{tag}: Undo keeps the scroll position ({before})')
    await pg.click('#btnDone')


async def main():
    async with async_playwright() as p:
        b = await launch_browser(p)
        ctx = await b.new_context(viewport={'width':390,'height':844}, device_scale_factor=2, has_touch=True, is_mobile=True)
        pg = await ctx.new_page(); capture_errors(pg)
        await pg.goto(APP_URL); await pg.evaluate('localStorage.clear()'); await pg.reload()
        await pg.click('#btnNewSample')
        await pg.click('#tabs button[data-v=route]')
        async with pg.expect_file_chooser(timeout=3000) as fc:
            await pg.tap('.filebtn.primary')
        check((await fc.value).is_multiple(), 'Add page photos opens a picker that accepts several images')
        await pg.click('#tabs button[data-v=run]')
        check(await pg.input_value('#fSpeedo') == str(START_SPEEDO), f'speedometer starts at {START_SPEEDO}')
        col = await pg.evaluate(TT_COLUMN)
        check(not col['bad'], f"every TT cell matches Core.compute ({col['bad'][:3]})")
        check(col['est'] > 0, 'the sample has rows without a CZT that show an estimate (so the TT check is not vacuous)')
        print('card', (await pg.inner_text('.ac-nums')).replace('\n',' | '))

        sc = lambda: pg.evaluate("document.getElementById('runWrap').scrollTop")
        await scroll_checks(pg, '390 portrait (390x844)')

        # #40: tapping a ✓ does nothing; Undo picks the last completed RI in RI order, not the latest completion time.
        nd = await pg.evaluate('R().rows.filter(x => x.done).length')
        await pg.click('#runTbl tr.done td.chk span', force=True); await pg.wait_for_timeout(200)
        check(not await pg.evaluate("$('modal').classList.contains('on')"), 'tapping a ✓ opens no dialog')
        check(await pg.evaluate('R().rows.filter(x => x.done).length') == nd, 'tapping a ✓ leaves the row complete')
        await pg.evaluate("(() => { const r = R(); r.rows[0].doneAt = Date.now() + 1e9; save(r); })()")      # first RI now has the latest time
        want = await pg.evaluate("(() => { const r = R(); let k = -1; r.rows.forEach((x, i) => { if (x.done && (k < 0 || Core.cmpRI(x.ri, r.rows[k].ri) >= 0)) k = i; }); return k; })()")
        await pg.click('#btnUndo'); await pg.wait_for_timeout(300)
        check(await pg.evaluate('R().rows.filter(x => x.done).length') == nd - 1 and not await pg.evaluate(f'R().rows[{want}].done') and await pg.evaluate('R().rows[0].done'),
              f'Undo un-completes the last RI in RI order (row {want}), not the one completed most recently')
        await pg.click('#btnDone')

        # DESIGN § Computation (estimates): a completed row keeps its locked estimate when the speedometer changes; an open row's estimate follows it.
        pick = await pg.evaluate(PICK_EST)
        check(pick['lockedIdx'] >= 0 and pick['openIdx'] >= 0, f'found a completed no-CZT row and an open no-CZT row whose estimate moves ({pick})')
        cell = lambda i: pg.inner_text(f'#runTbl tr[data-i="{i}"] td.tt')
        locked0, open0 = await cell(pick['lockedIdx']), await cell(pick['openIdx'])
        for _ in range(3): await pg.click('[data-sp="5"]')
        locked1, open1 = await cell(pick['lockedIdx']), await cell(pick['openIdx'])
        open_want = await pg.evaluate("i => { const e = Core.compute(R())[i].est; return '≈' + fmtT(e); }", pick['openIdx'])
        check(locked1 == locked0, f'completed row {pick["lockedIdx"]} keeps its estimate ({locked0} -> {locked1})')
        check(open1 == open_want and open1 != open0, f'open row {pick["openIdx"]} follows the speedometer ({open0} -> {open1}, Core says {open_want})')
        await pg.screenshot(path=str(OUT_DIR / '21-run.png'))

        # DESIGN § Storage: the speedometer is saved with the rally; locked estimates survive a reload.
        speedo = await pg.evaluate('R().speedo')
        await pg.reload(); await pg.click('#tabs button[data-v=run]')
        check(await pg.input_value('#fSpeedo') == str(speedo), f'speedometer survives a reload ({speedo})')
        check(await cell(pick['lockedIdx']) == locked0, 'the locked estimate survives a reload')

        # DESIGN § Computation (Close rows): NEXT IN appears exactly when the gap is within the close limit. Sweep every active row.
        while await pg.evaluate('R().rows.some(x => x.done)'): await pg.click('#btnUndo')     # start again from the first row
        bad, seen = [], 0
        for _ in range(60):
            n = await pg.evaluate(NEXT_IN)
            if n is None: break
            seen += n['want'] is not None
            if n['got'] != n['want']: bad.append(n)
            await pg.click('#btnDone')
        check(not bad, f'NEXT IN on the active card matches Core.compute for every row ({bad[:3]})')
        check(seen > 0, 'at least one active row has a gap within the close limit (so the NEXT IN check is not vacuous)')

        # DESIGN § Run controls (Scrolling): each rally keeps its own scroll position, in memory only; a rally's Run tab
        # places its active RI near the top (one row above) the first time it is shown in a session; no active RI -> top.
        goto_run = lambda rid: pg.evaluate("id => { store.cur = id; show('run'); }", rid)
        idA = await pg.evaluate('R().id')                      # all Route Instructions complete after the sweep above
        await pg.reload(); await pg.click('#tabs button[data-v=run]'); await pg.wait_for_timeout(300)
        check(await pg.evaluate('Core.activeIndex(R())') < 0, 'rally A has no active RI')
        check(await sc() == 0, 'first visit to a rally with no active RI starts at the top')
        await pg.click('#tabs button[data-v=rallies]'); await pg.click('#btnNewSample')
        idB = await pg.evaluate('R().id'); check(idB != idA, 'a second rally was created from the sample')
        await pg.click('#tabs button[data-v=run]'); await pg.wait_for_timeout(300)
        # complete rows through the first restart (by property), so the active RI is not the first row
        for _ in range(80):
            if await pg.evaluate("(() => { const a = Core.activeIndex(R()); return a > 0 && Core.compute(R())[a].restart; })()"): break
            await pg.click('#btnDone')
        await pg.wait_for_timeout(600)
        check(await pg.evaluate("Core.activeIndex(R()) > 0"), 'rally B has its active RI past the first row')
        await pg.reload(); await pg.click('#tabs button[data-v=run]'); await pg.wait_for_timeout(300)
        pos = await pg.evaluate(ACTIVE_POS)
        want_ri = await pg.evaluate("String(R().rows[Core.activeIndex(R())].ri)")
        check(pos['ri'].startswith(want_ri) and pos['scroll'] > 0, f'first visit after a reload shows the active RI ({pos})')
        check(near_top(pos), f'first visit places the active RI near the top with one row above ({pos})')
        await pg.evaluate("document.getElementById('runWrap').scrollTop = 250"); await pg.wait_for_timeout(100)
        offB = await sc()
        await pg.click('#tabs button[data-v=rallies]')
        await goto_run(idA); await pg.wait_for_timeout(300)
        check(await sc() == 0, f'rally A does not inherit rally B\'s offset ({offB}); got {await sc()}')
        await pg.evaluate("document.getElementById('runWrap').scrollTop = 120"); await pg.wait_for_timeout(100)
        offA = await sc()
        check(offA != offB, f'the two rallies now have different offsets ({offA}, {offB})')
        await goto_run(idB); await pg.wait_for_timeout(300)
        check(await sc() == offB, f'rally B restores its offset on return ({offB}); got {await sc()}')
        await goto_run(idA); await pg.wait_for_timeout(300)
        check(await sc() == offA, f'rally A restores its offset on return ({offA}); got {await sc()}')

        # #39: wording. A no-OM row with no CZT that is active says "no OM, so no VM or estimate"; Clear run data lists what it clears.
        await pg.click('#tabs button[data-v=rallies]'); await pg.click('#btnNewSample')
        k = await pg.evaluate("""(() => { const r = R(), C = Core.compute(r);
          const i = r.rows.findIndex((x, j) => j > 0 && x.om != null && x.czt == null && !x.restart);
          if (i >= 0) { r.rows[i].om = null; save(r); } return i; })()""")
        check(k > 0, 'found a row with an OM, no CZT, and no restart (picked by property) to blank')
        await pg.click('#tabs button[data-v=run]')
        for _ in range(80):
            if await pg.evaluate(f'Core.activeIndex(R()) >= {k}'): break
            await pg.click('#btnDone')
        check(await pg.evaluate('Core.activeIndex(R())') == k, 'the blanked row is the active RI')
        sub = await pg.evaluate("[...document.querySelectorAll('.active-card .small.muted')].map(e => e.textContent.trim())")
        check('no OM, so no VM or estimate' in sub, f'active card for a row with no OM and no CZT says why ({sub})')
        check(not any('no earlier TT' in t for t in sub), 'it does not say "no earlier TT in this leg"')
        await pg.click('#tabs button[data-v=data]')
        check((await pg.inner_text('#bResetRun')).strip() == 'Clear run data', 'the reset button is labelled Clear run data')
        await pg.click('#bResetRun')
        # DESIGN § Tabs and settings (Data): Clear run data text; the name comes from the open rally.
        name = await pg.evaluate("R().name || 'this rally'")
        check(await pg.inner_text('#mTitle') == 'Clear run data' and (await pg.inner_text('#mOk')).strip() == 'Clear', 'Clear run data dialog title and OK label')
        body = await pg.inner_text('#mBody')
        check(body == f'Clear the run data for “{name}”? The Route Instructions stay. This cannot be undone.', f'Clear run data dialog text ({body})')
        await pg.click('#mCancel')
        # Layout-sensitive Run-screen checks at every supported layout (DESIGN § Testing), each in a fresh context.
        # The 390 px portrait scroll checks ran above; 360 portrait and 844 landscape run them here. Columns run at all of
        # them plus one wide portrait, which is not a supported layout: it checks that two columns need landscape, not width alone.
        for w, h, label in [*LAYOUTS, WIDE_PORTRAIT]:
            tag = f'{label} ({w}x{h})'
            ctx2 = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2, has_touch=True, is_mobile=True)
            q = await ctx2.new_page(); capture_errors(q, label=tag)
            await q.goto(APP_URL); await q.evaluate('localStorage.clear()'); await q.reload()
            await q.click('#btnNewSample'); await q.click('#tabs button[data-v=run]'); await q.wait_for_timeout(300)
            # DESIGN § Run controls (Run layout): landscape at 640 px or wider -> two columns and the CP column; otherwise one and none.
            want_cols = 2 if wide_run_layout(w, h) else 1
            cols = await q.evaluate("getComputedStyle(document.getElementById('v-run')).gridTemplateColumns.split(' ').filter(x => x !== 'none').length || 1")
            cp = await q.evaluate("(() => { const th = document.querySelector('#runTbl th.col-wide'); return !!th && th.getBoundingClientRect().width > 0; })()")
            check(cols == want_cols, f'{tag}: the Run list uses {want_cols} column(s) (page has {cols})')
            check(cp == (want_cols == 2), f'{tag}: the CP column is {"shown" if want_cols == 2 else "hidden"}')
            if (w, h, label) in LAYOUTS[1:]:
                await scroll_checks(q, tag)
            if (w, h, label) in LAYOUTS:
                # DESIGN § Run controls (Scrolling): a rally's Run tab first shown in a session places the active RI near the top, one row above.
                for _ in range(6): await q.click('#btnDone')
                await q.reload(); await q.click('#tabs button[data-v=run]'); await q.wait_for_timeout(400)
                pos = await q.evaluate(ACTIVE_POS)
                want_ri = await q.evaluate("String(R().rows[Core.activeIndex(R())].ri)")
                check(pos['ri'].startswith(want_ri) and near_top(pos), f'{tag}: first visit places the active RI near the top with one row above ({pos})')
                await q.screenshot(path=str(OUT_DIR / f'21-run-{w}x{h}.png'))
            await ctx2.close()
        await b.close()
run(main)
