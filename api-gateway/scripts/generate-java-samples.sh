#!/usr/bin/env bash
# Regenerates test/fixtures/hash-samples.jsonl via Java HashSampleGenerator (requires mvn + JDK).
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/generate-hash-samples.js
