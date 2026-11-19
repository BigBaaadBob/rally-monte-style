"""Shared setup for the e2e scripts. Import it before anything else.

Requires Python 3.14 (the project .venv; see CLAUDE.md), forces UTF-8 stdout, and provides
the app URL, the screenshot directory, a browser launcher, and the check/capture_errors/run helpers
that make a script exit 1 when a check fails or an unexpected page error is captured.
"""
import asyncio, os, pathlib, re, sys

if sys.version_info[:2] != (3, 14):
    print(f'Python 3.14 required; running {sys.version.split()[0]} at {sys.executable}. Use the project .venv.')
    sys.exit(1)
sys.stdout.reconfigure(encoding='utf-8')

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP_URL = (ROOT / 'dist' / 'index.html').as_uri()
OUT_DIR = ROOT / 'test/e2e/out'
OUT_DIR.mkdir(parents=True, exist_ok=True)


# Supported layouts (DESIGN § Testing): (width, height, label). WIDE_PORTRAIT is not a supported layout; it is
# used only to check that the two-column Run list needs landscape, not just a wide viewport (DESIGN § Run controls, Run layout).
LAYOUTS = [(390, 844, '390 portrait'), (360, 780, '360 portrait'), (844, 390, '844 landscape')]
WIDE_PORTRAIT = (768, 1024, '768 wide portrait')


def wide_run_layout(w, h):
    """DESIGN § Run controls (Run layout): two columns and the CP column in landscape at 640 px or wider, else one and none."""
    return w > h and w >= 640


def launch_browser(p, **kw):
    """Launch Playwright's bundled Chromium. Returns the awaitable, so call as `await launch_browser(p)`."""
    args = list(kw.pop('args', []))
    if hasattr(os, 'geteuid') and os.geteuid() == 0:
        args.append('--no-sandbox')
    return p.chromium.launch(args=args, **kw)


# ---- checks, error capture, and exit status ----
# A script calls check() for each pass condition, capture_errors() on every page it opens, and
# run(main) at the end. run() exits 1 if any check failed or any page error was not allowlisted.
#
# ALLOW lists messages that are known and harmless: (kind, regex, reason), where kind is 'pageerror'
# or 'console'. It starts empty. Add an entry only for a message seen in a real run, with a reason.
# A 'pageerror' entry also needs a justification in the PR description.
ALLOW = []

_checks = 0
_failed = 0
_pages = 0
_captured = []   # (page label, kind, text, per-page allow entries)


def check(cond, msg):
    """Record one pass/fail check. Prints ok: or FAIL: and never raises."""
    global _checks, _failed
    _checks += 1
    if cond:
        print(f'ok: {msg}')
    else:
        _failed += 1
        print(f'FAIL: {msg}')
    return bool(cond)


def capture_errors(page, allow=(), label=None):
    """Collect uncaught page errors and console.error messages from `page`.

    `allow` is extra (kind, regex, reason) entries that apply to this page only. Call it for each page.
    """
    global _pages
    allow = tuple(allow)
    _pages += 1
    label = label or f'page{_pages}'
    page.on('pageerror', lambda e: _captured.append((label, 'pageerror', str(e), allow)))
    page.on('console', lambda m: _captured.append((label, 'console', m.text, allow)) if m.type == 'error' else None)


def _classify():
    global _checks, _failed
    for label, kind, text, allow in _captured:
        hit = next((a for a in (*ALLOW, *allow) if a[0] == kind and re.search(a[1], text)), None)
        if hit:
            print(f'allowed: {kind}: {text} ({hit[2]})')
        else:
            _checks += 1
            _failed += 1
            print(f'FAIL: unexpected {kind} on {label}: {text}')


def run(main):
    """Run the async main(), then report and exit 1 if anything failed. An uncaught exception propagates."""
    asyncio.run(main())
    _classify()
    print(f'{pathlib.Path(sys.argv[0]).name}: {_checks} checks, {_failed} failed')
    sys.exit(1 if _failed else 0)
