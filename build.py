"""Build the app into dist/.

dist/index.html        the whole app in one self-contained file (also works as a claude.ai artifact)
dist/manifest.webmanifest, dist/icons/   for installing to the home screen
dist/sw.js             offline cache, stamped with this build's version
"""
import datetime, json, os, pathlib, shutil, subprocess

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
html = (d / 'src/app.html').read_text()
for tag, f in (('/*CORE*/', 'src/core.js'), ('/*SAMPLE*/', 'src/sample.js'), ('/*APP*/', 'src/app.js')):
    code = (d / f).read_text()
    assert '</script' not in code.lower(), f
    html = html.replace(tag, code, 1)
html = html.replace('__APP_VERSION__', VERSION)

if dist.exists(): shutil.rmtree(dist)
(dist / 'icons').mkdir(parents=True)
(dist / 'index.html').write_text(html)
shutil.copy(d / 'web/manifest.webmanifest', dist)
for p in (d / 'web/icons').glob('*.png'): shutil.copy(p, dist / 'icons')
assets = ['./', 'index.html', 'manifest.webmanifest'] + sorted('icons/' + p.name for p in (dist / 'icons').glob('*.png'))
sw = (d / 'web/sw.js').read_text().replace('__VERSION__', VERSION).replace('__ASSETS__', json.dumps(assets))
(dist / 'sw.js').write_text(sw)
(dist / '.nojekyll').write_text('')
print(f'built {VERSION}: index.html {len(html)} bytes, {len(assets)} cached assets')
