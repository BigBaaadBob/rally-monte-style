"""Build the app into dist/.

dist/index.html        the whole app in one self-contained file
dist/manifest.webmanifest, dist/icons/   for installing to the home screen
dist/sw.js             offline cache, stamped with this build's version
"""
import datetime, json, os, pathlib, shutil, subprocess, time

d = pathlib.Path(__file__).resolve().parent
dist = d / 'dist'

def version():
    sha = os.environ.get('GITHUB_SHA', '')[:7]
    if not sha:
        try: sha = subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=d, capture_output=True, text=True).stdout.strip()
        except OSError: sha = ''
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
    return f"{stamp}-{sha or 'local'}"

VERSION = version()
html = (d / 'src/app.html').read_text(encoding='utf-8')
for tag, f in (('/*CORE*/', 'src/core.js'), ('/*SAMPLE*/', 'src/sample.js'), ('/*APP*/', 'src/app.js')):
    code = (d / f).read_text(encoding='utf-8')
    assert '</script' not in code.lower(), f
    html = html.replace(tag, code, 1)
html = html.replace('__APP_VERSION__', VERSION)

def clean(path, attempts=5):
    """Remove path; retry briefly because Windows file locks (a running server, antivirus) can block it."""
    for i in range(attempts):
        try:
            shutil.rmtree(path); return
        except OSError:
            if i == attempts - 1: raise
            time.sleep(0.05 * 2 ** i)   # 0.05, 0.1, 0.2, 0.4 s: about 0.75 s in total

if dist.exists(): clean(dist)
(dist / 'icons').mkdir(parents=True)
(dist / 'index.html').write_text(html, encoding='utf-8', newline='\n')
shutil.copy(d / 'web/manifest.webmanifest', dist)
for p in (d / 'web/icons').glob('*.png'): shutil.copy(p, dist / 'icons')
assets = ['./', 'index.html', 'manifest.webmanifest'] + sorted('icons/' + p.name for p in (dist / 'icons').glob('*.png'))
sw = (d / 'web/sw.js').read_text(encoding='utf-8').replace('__VERSION__', VERSION).replace('__ASSETS__', json.dumps(assets))
(dist / 'sw.js').write_text(sw, encoding='utf-8', newline='\n')
(dist / '.nojekyll').write_text('', newline='\n')
print(f'built {VERSION}: index.html {len(html)} bytes, {len(assets)} cached assets')
