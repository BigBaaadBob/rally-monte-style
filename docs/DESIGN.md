# Rally: Monte Style — design decisions

Moved from the claude.ai "Road Rally" Project. The app was first delivered as a claude.ai artifact; this repository is now the source of truth.

## Scope
- Reads photos of the Route Instruction pages into a table of Route Instructions, merges by RI, and sorts.
- User-visible text calls both the source pages and the app's table Route Instructions; RI means only a single Route Instruction; never Route Table, RT, RIs, or route information.
- Adds VM and TT columns. OM and CZT are hidden on the Run screen.
- Prep: rally name, date, crew (driver, navigator, and passengers), vehicle (free text, optional; Crew and vehicle card; shown only on the set-up form), car number (CN), Class (A, B, C, or D; same line as OCF), OCF (always displayed with four decimals, e.g. 1.0100; the Data summary and the CSV do too), and the close-RI limit. Internet is allowed.
- Setup entry rules (each is checked when the field is committed, by leaving it or pressing Enter; a rejected entry shows its message and the field reverts to its previous value, so nothing is partly applied):
  - CN: blank or a whole number from 0 to 999; blank computes as 0 minutes. Otherwise "Car number must be a whole number from 0 to 999".
  - Close-RI limit: blank or a number from 0 to 5.0 vehicle miles. Blank is stored and shown as the 0.5 default; 0 flags only rows with identical VMs. Otherwise "Close RI limit must be between 0 and 5.0 miles".
  - OCF: a number greater than 0, shown to four decimals. Blank, 0, a negative number, or text is rejected with "OCF must be a positive number.".
- New from sample (Rallies tab): each tap creates a new rally from the built-in sample and opens set-up. Name "Sample Rally", today's date, CN 7, Class C, OCF 1.0100, vehicle "Rally Car", crew Jane Driver and John Navigator with no passengers, speedometer at its start value, the default close limit, no TA, nothing completed.
- Run: shows the first uncompleted RI. Small Undo button and a 58 px Complete button; Undo un-completes the last completed RI in RI order. No internet needed.

## Tabs and settings

**Rallies and navigation**
- The Rallies list shows the newest date first, then the most recently updated. Open goes to Run when the rally has Route Instructions and a name, otherwise to Setup. A rally with no name shows as "Untitled rally".
- Tabs other than Rallies are disabled until a rally is open. The URL hash (`#setup`, `#route`, `#run`, `#data`) selects the tab. At start the app opens Run if the current rally has Route Instructions, otherwise Rallies.

**Setup**
- A new rally starts with today's date, an empty name and CN, OCF 1.0000, the speedometer at 35 mph, and the default close limit.
- Display (saved per device): Time format HH:MM:SS (default) or HH:MM.cc, and Theme Day (default) or Night. The Time format applies to CZT, TT, and estimates on screen and to the CSV time columns.

**Route editor**
- CZT accepts H:MM:SS(.s), H:MM.cc, and H:MM, with hours below 48; displayed times wrap at 24 h. Any other entry shows "CZT format: HH:MM:SS or HH:MM.cc" and reverts.
- An RI can't be blank or duplicate another RI; either shows a message and reverts. RI order is the number, then the suffix (12 < 12A < 13). An RI with no number sorts last.
- Add row gives the new row the next RI (last + 1, or last + "+" for a text RI) and copies the previous row's OM (0 after a restart). The first row added is "/0.00". Delete row and Clear Route Instructions each ask first.
- Flags above the table: an RI with no OM, an OM less than the RI before it (missed restart?), a CZT earlier than the previous CZT, and rows out of order. The first 8 are listed, then "…and n more". Rows from the last read are highlighted.

**Data**
- Clear run data (clears all completion marks, Time Allowances, and estimate locks; the Route Instructions stay), Delete rally (which also deletes the account copy inside Claude), and Remove saved API key each ask first. Duplicate rally adds " (copy)" to the name and makes the copy current.

