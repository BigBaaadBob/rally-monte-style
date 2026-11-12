# rally-monte-style

Tools to help during a Monte Carlo Style SCCA rally.

The first tool is a Route Table app for SCCA Monte Carlo–style (TDS) RoadRallies.

It builds the route table from photos of the Route Instruction pages, then adds:

- **VM** (vehicle miles = OM × OCF)
- **TT** (target time = CZT + car number in minutes + time adjustment)

It also estimates TT for rows that have no CZT, from your speedometer setting. During the rally it runs offline on a phone or tablet.

## Layout

| Path | What it is |
|---|---|
| `src/core.js` | Pure computation (no DOM, no clock): legs and restarts, VM, TT, TA, estimates, merge, CSV |
| `src/app.js` | User interface |
| `src/app.html` | Page shell and styles; `build.py` inlines the scripts into it |
| `src/sample.js` | Built-in sample rally |
| `build.py` | Builds `dist/index.html` (a single self-contained file) |
| `test/core.test.js` | Unit tests: `node test/core.test.js` |
| `test/e2e/` | Browser tests (Playwright, Python) |
| `docs/DESIGN.md` | Design decisions |

## Build and test

```sh
python3 build.py
node test/core.test.js
python3 test/e2e/e2e6.py      # needs Playwright + Chrome
```

## License

GNU General Public License v3.0 — see `LICENSE`.
