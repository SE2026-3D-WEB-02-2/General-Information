#!/usr/bin/env bash
# VT-085 flaky-risk checks. Run from repo root: bash docs/bt3-vt085/flaky-check.sh
set -u
FILES="packages/shared/test/*.spec.ts apps/api/test/*.spec.ts apps/web/test/*.spec.ts"
VT="packages/shared/test/vt085-undo-contract.spec.ts apps/api/test/vt085-undo-delete.provider.spec.ts apps/web/test/vt085-undo-delete.consumer.spec.ts"
summ() { grep -E '^ℹ (pass|fail) ' | tr '\n' ' '; }

echo "## F1 order/shared state: full suite, 30 random orders, shared process (--test-isolation=none)"
bad=0
for seed in $(seq 1 30); do
  out=$(node --test --test-randomize --test-random-seed=$seed --test-isolation=none $FILES 2>&1)
  f=$(echo "$out" | grep -E '^ℹ fail ' | awk '{print $3}')
  [ "$f" != "0" ] && { bad=$((bad+1)); echo "  seed=$seed fail=$f"; }
done
echo "  runs=30 runs_with_failures=$bad"

echo "## F2 time: same suite under 4 time zones (ISO/expiry must not depend on TZ)"
for tz in UTC Asia/Ho_Chi_Minh America/Los_Angeles Pacific/Kiritimati; do
  echo "  TZ=$tz: $(TZ=$tz node --test $VT 2>&1 | summ)"
done

echo "## F3 concurrency: TC-RACE (80 concurrent restores) + TC-CAS repeated 50x"
bad=0
for i in $(seq 1 50); do
  f=$(node --test --test-name-pattern='TC-RACE|TC-CAS' apps/api/test/vt085-undo-delete.provider.spec.ts 2>&1 | grep -E '^ℹ fail ' | awk '{print $3}')
  [ "$f" != "0" ] && bad=$((bad+1))
done
echo "  runs=50 runs_with_failures=$bad"

echo "## F4 random data: 200k generated undo tokens — format + uniqueness"
node --input-type=module -e "
import { randomBytes } from 'node:crypto';
const re=/^[0-9a-f]{32}$/; const seen=new Set(); let badFmt=0;
for (let i=0;i<200000;i++){ const t=randomBytes(16).toString('hex'); if(!re.test(t)) badFmt++; seen.add(t); }
console.log('  tokens=200000 badFormat='+badFmt+' duplicates='+(200000-seen.size));"
