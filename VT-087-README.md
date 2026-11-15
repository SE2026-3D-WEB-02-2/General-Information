# VT-087 — Reviewer Approval Vertical Slice

Individual assignment BT3 (student 23001884), team SE2026-T22, project 3D-WEB-02.
Change request: a **reviewer** role that can read and approve annotations but never modify the original data.
Risk: race condition when two concurrent requests change the same annotation.

- Submission branch: `individual/vt-087-reviewer-approval` (do not merge until the team reviews it)
- Baseline commit: `a88aac211712800cdc1c993edd0fc28ec5d988d1`

## What this branch adds

- `POST /api/v1/annotations/:id/approve` (reviewer / project-lead only), body `{ "expectedVersion": n }`, header `Idempotency-Key`.
- RBAC gate + reviewer content gate (a `REVIEWER` cannot change `position` / `normal` / `cameraState`, cannot delete).
- Idempotency guard (same key → stored outcome, no second version bump).
- Concurrency guard: OCC pre-check + atomic compare-and-swap (`updateIfVersion`) → exactly one winner, others 409.
- Double-approval guard: a RESOLVED annotation cannot be re-approved with a new key (422, no version bump).
- `server.ts` forwards the `Idempotency-Key` header and allows it in CORS (without it, approve over real HTTP was always 422).

## Run

```bash
npm install
npm run verify                          # whole monorepo: architecture check + all suites
npm run test:vt087                      # VT-087 suite, TC01–TC24
npm run test:vt087:load                 # 100 concurrent approves, in-process
node scripts/vt087-http-load-test.mjs   # 100 concurrent approves over real HTTP, 5 rounds (ROUNDS=n to change)
node --test --experimental-test-coverage --test-coverage-include='apps/api/src/**' apps/api/test/reviewer-approval.spec.ts
node --test --test-randomize --test-random-seed=7 apps/api/test/reviewer-approval.spec.ts   # order check
```

## Commit trail (test-first)

| Commit | Meaning | VT-087 result |
|---|---|---|
| `a88aac2` | baseline | – |
| `3281ebe` | tests TC01–TC09 (RED) | 6 fail |
| `eb2cd62` | reviewer approval + OCC + idempotency (GREEN) | 9/9 pass |
| `9123a4d`, `bccd603`, `22dd10b` | TC10–TC20, in-process load harness | 20/20 pass |
| `c9f4914` | TC21–TC24 (RED: double approve, HTTP header) | `evidence/tc21_red.log`, `evidence/tc24_red.log` |
| `aa0edf0` | fix: RESOLVED guard + forward Idempotency-Key | 24/24 pass |

## Mutation experiment ("remove idempotency / concurrency guard")

Each mutant is a throw-away branch cut from `aa0edf0`; none is part of the submission branch.

| Branch | Mutation | Killed by |
|---|---|---|
| `experiment/vt-087-mut-final-idem` | idempotency early-return disabled | TC09, TC24 |
| `experiment/vt-087-mut-final-occ` | OCC pre-check + CAS version compare removed | TC07, TC08, TC18, TC22 (+ HTTP load scenario A) |
| `experiment/vt-087-mut-final-both` | both guards removed | TC07, TC08, TC09, TC17, TC18, TC22, TC24 |

```bash
git switch experiment/vt-087-mut-final-occ && npm run test:vt087   # expect failures
git switch individual/vt-087-reviewer-approval
```

Older mutants from the first iteration remain on `exp/vt087-mut{A,B,B1,B2,C,D,E,F,G}`.

## Evidence (`evidence/`)

`vt087_final.log`, `verify_final_tip.log`, `coverage_final.txt`, `flaky_check.log`, `load_final.log`,
`http_load_final.log`, `mut_final_{idem,occ,both}.log`, `mut_final_*_http_load.log`, `tc21_red.log`, `tc24_red.log`.

Limits: in-memory store on one laptop, no real database or network hop between hosts; the p95 numbers show the
guard logic is not a bottleneck, not a production SLA.
