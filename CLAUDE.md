# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Rally: Monte Style is a single-page, offline-capable PWA for SCCA Monte Carlo–style (TDS) road rallies. It reads photos of Route Instruction pages into a table of Route Instructions. The pages are read by Claude, through the Anthropic API with the user's own key. The app is written in plain JavaScript, with no framework, no npm dependencies and no bundler. It then computes VM (vehicle miles) and TT (target time), and estimates TT for rows that have no CZT. `docs/DESIGN.md` is the authoritative spec for behavior. Read it before changing any computation or Run-screen behavior.

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
node test/core.test.js                     # unit tests for src/core.js
node test/vision.test.js                   # unit tests for src/vision.js (band finding, sign graphics); CI runs it too
.venv/Scripts/python test/e2e/e2e6.py      # one browser test (Playwright); needs dist/ built
.venv/Scripts/python test/e2e/pwa.py       # serves dist/ on 127.0.0.1:8765
.venv/Scripts/python test/run_all.py       # build + unit tests + every e2e script; stops at first failure
```

- The unit tests are plain assert scripts (`test/synth.js` draws and photographs the synthetic page for the vision tests). To run a subset, comment out sections or run snippets with `node -e "const Core=require('./src/core.js'); ..."`.
- Each e2e script exits 1 when a check fails or an unexpected page error is captured, so `run_all.py` stops at the first real failure. In `test/e2e/_common.py`: `check(cond, msg)` records a pass or fail and never raises; `capture_errors(page, allow=())` records `pageerror` and console-error messages for a page (call it for every page); `run(main)` replaces `asyncio.run`, counts unallowlisted errors as failures, prints `<script>: N checks, M failed`, and sets the exit code. Setup failures (server, navigation, selector timeout) raise. Take expected values from `docs/DESIGN.md` rules or compute them in the page with `Core`, never from current output, and avoid sample-specific RI numbers.
- `ALLOW` in `_common.py` is a list of `(kind, regex, reason)` entries (`kind` is `pageerror` or `console`) for known, harmless messages. It starts empty. Add an entry only for a message seen in a real run, with a reason; a `pageerror` entry also needs a justification in the PR. Screenshots and a few informational prints remain prints. Screenshots go to `test/e2e/out/` (gitignored).
- `test/e2e/_common.py` is shared by the e2e scripts; `test/e2e/page.png` is a committed fixture image that they upload.
- `run_all.py` runs the build, both unit-test scripts, and these e2e scripts, in this order (each needs `dist/` built). Supported layouts (DESIGN § Testing): 390x844 and 360x780 portrait, and 844x390 landscape. Logic checks run at 390x844 only unless noted.
  - `e2e5.py`: Run screen Time Allowance dialog, entry rules, and speedometer (390 only). At all three layouts: the TA and speedometer strip, the active card with Complete and Undo, and full screen (header and tabs hidden, ✕ exits).
  - `e2e6.py`: Run screen TT and estimate display, NEXT IN, locked estimates, Undo order, and per-rally scroll (390 only). At all three layouts: scroll kept through changes, Complete placing the active RI near the top, and first-visit placement. Also asserts the Run list's columns (two with the CP column in landscape at 640 px or wider, else one with no CP) at the three layouts and at a 768x1024 wide portrait, which is not a supported layout and only checks that two columns need landscape. Use it for any Run-screen change.
  - `e2e7.py`: Route screen paste and CSV import, Read without an API key, and no offline-copy button (390 only).
  - `pwa.py`: offline cache, update prompt, and API-key reading (photo read, merge by RI, rally switch during a read) with the Anthropic API mocked (390 only). Use it for anything touching install, offline, or API reading.
  - `validation.py`: entry validation for CN, close-RI limit, OCF, OM, and the speedometer (390 only).
  - `images.py`: page and sign images (issues #6 and #66) with the reader mocked and a synthetic ruled page with drawn signs, drawn in the browser: bands and `src`, page copy and sign images in IndexedDB (sign crops cut from the original, larger than the copy), inline sign images, images after the text when the counts differ, and placeholders on Route and Run at all three layouts, the Page control, tap to expand, upside-down and sideways pages, Data line (size includes the signs), the lifecycle (edit, Delete row, Clear, Re-read, JSON import, Duplicate, Delete rally), both failure paths, the nine orientation fixtures (`o1`–`o8` carry EXIF orientation 1–8, plus `o6`'s sideways pixels with tag 1; Pillow writes them at test time from one upright page above the page-copy size; `o1` is the reference and crops must match within a pixel tolerance, checked against mirrored and turned copies), and the `no sign images found` flag (390 only except the layout checks).
  - `vehicle.py`: the Vehicle field on the set-up form. At all three layouts: its placement below Passengers and its width. At 390 only: persistence, the JSON round trip, old files, and CSV.
- The guard test is at the end of `test/core.test.js`: it reads `dist/index.html` (run `build.py` first) and fails if it contains a removed claude.ai runtime identifier. CI builds before the unit tests, so it gates the Pages deploy.
- CI (`.github/workflows/pages.yml`) runs only `python3 build.py`, `node test/core.test.js`, and `node test/vision.test.js`. It does not run the e2e tests.

### Real-document evaluation

Rule:

- Claude Code may run its code locally against the owner's private evaluation set (location given by the owner in the session, outside the repo), working from numbers and viewing its own scratch output when needed. Nothing from those files, or derived from them, goes into the repo, a commit, the PR, or an issue. The PR reports results by page number only.
- Evaluate the shipped code through the app's own path in Chromium (`createImageBitmap` with `from-image`, the canvas downscale, the pre-pass, `src/vision.js` including `signCrops`), never a prototype or a harness that decodes or resamples differently.
- Desktop Chromium can differ from devices and Firefox, so the Firefox branch check and the device check after merge stay the final gates.

Method:

- Record real reader replies once on `main` and replay them for both the before and the after runs, so the reader is held constant.
- Recorded replies are valid only for the OCR prompt and sent image they were recorded with. Any change to either (for example #69's prompt change) means re-recording before the next evaluation.
- Also run a mock-tag run (3 tags per row). Mock replies carry each page's recorded rotation; a mock with rotation 0 on an upside-down photo once produced a false 0/5.
- Score sign images against the private ground truth (graphics per row position, counts only) as hits and false positives.
- Per page, report the column and row rule counts (see Rule counts below), bands by `src`, the flags, and sign hits and false positives.
- Time each page in desktop Chromium, unthrottled and at 4× CPU throttle, and measure peak memory per page.
- Convert tablet HEIC photos to upright JPEGs first, as Safari does.
- "Before" is `main`, rebuilt and measured in the same session on the same machine, never stored numbers from an earlier run. This file states how to measure, not limits; limits come from each brief.

Rule counts:

- Reported counts are the column and row rule counts after `gridOf` (the rules kept as the table's grid), given separately for pass 1 and pass 2, each labelled.
- Pass 1 is the rules found on the page as photographed (after the orientation turns), which set the table frame. The sideways pre-pass (`needsTurn`) is separate and is not pass 1. Pass 2 is the rules found again in the perspective-corrected table (DESIGN.md § Page images, finding the table). When pass 2 does not run (too few rules for a frame, or no correction), it is reported as "not run", never as 0.
- The table's count comes only from the private ground truth for each page, never from any build's output, and never from `gridOf`. The column rule count is columns + 1. The row rule count comes from the page as drawn: every ruled line that spans the table within its outer column rules, which is rows + 2 (the rule above the headings, the rule below them, and one below each row) plus each further ruled line of a box above the headings or below the table (a box edge that is already one of those rules is not counted twice). The private ground truth records the count per page. This file gives the definition only, with no counts, page numbers, or other values from the set.
- Matching counts do not show that the table frame is unchanged. A frame comparison, where a brief needs one, is separate.
- When a page's ground truth is unconfirmed, its counts are reported, but "above the table's count" cannot stop the work there; Claude Code reports it as unconfirmed instead. "Further below `main`" and "pass 2 not run" still apply, since they compare two builds.
- Raw `rulesOf` counts (the candidate rules) are optional. When a change touches rule finding itself (threshold, line test, or stroke joining), they are required for both passes, labelled raw. Raw counts are never used to judge better or worse.

Stop on worse (default): if any page is worse than the baseline, or a limit set by the brief is hit, Claude Code stops and reports by page number for the owner's decision. It does not weigh trade-offs on its own. Claude Code never changes a threshold unless the brief says to. Worse means fewer hits, more false positives, or changed bands or flags than the baseline, or a worse rule count. A rule count is worse, for columns or rows, in either pass, when:

- it is above the table's count;
- it is further below the table's count than `main`'s count from the same session (a count that is below the table's count on `main` and no further below after the change is reported, not worse);
- pass 2 is "not run" on a page where `main` ran it.

Unconfirmed failures: a failure seen only through a mock or a harness is a hypothesis. Report it as unconfirmed until it is checked on recorded real replies, and build no issue on it before then.

Harness: the evaluation harness is kept with the evaluation set outside the repo, its location is given in the session, and it is never copied into the repo. Before reuse, check it against current `main`: its paths, that its truth counts are in step with the ground truth, and that it drives the built app rather than decoding or resampling on its own.

Evaluation key: the owner sets `RALLY_EVAL_API_KEY` for the recording session only, never `ANTHROPIC_API_KEY` (Claude Code uses it for its own sign-in). The harness reads it in record mode only, and the owner removes it after recording. Claude Code checks that it is set by printing its length, never its value. It never appears in a file, log, recorded reply, or output.

## Rules for every change

- When behavior changes, update `docs/DESIGN.md` in the same change.
- Every change to `src/core.js` computation gets a unit test in `test/core.test.js`.
- Before finishing a change, run the tests: all of them via `run_all.py`, or at least the unit tests plus the relevant e2e script. See `## Testing` for which script covers what.
- Never commit, log, print, or write an API key anywhere. In the app, the user's Anthropic key lives only in each device's localStorage; for evaluation, see § Testing.