**Dialogs**
- Tapping outside a dialog closes it without change. Esc closes no dialog; it only cancels a speedometer edit.

## Computation
- VM = OM × OCF.
- The first row starts the first leg. Each later restart (OM printed "x.xx/0.00") starts a new leg at VM 0 and TA 0. The first row need not be printed "/0.00", because pages may be read in any order; there is no check or warning on it. There is no separate leg for rows before the first restart: they are in leg 1, with VM = OM × OCF in the printed frame. A leg is identified by the RI of its first row.
- A bare "/0.00" OM is a restart at OM 0.00. This is how a rally's start RI is printed. It is accepted wherever OMs are read: row entry, CSV paste, and the reading prompt.
- Row entry of an OM accepts only blank, a number (x.xx), a restart (x.xx/0.00), or a bare restart (/0.00). Any other entry, such as 5/3, is rejected with "OM format: x.xx, x.xx/0.00, or /0.00", and the row's OM and Rst stay as they were.
- A row with no OM (for example the finish RI) shows no VM and no estimate, and shows a TT only if it has a CZT. It is skipped when checking close rows and can be completed like any other row. When the active RI has no OM and no CZT, the active card says "no OM, so no VM or estimate".
- TT = CZT + CN minutes + TA.
- TA is the Time Allowance (SCCA term). It is never negative and is stored in whole seconds (0 to 90:00).
- TA (confirmed by the owner): a TA entered on a row applies from that row through the row before the next restart. Rows before it keep their TT, and a restart starts at TA 0. A later TA in the same leg replaces the earlier one from its own row on. The app stores TA as events {ri, ta, at}.
- Renaming an RI moves its TA events to the new RI. Deleting a row removes its TA events; Clear Route Instructions removes all TA events and completion marks.
- Estimator (confirmed by the owner): estimated TT = TT of the nearest earlier row in the same leg that has both a TT and a VM + ΔVM ÷ speedometer mph. A row with a TT but no VM is skipped. A negative ΔVM counts as 0. ΔVM and the speedometer are both in vehicle units, so the OCF is accounted for.
- Estimates are always shown (≈, italic) in the TT column of every row without a CZT, wherever an earlier TT exists in the leg. Nothing to tap.
- Locking: an estimate is locked only when its RI is completed; it then ignores later speedometer and TA changes. Un-completing releases it. No lock symbol.
- Speedometer: saved with each rally (reloading keeps it, and a blank value is never saved or reset on load). A new rally starts at 35 mph.
- Close rows: adjacent rows whose VM gap is ≤ the per-rally limit (Setup; default 0.5 vehicle miles) are highlighted in the VM cell. Across a restart the gap runs to the previous frame's end. The active card shows "NEXT IN x.xx".
- No system clock or sensor feeds any computation. Each RI's completion time is logged for post-event analysis and as a backup record of checkpoint passage if the Richta app misses one. It is exported in the CSV. No logged time feeds VM, TT, TA, Undo, or estimates.

