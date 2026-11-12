import pathlib, sys
d = pathlib.Path(__file__).parent
html = (d/'src/app.html').read_text()
for tag, f in (('/*CORE*/','src/core.js'),('/*SAMPLE*/','src/sample.js'),('/*APP*/','src/app.js')):
    code = (d/f).read_text()
    assert '</script' not in code.lower(), f
    html = html.replace(tag, code, 1)
(d/'dist').mkdir(exist_ok=True)
(d/'dist/index.html').write_text(html)
print('built', len(html), 'bytes')
