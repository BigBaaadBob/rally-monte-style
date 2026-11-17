# Rally: Monte Style

Rally: Monte Style is an installable web app for SCCA Monte Carlo–style (TDS) RoadRallies. It reads photos of the Route Instruction pages into a table of Route Instructions, then adds:

- **VM** (vehicle miles = OM × OCF)
- **TT** (target time = CZT + car number in minutes + time allowance (TA))

It also estimates TT for rows that have no CZT, from your speedometer setting. During the rally it runs offline on a phone or tablet.

## Use it

Open **https://bigbaaadbob.github.io/rally-monte-style/** on the phone or tablet, then install it:

- **Android (Chrome):** ⋮ menu → **Install app** (or **Add to Home screen**).
- **iPhone / iPad (Safari):** **Share** → **Add to Home Screen** → **Add**. The installed app keeps its own storage, separate from Safari, so set up rallies in the installed app.

Once installed it opens from its icon and runs with no internet. Internet is needed only to read Route Instruction photos. Reading uses your own Anthropic API key, entered on the Route tab and stored only on that device; Sonnet 5.5 is the default model. When a new version is published, the app offers **Reload**; it never reloads by itself.

## Layout

| Path | What it is |
|---|---|
| `src/core.js` | Pure computation (no DOM, no clock): legs and restarts, VM, TT, TA, estimates, merge, CSV |
| `src/app.js` | User interface |
| `src/app.html` | Page shell and styles; `build.py` inlines the scripts into it |
| `web/` | Installable-app files: `manifest.webmanifest`, `sw.js` (offline cache), `icons/` |
| `tools/make_icons.py` | Draws the icons (run once; PNGs are committed) |
| `.github/workflows/pages.yml` | Build, unit-test, and publish to GitHub Pages on every push to `main` |
| `src/sample.js` | Built-in sample rally |
| `build.py` | Builds `dist/`: `index.html` (the whole app in one file), the manifest, icons, and a version-stamped `sw.js` |
| `test/core.test.js` | Unit tests: `node test/core.test.js` |
| `test/e2e/` | Browser tests (Playwright, Python) |
| `docs/DESIGN.md` | Design decisions |

## Build and test

The tests need Python 3.14 in a project virtual environment, plus Node for the unit tests.

Set up once.

Windows:

```sh
py -V:3.14 -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt
.venv/Scripts/python -m playwright install chromium
```

Linux or WSL:

```sh
python3.14 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m playwright install --with-deps chromium
```

Everything (build, unit tests, every browser test):

```sh
.venv/Scripts/python test/run_all.py     # Windows
.venv/bin/python test/run_all.py         # Linux or WSL
```

Test details: see `CLAUDE.md` § Testing.

## License

GNU General Public License v3.0 — see `LICENSE`.
