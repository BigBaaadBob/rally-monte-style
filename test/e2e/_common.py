"""Shared setup for the e2e scripts. Import it before anything else.

Requires Python 3.14 (the project .venv; see CLAUDE.md), forces UTF-8 stdout, and provides
the app URL, the screenshot directory, and a browser launcher.
"""
import os, pathlib, sys

if sys.version_info[:2] != (3, 14):
    print(f'Python 3.14 required; running {sys.version.split()[0]} at {sys.executable}. Use the project .venv.')
    sys.exit(1)
sys.stdout.reconfigure(encoding='utf-8')

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP_URL = (ROOT / 'dist' / 'index.html').as_uri()
OUT_DIR = ROOT / 'test/e2e/out'
OUT_DIR.mkdir(parents=True, exist_ok=True)


def launch_browser(p, **kw):
    """Launch Playwright's bundled Chromium. Returns the awaitable, so call as `await launch_browser(p)`."""
    args = list(kw.pop('args', []))
    if hasattr(os, 'geteuid') and os.geteuid() == 0:
        args.append('--no-sandbox')
    return p.chromium.launch(args=args, **kw)