## Workflow

Three project skills in `.claude/skills/` drive the issue-to-merge loop. Each runs only when typed, never automatically.

- `/start-issue <n>`: requires a clean tree, syncs `main`, creates `fix/`, `docs/`, or `feat/` `<n>-<slug>` from the issue's labels, reads the issue and its "Brief for #n" comment, then proposes a plan. No files are edited until the plan is approved.
- `/ship`: confirms `docs/DESIGN.md` changed (or that no design update is needed), runs `test/run_all.py`, scans the staged diff for secrets and personal information, commits design and code separately, asks before pushing, then opens a PR ending in `Closes #n`. CI runs only on `main` after the merge, so the PR has no checks; the local `run_all.py` run is the pre-merge gate. It never merges.
- `/finish`: after the merge, returns to `main`, pulls, deletes the merged local and remote branch (asking before a force delete or a remote delete), and confirms the issue closed.

Merging is done by the owner on GitHub after review.

- Briefs are written in a separate claude.ai chat and posted as an issue comment headed "Brief for #n". This session cannot see that chat; the issue comment is the only hand-off.
- A bug's stated cause in an issue or brief is a hypothesis: reproduce the symptom before fixing, and report it if the cause turns out different.
- Don't push, open pull requests, or switch branches outside these skills unless I ask explicitly. If I ask to push or open a PR, suggest `/ship` instead.
- Never offer `/start-issue`, `/ship`, or `/finish` as a choice or button; they run only when the owner types them, so a button for one always fails. When implementation is done and tests pass, end with a plain line such as "Ready to ship. Type `/ship`." with no multiple-choice question.
- Never offer, suggest, or enable Auto-fix or auto-merge for a PR, and don't ask about them. Fixes to an open PR are made on its branch in a local session and pushed with `/ship`, so the DESIGN.md check, the test run, and the secrets and personal-information scan always apply. Reason: this repo is public, and Auto-fix can be woken by anyone's PR comment.

