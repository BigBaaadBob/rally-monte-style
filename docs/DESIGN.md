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
- Clear Route Instructions is titled "Clear Route Instructions", its OK button says "Clear", and its text is: `Clear all n Route Instructions and their run data from “<rally name>”? This cannot be undone.` With exactly one row it reads `Clear the 1 Route Instruction and its run data from “<rally name>”? This cannot be undone.` The rally name falls back to "this rally". It removes the rows, all Time Allowances, and the last-read highlight; completion marks and estimate locks go with the rows, and page copies no row uses any more are freed. The text says nothing about page photos or page images, and the action leaves the photos in place. The button is disabled when the rally has no Route Instructions, and is enabled again once a row is added, pasted, or read.
- Dialog wording avoids contractions (for example "cannot", not "can't").
- Page photos (add, remove, Clear photos) are per rally and session-only; see Reading pages → Page photos.
- Page image: each row with a band shows its image, read-only, in a line under the row spanning the Instruction and Info columns. Tap it to see it full screen (as on Run). The editor never adds, changes, or removes an image. A row with no band shows nothing in its place. Rows added by hand or pasted as CSV have no band.
- Page image flags (listed with the other flags, each starting `RI n:` so the row highlights): `RI n: check page image` when the reader's `y` fell in a different band than its `row` (`y` decided), and `RI n: page image missing` when the row has a band but its page copy is gone (Re-read restores it).
- Flags above the table: an RI with no OM, an OM less than the RI before it (missed restart?), a CZT earlier than the previous CZT, and rows out of order. The first 8 are listed, then "…and n more". Rows from the last read are highlighted.

**Data**
- "Run data" means completion marks, Time Allowances, and estimate locks.
- Clear run data, Delete rally, and Remove saved API key each ask first.
- Clear run data is titled "Clear run data", its OK button says "Clear", and its text is: `Clear the run data for “<rally name>”? The Route Instructions stay. This cannot be undone.` The rally name falls back to "this rally".
- Delete rally is titled "Delete rally", its OK button says "Delete", and its text is: `Delete “<rally name>” and all its data from this device? This cannot be undone. Export it first if you want a record.` It also drops the rally's page photos and frees its page copies. Rows returned by a read of that rally that is still running are discarded, with no message. The rally name falls back to "Untitled rally".
- Duplicate rally adds " (copy)" to the name and makes the copy current. The copy starts with no page photos and its rows have no bands (no page images).
- Page images line, for the open rally: `Page images: n pages, x.x MB on this device` (`1 page` in the singular), or `Page images: none`. It counts the page copies the rally's rows refer to and their stored size. Delete row, Re-read, and Clear Route Instructions can lower it.

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
- Page image on the active card: the active RI's card shows the image of its band, if it has one, including for text-only rows (a sign the reader missed is when the crew needs it most). The Run list stays text only, and the next RI's image is not shown. Portrait: below the card text, full card width, at most 120 px tall. Landscape: beside the card text (to the right of the RI header, VM/TT, and instruction), fitted within about 40% of the card width × 110 px, aspect kept, never enlarged past natural size. In landscape a card with an image uses tighter spacing, smaller instruction text, and 24 px VM/TT figures so that Complete and the controls stay visible at 844x390. These are defaults that the Run screen sizing work may tune. A row with no image uses the full card width for text; nothing stands in for the image. Complete and the run controls stay fully visible with a short row, a sign row, and a tall photo row at all three layouts.
- Tap the card image to see it full screen, fitted on a dark background. A tap anywhere closes it. It changes no run state, and Complete cannot be pressed while it is open. A missing or failed image never blocks running, completing, or Undo.
- Night theme dims page images (card, Route tab, and full screen) to about 60% brightness. They are never inverted.
- Images have no effect on VM, TT, TA, restarts, estimates, or close rows.
- Scrolling: the list keeps the user's scroll position through every change. The app scrolls only when Complete is pressed, or when a rally's Run tab is first shown in a session; both place the active RI near the top with one row above it. A rally with no active RI (no Route Instructions, or all complete) starts at the top on its first visit. Each rally keeps its own scroll position, in memory only.
- Undo is disabled when nothing is complete. Un-completing shows "RI n marked not complete".
- When every RI is complete, the active card reads "All n Route Instructions complete" with Undo last complete. With no Route Instructions, the Run tab shows "No Route Instructions yet." and a Build it on Route button.
- Run layout: in landscape at 640 px or wider, the Run list uses two columns and shows the CP column; otherwise it uses one column and no CP column.
- The screen is kept awake while the Run tab is shown.
- Leaving the browser's full screen (for example with Esc) also leaves the app's full-screen mode.

