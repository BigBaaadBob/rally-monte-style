# Rally: Monte Style — design decisions

Moved from the claude.ai "Road Rally" Project. The app was first delivered as a claude.ai artifact; this repository is now the source of truth.

## Scope
- Reads photos of the Route Instruction pages into a table of Route Instructions, merges by RI, and sorts.
- User-visible text calls both the source pages and the app's table Route Instructions; RI means only a single Route Instruction; never Route Table, RT, RIs, or route information.
- Adds VM and TT columns. OM and CZT are hidden on the Run screen.
- Prep: rally name, date, crew (driver, navigator, and passengers), vehicle (free text, optional; Crew and vehicle card; shown only on the set-up form), car number (CN), Class (A, B, C, or D; same line as OCF), OCF (always displayed with four decimals, e.g. 1.0100; the Data summary does too), and the close-RI limit. Internet is allowed.
- New from sample (Rallies tab): each tap creates a new rally from the built-in sample and opens set-up. Name "Sample Rally", today's date, CN 7, Class C, OCF 1.0100, vehicle "Rally Car", crew Jane Driver and John Navigator with no passengers, speedometer at its start value, the default close limit, no TA, nothing completed.
- Run: shows the first uncompleted RI. Small Undo button and a 58 px Complete button; tap a ✓ to un-complete that row. No internet needed.

## Computation
- VM = OM × OCF. A restart (OM printed "x.xx/0.00") starts a new frame at VM 0.
- The first row starts the first leg. Each later restart (OM printed "x.xx/0.00") starts a new leg at VM 0 and TA 0. The first row need not be printed "/0.00", because pages may be read in any order; there is no check or warning on it. There is no separate leg for rows before the first restart: they are in leg 1, with VM = OM × OCF in the printed frame. A leg is identified by the RI of its first row.
- A bare "/0.00" OM is a restart at OM 0.00. This is how a rally's start RI is printed. It is accepted wherever OMs are read: row entry, CSV and JSON paste, and both reading prompts.
- A row with no OM (for example the finish RI) shows no VM, no TT, and no estimate. It is skipped when checking close rows and can be completed like any other row.
- TT = CZT + CN minutes + TA.
- TA (confirmed by the owner): a TA entered on a row applies from that row through the row before the next restart. Rows before it keep their TT, and a restart starts at TA 0. A later TA in the same leg replaces the earlier one from its own row on. The app stores TA as events {ri, ta, at}.
- Estimator (confirmed by the owner): estimated TT = TT of the nearest earlier row in the same leg that has a TT + ΔVM ÷ speedometer mph. ΔVM and the speedometer are both in vehicle units, so the OCF is accounted for.
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
- localStorage keys `rallyRT.v1` and `rallyRT.apikey` keep their legacy names; renaming either requires a migration.
- Rallies saved without Vehicle (in localStorage, JSON files, or account copies) load with it empty; there is no migration.
- Export: JSON (full record) is the only round-trip format. CSV is an export-only report (augmented Route Instructions with class, close limit, and estimate lock status); its details block includes a Vehicle line after the crew lines, written even when empty. There is also an offline HTML copy.

## Getting the Route Instructions in
- Inside Claude: Add page photos → Read. The artifact `sample` capability reads one page per call.
- Standalone copy: needs an Anthropic API key (Data tab). With no key, Read explains this. API errors say whether the network or the key failed.
- Offline copy: strips any security-policy meta tags and scripts injected by the hosting viewer from the downloaded HTML, so the standalone copy can reach the API.
- Read in a Claude chat… (for the Claude Android app, where the photo picker does nothing in artifacts): copy the instructions, attach the photos in a normal Claude chat, then paste Claude's whole reply into Paste rows. The JSON is extracted from the reply even with surrounding prose and [brackets] in instruction text, and several fenced blocks are combined. Paste rows also accepts CSV.
- A copied photo can be pasted on the Route tab where the device allows it.
- Add page photos opens a picker that accepts several images at once, so a whole rally can be added in one go.
- Paste rows also accepts a CSV exported by the app: it skips the rally details (including the Vehicle line) above the `RI,…` header line, reads the RI, OM (a `x.xx/0.00` or bare `/0.00` OM marks a restart), CZT, CP, Instruction, and Info columns by header name, and ignores the computed columns. Completion marks and TA entries are not restored; the JSON export is the full record.
- Paste rows with no rows found shows "No rows found in that text", keeps the dialog open, and leaves the table unchanged.

## Testing
- The core is pure (no DOM, no clock) and is unit-tested under Node.
- Playwright runs at 390 and 360 px portrait and 844 px landscape. These are the supported layouts.
- A mock of the Claude runtime (frozen db snapshots plus a sample reader) covers the account-copy and photo-merge path.
- The tests use the built-in invented sample rally, "Sample Rally" (`src/sample.js`).
- The offline copy's stripping of security-policy meta tags and injected scripts is verified against a simulated injected CSP.

## Hosting and install
- App name: `Rally: Monte Style` (manifest `name` and page title); `short_name`: `Monte Style`.
- Hosted on GitHub Pages at https://bigbaaadbob.github.io/rally-monte-style/. Every push to `main` builds, runs the unit tests, and publishes only if they pass (`.github/workflows/pages.yml`).
- Installable web app: `manifest.webmanifest` (standalone display, icons) and `sw.js`.
- `sw.js` caches the app's own files, so the installed app opens and reloads with no signal. Requests to other sites (the Anthropic API) are never intercepted.
- Each build stamps a version into `sw.js` and the page (shown on the Data tab).
- Updates: when a new version is published, the app shows "A new version of the app is ready — Reload". It never reloads by itself, including on first install, so a rally in progress is never interrupted.
- The Rallies tab shows install steps when the app is opened in a browser rather than installed: the Android Install button when Chrome offers one, and Share → Add to Home Screen on iPhone/iPad, with a note that the installed app's storage is separate from Safari's.
- The same `dist/index.html` still works as a claude.ai artifact (no offline cache there; Claude's own reader is used).

## Reading pages
- Outside claude.ai, pages are read with the user's Anthropic API key, entered on the Route tab and stored only in that device's local storage. It is never exported or committed. The Data tab can remove it. Only a key that starts with `sk-ant-` is saved; any other entry is rejected with a message and nothing is stored.
- Model picker (saved per device): Sonnet 5.5 (default, about 2¢/page), Haiku 5.5 (about 0.1¢/page), Opus 5.5 (about 7¢/page). Estimates use Nov 2026 list prices and an image of about 3,900 tokens at 2,000 px.
- Each page thumbnail shows which model read it, and offers "Re-read: Opus" for a page that needs a second look. Re-reading merges by RI, replacing that page's rows.
- Errors name the cause: no network, key rejected (401), refused (402/403: credit or model access), or reply cut off.
- Open item: run a full 18-page rally through all three models once and compare against the paper.
