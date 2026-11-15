# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Route Table app for SCCA Monte Carlo–style (TDS) road rallies. It is a single-page, offline-capable PWA written in plain JavaScript, with no framework, no npm dependencies and no bundler. It builds a route table from photos of Route Instruction pages, which are read by Claude. It then computes VM (vehicle miles) and TT (target time), and estimates TT for rows that have no CZT. `docs/DESIGN.md` is the authoritative spec for behavior. Read it before changing any computation or Run-screen behavior.

## Commands

```sh
python3 build.py              # build dist/ (required before any e2e test)
node test/core.test.js        # unit tests for src/core.js (this is all CI runs)
python3 test/e2e/e2e6.py      # one browser test (Playwright, Python); needs dist/ built
python3 test/e2e/pwa.py       # offline cache, update prompt, API-key reading (serves dist/ on :8765)
test/run-all.sh               # build + unit tests + every e2e script; stops at first failure
```

- There is no lint step and no package.json.
- The unit tests are a single assert script. To run a subset, comment out sections or run snippets with `node -e "const Core=require('./src/core.js'); ..."`.
- The e2e scripts mostly **print** results (and `ERRORS [...]` for page errors) and do not assert. Read their output to judge pass or fail. Screenshots go to `/tmp/rally-e2e/`.
- The e2e scripts hardcode `/usr/bin/google-chrome` and `/tmp`, so they assume Linux. On Windows, change `executable_path`/`CHROME` (or drop it to use Playwright's bundled Chromium), and use `python` if `python3` is not on PATH.
- `tools/make_icons.py` (needs Pillow) regenerates `web/icons/*.png`. The PNGs are committed, so it rarely needs to run.

## Rules for every change

- When behavior changes, update `docs/DESIGN.md` in the same change.
- Every change to `src/core.js` computation gets a unit test in `test/core.test.js`.
- Before finishing a change: `python3 build.py && node test/core.test.js`, plus the relevant e2e script (`pwa.py` for anything touching install, offline, or API reading; `e2e6.py` for the Run screen).
- Never commit API keys. The Anthropic key lives only in each device's localStorage.

## Privacy and information protection
- This is a public repo. Test fixtures and the sample rally use the invented crew "Jane Driver" / "John Navigator"; never put real names, private claude.ai links, or real Route Instruction photos in the repo. The public Pages URL (`bigbaaadbob.github.io/rally-monte-style`) is allowed.

## Architecture

**Build = inlining.** `build.py` replaces the `/*CORE*/`, `/*SAMPLE*/` and `/*APP*/` placeholders in `src/app.html` with the contents of `src/core.js`, `src/sample.js` and `src/app.js`. The result is one self-contained `dist/index.html`. The build also:
- stamps a version (`UTC timestamp-gitsha`) into `__APP_VERSION__` (a meta tag, shown on the Data tab) and `__VERSION__` in `sw.js`
- fills `__ASSETS__` in `web/sw.js` with the list of cached files
- copies the manifest and icons into `dist/`

Source files must never contain `</script` (the build asserts this). Edit `src/` and `web/`, never `dist/` (it is gitignored and wiped on each build).

**Core vs. UI split.**
- `src/core.js` holds pure computation, with no DOM and no clock: time parsing and formatting, `normRow`, `mergeRows` (merge by RI and sort, keeping completion state), `compute` (legs, restarts, VM, TT, TA, estimates, close rows), CSV, and `parseOCR` (extracting JSON rows from model replies). It is a UMD-style IIFE: it exports via `module.exports` for Node tests, or sets `window.Core` in the browser. Keep it free of side effects so `test/core.test.js` can `require` it.
- `src/sample.js` is the invented "Desert Loop" rally, used by the unit tests and by the app's sample button. It uses the same dual export pattern.
- `src/app.js` is the whole UI: tabs (Rallies, Route, Run, Data), modals, and storage. `R()` returns the current rally.

**Computation rules that are easy to break** (see DESIGN.md "Computation"):
- A restart (OM printed `x.xx/0.00`) starts a new leg at VM 0 and TA 0. The first row is *not* forced to be a restart. Rows before the first restart form their own leg (`leg: null`).
- TA is stored as events `{ri, ta, at}`. Each event applies from its row through the end of the leg, and a later event in the same leg overrides it.
- Estimated TT = TT of the nearest earlier row with a TT in the same leg + ΔVM ÷ speedometer mph. An estimate locks only when its row is completed.
- No system clock or sensor value feeds any computation. Timestamps are only logged.

**Two runtime hosts, one file.** The same `dist/index.html` runs:
1. **Standalone (GitHub Pages, installable PWA).** Pages are read by calling `https://api.anthropic.com/v1/messages` directly from the browser, using the user's own API key (localStorage `rallyRT.apikey`, never exported). The model picker lists Sonnet 5.5 (default), Haiku 5.5 and Opus 5.5. `web/sw.js` serves the app's own origin cache-first and never intercepts cross-origin requests. A new version waits and is applied only when the user taps Reload (`skipWaiting` message). The app must never reload by itself.
2. **As a claude.ai artifact.** The app detects `window.claude.use`. It then uses the `sample` capability to read pages and the `db` capability for account copies (`data/users/<id>/<rallyId>`). The service worker is not registered in this mode. Account copies arrive deeply frozen and must be deep-copied before mutation. `test/e2e/mock.py` mocks this runtime.

**Storage.** The whole app state is in localStorage under `rallyRT.v1` (`{rallies, cur, prefs}`) and is saved after every change. Export formats are CSV, re-importable JSON, and an offline HTML copy. The offline copy strips CSP meta tags and scripts injected by the host.

**UI constraints from DESIGN.md.** The Run screen must keep the user's scroll position through every change. It scrolls only when Complete is pressed. Layouts are tested at 390 and 360 px portrait and 844 px landscape.

## CI / deploy

`.github/workflows/pages.yml` runs on every push to `main`. It runs `python3 build.py` and `node test/core.test.js`, and deploys `dist/` to GitHub Pages only if both pass. CI does not run the e2e tests, so run them locally when you change the UI, the service worker or the API-reading path.
