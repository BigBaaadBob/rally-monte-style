# rally-monte-style

Tools to help during a Monte Carlo Style SCCA rally.

The first tool is a Route Table app for SCCA Monte Carlo–style (TDS) RoadRallies.

It builds the route table from photos of the Route Instruction pages, then adds:

- **VM** (vehicle miles = OM × OCF)
- **TT** (target time = CZT + car number in minutes + time adjustment)

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

Everything (build, unit tests, every browser test):

```sh
test/run-all.sh
```

Individually:

```sh
python3 build.py
node test/core.test.js
python3 test/e2e/pwa.py       # offline cache, update prompt, API reading (needs Playwright + Chrome)
python3 test/e2e/e2e6.py      # Run screen
```

## License

GNU General Public License v3.0 — see `LICENSE`.