## Storage
- Saved on the device (localStorage) after every change.
- Rallies are stored only on the device. There is no account or cloud copy.
- localStorage keys are `rallyMonteStyle.v1` (rallies) and `rallyMonteStyle.apikey` (the API key). The earlier `rallyRT.v1` and `rallyRT.apikey` keys are deleted unread on load; there is no migration.
- Rallies saved without Vehicle (in localStorage or JSON files) load with it empty; there is no migration.
- Page copies (see Reading pages → Page images) are stored in IndexedDB, not localStorage. On the first save of a page copy the app calls `navigator.storage.persist()`; a refusal is silently accepted. Rallies saved before page images existed have no bands and show no images; there is no migration.
- Page images are not in JSON, CSV, or any other export. JSON import and Duplicate rally drop all bands, so no row refers to a page copy that does not exist. Moving a rally's images between devices is not supported yet.
- Export: JSON (full record) is the only round-trip format. CSV is an export-only report (augmented Route Instructions with class, close limit, and estimate lock status); its details block includes a Vehicle line after the crew lines, written even when empty.
- If the browser refuses to save on the device, a banner says so.
- JSON export is `{app: 'rally-monte-style', version: 1, rally: {…}}`. Import accepts this or a bare rally object, always creates a new rally with a new id and makes it current, and adds " (imported)" to the name when that id already exists. A file that isn't a rally JSON export is rejected with a message.
- CSV format: details lines Rally, Date, Driver, Navigator, Passengers ("; " separated), Vehicle, Car number, Class, OCF, Close RI limit (mi), and Speedometer (est.), with OCF written to four decimals (e.g. 1.0100); a blank line; then the columns RI, Restart, OM, VM, CZT, TA (s, whole seconds), TA entered here, TT, Est TT, Est locked, Done, Done at, CP, Instruction, and Info. A restart's OM is written x.xx/0.00 and its VM prev/0.00. Time columns follow the Time format setting.
- Exports: Download CSV, Download JSON, Copy CSV, and Copy JSON. File names are "<date> <name>", with each run of characters other than a letter, digit, `_`, `.`, or `-` replaced by a single `_`.
## Getting the Route Instructions in
- Add page photos → Read. Reading needs an Anthropic API key, entered on the Route tab (see Reading pages). With no key, Read explains this. API errors say whether the network or the key failed.
- A copied photo can be pasted on the Route tab where the device allows it.
- Add page photos opens a picker that accepts several images at once, so a whole rally can be added in one go.
- Paste rows accepts CSV only: an app CSV, with the rally details (including the Vehicle line) above the `RI,…` header line skipped, or any CSV with a header line that has the same column names. It reads the RI, OM (a `x.xx/0.00` or bare `/0.00` OM marks a restart), CZT, CP, Instruction, and Info columns by header name, and ignores the computed columns. Completion marks and TA entries are not restored; the JSON export is the full record. Text with no header line, such as pasted JSON or prose, finds no rows.
- Paste rows with no rows found shows "No rows found in that text", keeps the dialog open, and leaves the table unchanged.

## Testing
- The core is pure (no DOM, no clock) and is unit-tested under Node.
- Playwright runs at 390 and 360 px portrait and 844 px landscape. These are the supported layouts.
- `pwa.py` covers photo read and merge by RI on the API-key path, including a rally switch while a read is running.
- Band finding is a pure function (pixel data in, band out), unit-tested under Node on a synthetic ruled page that the test draws from invented content (not scanned), with row heights varying about 10:1. Cases: `row` and `y` agree; `y` wins with a flag; too few rules falls back to `y`; missing or invalid fields give no band; a continuation row at the top is counted. The mock reader's canned rows carry `row` and `y`; e2e checks select rows by property (has a band, has no band, tallest band), not by RI number.
- A guard test checks that the built page makes no claude.ai artifact-runtime calls.
- The tests use the built-in invented sample rally, "Sample Rally" (`src/sample.js`); mocks of the page reader return invented canned rows of their own.

## Hosting and install
- App name: `Rally: Monte Style` (manifest `name` and page title); `short_name`: `Monte Style`.
- Hosted on GitHub Pages at https://bigbaaadbob.github.io/rally-monte-style/. Every push to `main` builds, runs the unit tests, and publishes only if they pass (`.github/workflows/pages.yml`).
- Installable web app: `manifest.webmanifest` (standalone display, icons) and `sw.js`.
- `sw.js` caches the app's own files, so the installed app opens and reloads with no signal. Requests to other sites (the Anthropic API) are never intercepted. Caches are named `rally-monte-style-<version>`; on activate, every cache with that prefix or the earlier `route-table-` prefix other than the current version is deleted.
- Each build stamps a version into `sw.js` and the page (shown on the Data tab).
- Updates: when a new version is published, the app shows "A new version of the app is ready." with a Reload button. It never reloads by itself, including on first install, so a rally in progress is never interrupted.
- The Rallies tab shows install steps when the app is opened in a browser rather than installed: the Android Install button when Chrome offers one, and Share → Add to Home Screen on iPhone/iPad, with a note that the installed app's storage is separate from Safari's.
- The app runs only as a web page (GitHub Pages, installed or in a browser). It is not built or tested as a claude.ai artifact.

