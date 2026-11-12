# Notes for Claude

- Owner: Bob Withrow. Write for a technical reader; lead with the answer.
- `docs/DESIGN.md` is the source of truth for behaviour. Update it whenever behaviour changes.
- Keep `src/core.js` pure (no DOM, no clock). Every computation change gets a unit test in `test/core.test.js`.
- No system clock or sensor may feed any computation (Stock-class posture). Timestamps are logged only.
- The built app is one self-contained `dist/index.html`; `build.py` inlines the scripts. Never commit `dist/`.
- Never commit API keys. The Anthropic key lives only in each device's local storage.
- Before finishing a change: `python3 build.py && node test/core.test.js`, plus the relevant `test/e2e` script (`pwa.py` for anything touching install, offline, or reading).
- Pushing to `main` publishes to GitHub Pages. The app must never reload itself mid-rally: updates wait for the user to tap Reload.