## Privacy and information protection
- This is a public repo. Test fixtures and the sample rally use the invented crew "Jane Driver" / "John Navigator"; never put real names, private claude.ai links, or real Route Instruction photos in the repo. The public Pages URL (`bigbaaadbob.github.io/rally-monte-style`) is allowed.

## Architecture

**Build = inlining.** `build.py` replaces the `/*CORE*/`, `/*VISION*/`, `/*SAMPLE*/` and `/*APP*/` placeholders in `src/app.html` with the contents of `src/core.js`, `src/vision.js`, `src/sample.js` and `src/app.js`. The result is one self-contained `dist/index.html`. The build also:
- stamps a version (`UTC timestamp-gitsha`) into `__APP_VERSION__` (a meta tag, shown on the Data tab) and `__VERSION__` in `sw.js`
- fills `__ASSETS__` in `web/sw.js` with the list of cached files
- copies the manifest and icons into `dist/`

Source files must never contain `</script` (the build asserts this). Edit `src/` and `web/`, never `dist/` (it is gitignored and wiped on each build).

**Core vs. UI split.**
- `src/core.js` holds pure computation, with no DOM and no clock: time parsing and formatting, `normRow`, `mergeRows` (merge by RI and sort, keeping completion state), `compute` (legs, restarts, VM, TT, Time Allowance (TA), estimates, close rows), CSV export, `parseCSV` (CSV import), and `parseOCR` (extracting JSON rows from model replies). It is a UMD-style IIFE: it exports via `module.exports` for Node tests, or sets `window.Core` in the browser. Keep it free of side effects so `test/core.test.js` can `require` it.
- `src/vision.js` holds the pure image functions, also with no DOM and no clock: the sideways pre-pass (`needsTurn`), rule finding, the table frame and perspective correction, bands (`analyzePage`), and sign graphics. An image is RGBA `{data, w, h}`. Its thresholds are in one `K` block. It uses the same dual export pattern, so `test/vision.test.js` can `require` it. The app (`src/app.js`) does the canvas work (decoding, encoding, cropping signs from the original) around it.
- `src/sample.js` is the invented "Sample Rally" (`{ rally, rows }`: details and rows), used by the unit tests and by the New from sample button. It uses the same dual export pattern.
- `src/app.js` is the whole UI: tabs (Rallies, Route, Run, Data), modals, and storage. `R()` returns the current rally.