## Reading pages
- Pages are read with the user's Anthropic API key, entered on the Route tab and stored only in that device's local storage. It is never exported or committed. The Data tab can remove it. Only a key that starts with `sk-ant-` is saved; any other entry is rejected with a message and nothing is stored.
- Model picker (saved per device): Sonnet 5.5 (default, about 2¢/page), Haiku 5.5 (about 0.1¢/page), Opus 5.5 (about 7¢/page). The cost notes assume Nov 2026 list prices and an image of about 3,900 tokens. Pages are sent at up to 2,000 px.
- A note the reader returns for a row is appended to its Info as ' [OCR: …]'.
- The reader returns two more fields per row, before `note`: `row`, the row's position counting the ruled rows below the column headings from 1 (a continued part at the top of the page counts as a row but is not returned; the prompt says so), and `y`, the row's vertical centre as a fraction of image height (0 top, 1 bottom, two decimals). `row` is used only if it is a positive integer and `y` only if it is a number from 0 to 1; a missing or invalid value is ignored and is never an error. The raw `row` and `y` are not stored.
- Sign graphics and photos in an instruction are written `[sign: …]` in its place, giving the sign's words exactly, or a short description if it has none (for example `CHECKPOINT at [sign: deer crossing]`).
**Page images**
- For each page read, the app saves on the device (IndexedDB) the exact image it sent to the reader (at most 2,000 px) as JPEG at quality 0.85: the page copy. Page photos themselves stay session-only.
- Band: the app finds the heavy full-width row rules and the vertical column rules in the page copy. The row's image is the nth ruled band below the headings (n = `row`; the first ruled band is the headings), cropped from the Instruction column's left rule to the table's right edge (Instruction and Info). If `y` falls in a different band, `y` decides and the row is flagged on Route. If too few rules are found, the band is centred on `y` with a fixed margin. With no usable `row` or `y`, the row has no band and no image.
- The rally record stores each row's band as `{page, top, bottom, left, right}`: the page copy id and fractions (0–1, four decimals) of the page copy. An RI split across a page break gets one band, from the page its RI number is on.
- At startup, once the page copies are listed and only if localStorage loaded, copies no row refers to are freed (for example after a crash during a read). A copy saved by a read that has not yet merged is never freed.
- A page copy exists only while at least one row's band refers to it. Delete row, Re-read, Clear Route Instructions, and Delete rally free copies no longer used. Clear photos and removing a photo do not touch page copies.
- A band set by `y` against a different `row` also carries `check: true`, so the `RI n: check page image` flag survives a reload. It is the only field stored besides the five above.
- Editing a row's text, or renaming its RI, leaves its band unchanged.
- Re-read: a returned row with a valid band replaces the old row's band, and the old page copy is freed if no row still uses it. A returned row with no valid band keeps the old row's band (the image shows what is printed for that RI, whatever the reader made of the text). Rows not returned keep their band and copy.
- If saving a page copy fails, the read still succeeds and its rows are saved without bands. The "Pages read" summary adds `Page images could not be saved on this device; rows from this page have no image.`
- If a row has a band but its page copy is missing, the row shows no image and Route lists `RI n: page image missing`. There is no message on the Run tab.
- Reader replies: the JSON array of rows is found even with prose around it and [brackets] in instruction text, and several fenced blocks are combined. A fenced block that isn't JSON is skipped, and the rows from the valid blocks are used. A reply with no valid block finds no rows.
- Each page thumbnail shows the model that read it last. Every page that has been read offers "Re-read", which reads that page again with the currently selected model. Each row it returns replaces the row with the same RI and other rows stay, so a row misread on an earlier read stays until it is deleted in the Route editor.
- Errors name the cause: no network, key rejected (401), refused (402/403: credit or model access), or reply cut off.
**Page photos**
- Page photos belong to the rally they were added to. The Route tab shows only the open rally's photos. Opening another rally neither shows nor clears them; they are there again when that rally is reopened.
- Photos are session-only: a reload or app restart drops them, because the Route Instructions read from them are saved. To Re-read after a reload, add the photos again.
- Each thumbnail has a ✕ that removes only that photo, after a confirm. The dialog is titled "Remove photo", its OK button says "Remove", and its text is: `Remove this page photo? Route Instructions already read from it stay.`
- Clear photos is titled "Clear photos", its OK button says "Clear", and its text is: `Clear all n page photos from “<rally name>”? Route Instructions already read from them stay.` With exactly one photo it reads `Clear the 1 page photo from “<rally name>”? Route Instructions already read from it stay.` The rally name falls back to "this rally". The button appears only when the open rally has photos.
- Neither ✕ nor Clear photos changes Route Instructions, Time Allowances, completion marks, or the last-read highlight.
- Delete rally drops the rally's photos. Removing a photo, Clear photos, and Delete rally free the photos' object URLs.
- Read and Re-read record the owning rally when they start. The rows they return merge by RI into that rally, and that rally's last-read highlight is updated, even if another rally is open when the read finishes; the open rally is untouched. The last-read highlight and the reading state are kept per rally, so reads on different rallies can run at the same time.
- When a read finishes while another rally is open, the "Pages read" summary names the owning rally (`“<rally name>”: …`); when the owning rally is open the text is unchanged.
- Open item: run a full 18-page rally through all three models once and compare against the paper.