## Run controls
- One strip: a TA button on the left (reads "TA m:ss", for example "TA 0:00" or "TA 1:05"; highlighted when non-zero) and the speedometer on the right (−5 −1 [mph] +1 +5, limit 1–100 mph; a blank entry is invalid, like any value outside 1–100: it shows "Speedometer must be between 1 and 100 mph" and reverts).
- TA dialog, titled "Time Allowance": a big entry field, ±5, ±15, and ±60 s buttons, and Zero. Changes are pending until Set; Cancel or tapping outside leaves TA unchanged. The minus buttons stop at 0:00.
- TA entry: m:ss (seconds 0–59) or bare whole seconds; a leading + is tolerated and a blank entry is 0. A negative entry, decimal minutes, fractional seconds, or seconds of 60 or more in m:ss are rejected with "TA: seconds (90) or m:ss (1:05)" (a negative one says "TA cannot be negative"), and the dialog stays open. The limit is 90:00 ("TA is limited to 90:00"). TA is always shown as m:ss, whatever the Time format; TT, CZT, and estimates follow the Time format.
- Direct entry: tapping a field selects its value. Enter or Set commits; for the speedometer, tapping away or Esc leaves the value unchanged.
- Full screen (⛶ in the header): asks the browser for full screen where allowed, and always hides the app's header and tabs. A small ✕ (top right) exits.
- Scrolling: the list keeps the user's scroll position through every change. The app scrolls only when Complete is pressed, or when a rally's Run tab is first shown in a session; both place the active RI near the top with one row above it. A rally with no active RI (no Route Instructions, or all complete) starts at the top on its first visit. Each rally keeps its own scroll position, in memory only.
- Undo is disabled when nothing is complete. Un-completing shows "RI n marked not complete".
- When every RI is complete, the active card reads "All n Route Instructions complete" with Undo last complete. With no Route Instructions, the Run tab shows "No Route Instructions yet." and a Build it on Route button.
- Run layout: in landscape at 640 px or wider, the Run list uses two columns and shows the CP column; otherwise it uses one column and no CP column.
- The screen is kept awake while the Run tab is shown.
- Leaving the browser's full screen (for example with Esc) also leaves the app's full-screen mode.

## Storage
- Saved on the device (localStorage) after every change.
- When the page runs inside Claude and is online, a private copy of each rally goes to the artifact db at data/users/<id>/<rallyId>.
- Account copies arrive as frozen objects and are deep-copied when loaded (fix for the iPad "readonly property" error).
- localStorage keys are `rallyMonteStyle.v1` (rallies) and `rallyMonteStyle.apikey` (the API key). The earlier `rallyRT.v1` and `rallyRT.apikey` keys are deleted unread on load; there is no migration.
- Rallies saved without Vehicle (in localStorage, JSON files, or account copies) load with it empty; there is no migration.
- Export: JSON (full record) is the only round-trip format. CSV is an export-only report (augmented Route Instructions with class, close limit, and estimate lock status); its details block includes a Vehicle line after the crew lines, written even when empty. There is also an offline HTML copy.
- If the browser refuses to save on the device, a banner says so.
- Account copies: the copy with the newer `updated` stamp wins; rallies only on the device are pushed; deleting a rally deletes its account copy.
- JSON export is `{app: 'rally-monte-style', version: 1, rally: {…}}`. Import accepts this or a bare rally object, always creates a new rally with a new id and makes it current, and adds " (imported)" to the name when that id already exists. A file that isn't a rally JSON export is rejected with a message.
- CSV format: details lines Rally, Date, Driver, Navigator, Passengers ("; " separated), Vehicle, Car number, Class, OCF, Close RI limit (mi), and Speedometer (est.), with OCF written to four decimals (e.g. 1.0100); a blank line; then the columns RI, Restart, OM, VM, CZT, TA (s, whole seconds), TA entered here, TT, Est TT, Est locked, Done, Done at, CP, Instruction, and Info. A restart's OM is written x.xx/0.00 and its VM prev/0.00. Time columns follow the Time format setting.
- Exports: Download CSV, Download JSON, Copy CSV, and Copy JSON. File names are "<date> <name>", with each run of characters other than a letter, digit, `_`, `.`, or `-` replaced by a single `_`. Where downloads aren't available, the app says to use Copy. The offline copy is saved as `rally-route-instructions.html`.

