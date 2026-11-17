# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Rally: Monte Style is a single-page, offline-capable PWA for SCCA Monte Carlo–style (TDS) road rallies. It reads photos of Route Instruction pages into a table of Route Instructions. The pages are read by Claude. The app is written in plain JavaScript, with no framework, no npm dependencies and no bundler. It then computes VM (vehicle miles) and TT (target time), and estimates TT for rows that have no CZT. `docs/DESIGN.md` is the authoritative spec for behavior. Read it before changing any computation or Run-screen behavior.

## Build

Commands use the Windows venv path; on Linux/WSL use `.venv/bin/python`.

```sh
.venv/Scripts/python build.py              # build dist/ (required before any e2e test)
```

- There is no lint step and no package.json.
- `tools/make_icons.py` (needs Pillow) regenerates `web/icons/*.png`. The PNGs are committed, so it rarely needs to run.

## Testing

Python: use the project environment (Python 3.14); never the global python.

- Windows: `py -V:3.14 -m venv .venv`, then `.venv/Scripts/python -m pip install -r requirements-dev.txt` and `.venv/Scripts/python -m playwright install chromium`.
- Linux or WSL: `python3.14 -m venv .venv`, then `.venv/bin/python -m pip install -r requirements-dev.txt` and `.venv/bin/python -m playwright install --with-deps chromium`.

Commands below use the Windows venv path; on Linux/WSL use `.venv/bin/python`. `run_all.py` and every e2e script exit 1 with a version message on any other Python.

```sh
node test/core.test.js                     # unit tests for src/core.js (this is all CI runs)
.venv/Scripts/python test/e2e/e2e6.py      # one browser test (Playwright); needs dist/ built
.venv/Scripts/python test/e2e/pwa.py       # serves dist/ on 127.0.0.1:8765
.venv/Scripts/python test/run_all.py       # build + unit tests + every e2e script; stops at first failure
```

- The unit tests are a single assert script. To run a subset, comment out sections or run snippets with `node -e "const Core=require('./src/core.js'); ..."`.
- Each e2e script exits 1 when a check fails or an unexpected page error is captured, so `run_all.py` stops at the first real failure. In `test/e2e/_common.py`: `check(cond, msg)` records a pass or fail and never raises; `capture_errors(page, allow=())` records `pageerror` and console-error messages for a page (call it for every page); `run(main)` replaces `asyncio.run`, counts unallowlisted errors as failures, prints `<script>: N checks, M failed`, and sets the exit code. Setup failures (server, navigation, selector timeout) raise. Take expected values from `docs/DESIGN.md` rules or compute them in the page with `Core`, never from current output, and avoid sample-specific RI numbers.
- `ALLOW` in `_common.py` is a list of `(kind, regex, reason)` entries (`kind` is `pageerror` or `console`) for known, harmless messages. It starts empty. Add an entry only for a message seen in a real run, with a reason; a `pageerror` entry also needs a justification in the PR. Screenshots and a few informational prints remain prints. Screenshots go to `test/e2e/out/` (gitignored).
- `test/e2e/_common.py` is shared by the e2e scripts; `test/e2e/page.png` is a committed fixture image that they upload.
- Which e2e script covers which change (each needs `dist/` built):
  - `e2e5.py`: Run screen Time Allowance dialog and layouts.
  - `e2e6.py`: Run screen scroll position and layouts. Use it for any Run-screen change.
  - `e2e7.py`: Route screen paste and CSV import, offline copy, and Read without an API key.
  - `pwa.py`: offline cache, update prompt, and API-key reading (Anthropic API mocked). Use it for anything touching install, offline, or API reading.
  - `mock.py`: the claude.ai runtime (see below).
- `mock.py` mocks the claude.ai runtime: the `db` capability returns frozen snapshot data, as the real one does, and the `sample` capability returns canned rows. `add_init_script` installs it with `window.__REMOTE__` (the account copies) before the app loads. It runs like the other scripts and covers the account-copy and photo-merge path.
- The offline-copy CSP check is in `e2e7.py`. An init script (`INJECT`) adds a `<meta http-equiv="Content-Security-Policy" id="fakecsp">` and a script that sets `window.__injected` to the live page's head. The test first checks that both are present in the live page, then reads `SELF_HTML` (the offline copy's source) and asserts it contains neither `fakecsp` nor `__injected`, and that the count of `<script data-rt` in the copy equals the live page's `script[data-rt]` count (the app's own scripts are kept).
- CI (`.github/workflows/pages.yml`) runs only `python3 build.py` and `node test/core.test.js`. It does not run the e2e tests.

## Rules for every change

- When behavior changes, update `docs/DESIGN.md` in the same change.
- Every change to `src/core.js` computation gets a unit test in `test/core.test.js`.
- Before finishing a change, run the tests: all of them via `run_all.py`, or at least the unit tests plus the relevant e2e script. See `## Testing` for which script covers what.
- Never commit API keys. The Anthropic key lives only in each device's localStorage.

## Workflow

Three project skills in `.claude/skills/` drive the issue-to-merge loop. Each runs only when typed, never automatically.

