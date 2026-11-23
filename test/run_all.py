"""Build, then run the unit tests and every browser test. Stops at the first failure.

  Windows:    .venv/Scripts/python test/run_all.py
  Linux/WSL:  .venv/bin/python test/run_all.py
"""
import os, pathlib, shutil, subprocess, sys

if sys.version_info[:2] != (3, 14):
    print(f'Python 3.14 required; running {sys.version.split()[0]} at {sys.executable}. Use the project .venv.')
    sys.exit(1)

ROOT = pathlib.Path(__file__).resolve().parents[1]
os.chdir(ROOT)
env = dict(os.environ, PYTHONUTF8='1')

def run(*cmd):
    r = subprocess.run(cmd, env=env)
    if r.returncode:
        print(f'FAILED: {cmd[-1]} (exit {r.returncode})', flush=True)
        sys.exit(r.returncode)

run(sys.executable, 'build.py')
if not shutil.which('node'):
    print('node not found on PATH; it is needed for test/core.test.js.')
    sys.exit(1)
run('node', 'test/core.test.js')
run('node', 'test/vision.test.js')
run('node', 'test/rallyfile.test.js')
for t in sorted(pathlib.Path('test/e2e').glob('*.py')):
    if t.name.startswith('_'): continue
    print(f'== {t.as_posix()}', flush=True)
    run(sys.executable, str(t))