## Getting the Route Instructions in
- Inside Claude: Add page photos → Read. The artifact `sample` capability reads one page per call.
- Standalone copy: needs an Anthropic API key, entered on the Route tab (see Reading pages). With no key, Read explains this. API errors say whether the network or the key failed.
- Offline copy: strips any security-policy meta tags and scripts injected by the hosting viewer from the downloaded HTML, so the standalone copy can reach the API.
- A copied photo can be pasted on the Route tab where the device allows it.
- Add page photos opens a picker that accepts several images at once, so a whole rally can be added in one go.
- Paste rows accepts CSV only: an app CSV, with the rally details (including the Vehicle line) above the `RI,…` header line skipped, or any CSV with a header line that has the same column names. It reads the RI, OM (a `x.xx/0.00` or bare `/0.00` OM marks a restart), CZT, CP, Instruction, and Info columns by header name, and ignores the computed columns. Completion marks and TA entries are not restored; the JSON export is the full record. Text with no header line, such as pasted JSON or prose, finds no rows.
- Paste rows with no rows found shows "No rows found in that text", keeps the dialog open, and leaves the table unchanged.

## Testing
- The core is pure (no DOM, no clock) and is unit-tested under Node.
- Playwright runs at 390 and 360 px portrait and 844 px landscape. These are the supported layouts.
- A mock of the Claude runtime (frozen db snapshots plus a sample reader) covers the account-copy and photo-merge path.
- The tests use the built-in invented sample rally, "Sample Rally" (`src/sample.js`); mocks of the page reader return invented canned rows of their own.
- The offline copy's stripping of security-policy meta tags and injected scripts is verified against a simulated injected CSP.

## Hosting and install
- App name: `Rally: Monte Style` (manifest `name` and page title); `short_name`: `Monte Style`.
- Hosted on GitHub Pages at https://bigbaaadbob.github.io/rally-monte-style/. Every push to `main` builds, runs the unit tests, and publishes only if they pass (`.github/workflows/pages.yml`).
- Installable web app: `manifest.webmanifest` (standalone display, icons) and `sw.js`.
- `sw.js` caches the app's own files, so the installed app opens and reloads with no signal. Requests to other sites (the Anthropic API) are never intercepted. Caches are named `rally-monte-style-<version>`; on activate, every cache with that prefix or the earlier `route-table-` prefix other than the current version is deleted.
- Each build stamps a version into `sw.js` and the page (shown on the Data tab).
- Updates: when a new version is published, the app shows "A new version of the app is ready." with a Reload button. It never reloads by itself, including on first install, so a rally in progress is never interrupted.
- The Rallies tab shows install steps when the app is opened in a browser rather than installed: the Android Install button when Chrome offers one, and Share → Add to Home Screen on iPhone/iPad, with a note that the installed app's storage is separate from Safari's.
- The same `dist/index.html` still works as a claude.ai artifact (no offline cache there; Claude's own reader is used).

## Reading pages
- Outside claude.ai, pages are read with the user's Anthropic API key, entered on the Route tab and stored only in that device's local storage. It is never exported or committed. The Data tab can remove it. Only a key that starts with `sk-ant-` is saved; any other entry is rejected with a message and nothing is stored.
- Model picker (saved per device): Sonnet 5.5 (default, about 2¢/page), Haiku 5.5 (about 0.1¢/page), Opus 5.5 (about 7¢/page). The cost notes assume Nov 2026 list prices and an image of about 3,900 tokens. Pages are sent at up to 2,000 px.
- A note the reader returns for a row is appended to its Info as ' [OCR: …]'.
- Reader replies: the JSON array of rows is found even with prose around it and [brackets] in instruction text, and several fenced blocks are combined. A fenced block that isn't JSON is skipped, and the rows from the valid blocks are used. A reply with no valid block finds no rows.
- Each page thumbnail shows the model that read it last (inside claude.ai there is no model label). Every page that has been read offers "Re-read", which reads that page again with the currently selected model (inside claude.ai, with Claude's reader). Each row it returns replaces the row with the same RI and other rows stay, so a row misread on an earlier read stays until it is deleted in the Route editor.
- Errors name the cause: no network, key rejected (401), refused (402/403: credit or model access), or reply cut off.
- Open item: run a full 18-page rally through all three models once and compare against the paper.