- `/start-issue <n>`: requires a clean tree, syncs `main`, creates `fix/`, `docs/`, or `feat/` `<n>-<slug>` from the issue's labels, reads the issue and its "Brief for #n" comment, then proposes a plan. No files are edited until the plan is approved.
- `/ship`: confirms `docs/DESIGN.md` changed (or that no design update is needed), runs `test/run_all.py`, scans the staged diff for secrets and personal information, commits design and code separately, asks before pushing, then opens a PR ending in `Closes #n`. It never merges.
- `/finish`: after the merge, returns to `main`, pulls, deletes the merged local and remote branch (asking before a force delete or a remote delete), and confirms the issue closed.

Merging is done by the owner on GitHub after review.

- Briefs are written in a separate claude.ai chat and posted as an issue comment headed "Brief for #n". This session cannot see that chat; the issue comment is the only hand-off.
- Don't push, open pull requests, or switch branches outside these skills unless I ask explicitly. If I ask to push or open a PR, suggest `/ship` instead.
- Never offer `/start-issue`, `/ship`, or `/finish` as a choice or button; they run only when the owner types them, so a button for one always fails. When implementation is done and tests pass, end with a plain line such as "Ready to ship. Type `/ship`." with no multiple-choice question.
- Never offer, suggest, or enable Auto-fix or auto-merge for a PR, and don't ask about them. Fixes to an open PR are made on its branch in a local session and pushed with `/ship`, so the DESIGN.md check, the test run, and the secrets and personal-information scan always apply. Reason: this repo is public, and Auto-fix can be woken by anyone's PR comment.

## Privacy and information protection
- This is a public repo. Test fixtures and the sample rally use the invented crew "Jane Driver" / "John Navigator"; never put real names, private claude.ai links, or real Route Instruction photos in the repo. The public Pages URL (`bigbaaadbob.github.io/rally-monte-style`) is allowed.

## Architecture

**Build = inlining.** `build.py` replaces the `/*CORE*/`, `/*SAMPLE*/` and `/*APP*/` placeholders in `src/app.html` with the contents of `src/core.js`, `src/sample.js` and `src/app.js`. The result is one self-contained `dist/index.html`. The build also:
- stamps a version (`UTC timestamp-gitsha`) into `__APP_VERSION__` (a meta tag, shown on the Data tab) and `__VERSION__` in `sw.js`
- fills `__ASSETS__` in `web/sw.js` with the list of cached files
- copies the manifest and icons into `dist/`

Source files must never contain `</script` (the build asserts this). Edit `src/` and `web/`, never `dist/` (it is gitignored and wiped on each build).

**Core vs. UI split.**
- `src/core.js` holds pure computation, with no DOM and no clock: time parsing and formatting, `normRow`, `mergeRows` (merge by RI and sort, keeping completion state), `compute` (legs, restarts, VM, TT, TA, estimates, close rows), CSV export, `parseCSV` (CSV import), and `parseOCR` (extracting JSON rows from model replies). It is a UMD-style IIFE: it exports via `module.exports` for Node tests, or sets `window.Core` in the browser. Keep it free of side effects so `test/core.test.js` can `require` it.
- `src/sample.js` is the invented "Desert Loop" rally, used by the unit tests and by the app's sample button. It uses the same dual export pattern.
- `src/app.js` is the whole UI: tabs (Rallies, Route, Run, Data), modals, and storage. `R()` returns the current rally.

**Computation rules that are easy to break** (see DESIGN.md "Computation"):
- A restart (OM printed `x.xx/0.00`) starts a new leg at VM 0 and TA 0. The first row is *not* forced to be a restart. Rows before the first restart form their own leg (`leg: null`).
- TA is stored as events `{ri, ta, at}`. Each event applies from its row through the end of the leg, and a later event in the same leg overrides it.
- Estimated TT = TT of the nearest earlier row with a TT in the same leg + ΔVM ÷ speedometer mph. An estimate locks only when its row is completed.
- No system clock or sensor value feeds any computation. Timestamps are only logged.

**Two runtime hosts, one file.** The same `dist/index.html` runs:
1. **Standalone (GitHub Pages, installable PWA).** Pages are read by calling `https://api.anthropic.com/v1/messages` directly from the browser, using the user's own API key (localStorage `rallyRT.apikey`, never exported). The model picker lists Sonnet 5.5 (default), Haiku 5.5 and Opus 5.5. `web/sw.js` serves the app's own origin cache-first and never intercepts cross-origin requests. A new version waits and is applied only when the user taps Reload (`skipWaiting` message). The app must never reload by itself.
2. **As a claude.ai artifact.** The app detects `window.claude.use`. It then uses the `sample` capability to read pages and the `db` capability for account copies (`data/users/<id>/<rallyId>`). The service worker is not registered in this mode. Account copies arrive deeply frozen and must be deep-copied before mutation. To test it, see `## Testing`.

**Storage.** The whole app state is in localStorage under `rallyRT.v1` (`{rallies, cur, prefs}`) and is saved after every change. Export formats are CSV, re-importable JSON, and an offline HTML copy. The offline copy strips CSP meta tags and scripts injected by the host.

**UI constraints from DESIGN.md.** The Run screen must keep the user's scroll position through every change. It scrolls only when Complete is pressed. Test layouts: see `docs/DESIGN.md` § Testing.

## CI / deploy

`.github/workflows/pages.yml` runs on every push to `main` and deploys `dist/` to GitHub Pages only if its build and tests pass. What CI runs: see `## Testing`.
