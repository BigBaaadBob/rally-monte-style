# Rally Route Table app — design decisions (v7, 2026-11-11)

Moved from the claude.ai "Road Rally" Project. The app was first delivered as a claude.ai artifact (https://claude.ai/artifact/Qbn4NCJ7cbjtt3MRpB2ho5); this repository is now the source of truth.

## Scope (from Bob)
- Builds the Route Table (RT) from photos of the Route Instruction pages, merges by RI, and sorts.
- Adds VM and TT columns. OM and CZT are hidden on the Run screen.
- Prep: rally name, date, crew (driver, navigator, and passengers), car number (CN), Class (A, B, C, or D; same line as OCF), OCF, and the close-RI limit. Internet is allowed.
- Run: shows the first uncompleted RI. Small Undo button and a 58 px Complete button; tap a ✓ to un-complete that row. No internet needed.

## Computation
- VM = OM × OCF. A restart (OM printed "x.xx/0.00") starts a new frame at VM 0.
- The first row is NOT forced to be a restart, so a test run can start mid-rally. Rows before the first restart use OM × OCF in the printed frame and form their own leg for TA and estimates.
- TT = CZT + CN minutes + TA.
- TA (confirmed by Bob): a TA entered on a row applies from that row through the row before the next restart. Rows before it keep their TT, and a restart starts at TA 0. A later TA in the same leg replaces the earlier one from its own row on. The app stores TA as events {ri, ta, at}.
- Estimator (confirmed by Bob): estimated TT = TT of the nearest earlier row in the same leg that has a TT + ΔVM ÷ speedometer mph. ΔVM and the speedometer are both in vehicle units, so the OCF is accounted for.
- Estimates are always shown (≈, italic) in the TT column of every row without a CZT, wherever an earlier TT exists in the leg. Nothing to tap.
- Locking: an estimate is locked only when its RI is completed; it then ignores later speedometer and TA changes. Un-completing releases it. No lock symbol.
- Speedometer: saved with each rally (reloading keeps it). A new rally starts at 35 mph.
- Close rows: adjacent rows whose VM gap is ≤ the per-rally limit (Setup; default 0.5 vehicle miles) are highlighted in the VM cell. Across a restart the gap runs to the previous frame's end. The active card shows "NEXT IN x.xx".
- No system clock or sensor feeds any computation. Completion timestamps are logged only.

## Run controls
- One strip: a TA button on the left (shows the current TA, highlighted when non-zero) and the speedometer on the right (−5 −1 [mph] +1 +5, limit 1–100 mph).
- TA dialog: a big entry field, ±5, ±15, and ±60 s buttons, and Zero. Changes are pending until Set; Cancel or tapping outside leaves TA unchanged. Limit ±90:00; an invalid entry keeps the dialog open.
- Direct entry: tapping a field selects its value. Enter or Set commits; for the speedometer, tapping away or Esc leaves the value unchanged.
- Full screen (⛶ in the header): asks the browser for full screen where allowed, and always hides the app's header and tabs. A small ✕ (top right) exits.
- Scrolling: the list keeps the user's scroll position through every change. The app scrolls only when Complete is pressed, placing the new active RI near the top with one row above it.

## Storage
- Saved on the device (localStorage) after every change.
- When the page runs inside Claude and is online, a private copy of each rally goes to the artifact db at data/users/<id>/<rallyId>.
- Account copies arrive as frozen objects and are deep-copied when loaded (fix for the iPad "readonly property" error).
- Export: CSV (augmented RT with class, close limit, and estimate lock status) and JSON (full record, re-importable). There is also an offline HTML copy.

## Getting the Route Instructions in
- Inside Claude: Add page photos → Read. The artifact `sample` capability reads one page per call.
- Standalone copy: needs an Anthropic API key (Data tab). With no key, Read explains this. API errors say whether the network or the key failed.
- Offline copy: strips any security-policy meta tags and scripts injected by the hosting viewer from the downloaded HTML, so the standalone copy can reach the API.
- Read in a Claude chat… (for the Claude Android app, where the photo picker does nothing in artifacts): copy the instructions, attach the photos in a normal Claude chat, then paste Claude's whole reply into Paste rows. The JSON is extracted from the reply even with surrounding prose and [brackets] in instruction text, and several fenced blocks are combined. Paste rows also accepts CSV.
- A copied photo can be pasted on the Route tab where the device allows it.

## Testing
- Node unit tests for the core; Playwright runs at 390/360 px portrait and 844 px landscape.
- A mock of the Claude runtime (frozen db snapshots plus a sample reader) covers the account-copy and photo-merge path; a simulated injected CSP checks the offline copy.

## Planned (hosting move, agreed 2026-11-12)
- Host on GitHub Pages as an installable web app (manifest + service worker) so it opens offline on Android, iPhone, and iPad.
- Capture pages with the browser's photo button; read them with the user's Anthropic API key. Default model Sonnet 5.5, selectable, with a "re-read with Opus" option. Run a one-time comparison on a full 18-page rally.
- Open items: validate photo reading on the full 18-page set.
