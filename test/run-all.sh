#!/usr/bin/env bash
# Build, then run the unit tests and every browser test. Stops at the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 build.py
node test/core.test.js
for t in test/e2e/*.py; do
  echo "== $t"
  python3 "$t"
done