**Computation rules that are easy to break** (see DESIGN.md "Computation"):
- The first row starts leg 1 (it need not be a restart; there is no `leg: null`). Each later restart (OM printed `x.xx/0.00`) starts a new leg at VM 0 and TA 0. A bare `/0.00` is a restart at OM 0.00. A row with no OM has no VM or estimate, shows a TT only if it has a CZT, and is never close.
- TA (Time Allowance) is stored as events `{ri, ta, at}`, with `ta` in whole seconds, never negative (0 to 90:00). Each event applies from its row through the end of the leg, and a later event in the same leg overrides it.
- Estimated TT = TT of the nearest earlier row in the same leg with both a TT and a VM + ΔVM ÷ speedometer mph. An estimate locks only when its row is completed.
- No system clock or sensor value feeds any computation. Timestamps are only logged.

**One runtime host.** `dist/index.html` runs only as a web page (GitHub Pages, installed or in a browser); it is not built or tested as a claude.ai artifact.
Pages are read by calling `https://api.anthropic.com/v1/messages` directly from the browser, using the user's own API key (localStorage `rallyMonteStyle.apikey`, never exported). The model picker lists Sonnet 5.5 (default), Haiku 5.5 and Opus 5.5. `web/sw.js` serves the app's own origin cache-first and never intercepts cross-origin requests. A new version waits and is applied only when the user taps Reload (`skipWaiting` message). The app must never reload by itself.

**Storage.** The whole app state is in localStorage under `rallyMonteStyle.v1` (`{rallies, cur, prefs}`) and is saved after every change. Export formats: CSV (an export-only report; Paste rows reads back its rows), JSON (the only round-trip format). Rallies are stored only on the device.

**UI constraints from DESIGN.md.** The Run screen must keep the user's scroll position through every change. It scrolls only when Complete is pressed. Test layouts: see `docs/DESIGN.md` § Testing.

## CI / deploy

`.github/workflows/pages.yml` runs on every push to `main` and deploys `dist/` to GitHub Pages only if its build and tests pass. What CI runs: see `## Testing`.
