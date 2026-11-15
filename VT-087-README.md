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
- Re-resolve guard: RESOLVED -> RESOLVED is rejected on both PATCH and approve (422, no version bump).
- Approve-only rule: a `REVIEWER` reaches `RESOLVED` only through `/approve` (PATCH -> RESOLVED is 403), so the
  Idempotency-Key guarantees cannot be bypassed. OPEN <-> IN_PROGRESS, reopen and `PROJECT_LEAD` PATCH are unchanged.
  **Web impact:** the RESOLVED button in `CollaborationWorkspace` must call `/approve` for reviewers (not done in this branch).
- `server.ts` forwards the `Idempotency-Key` header and allows it in CORS (without it, approve over real HTTP was always 422).

## Run

```bash
npm install
npm run verify                          # whole monorepo: architecture check + all suites
npm run test:vt087                      # VT-087 suite, TC01–TC28
node scripts/vt087-assumption-probe.mjs # prints observed behaviour for 7 assumptions (P1–P7)
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
| `344ea7a` | TC25 (RED: PATCH RESOLVED->RESOLVED bumps version) | `evidence/tc25_red.log` |
| `835432e` | fix: one re-resolve guard for PATCH and approve | 25/25 pass |
| `f739060` | TC26 (RED: reviewer resolves via PATCH) + TC27 | `evidence/tc26_red_at_f739060.log` |
| `02dba21` | fix: reviewers resolve only through /approve; Stream A test 5 setup uses /approve | 27/27, verify 50/50 |
| `cdacbfb` | TC28 (RED: audit actorId is undefined — test tokens used `id`, server reads `sub`) | `evidence/tc28_red.log` |
| `a9ed076` | fix: test tokens use `sub`; TC23 and lead tokens use the real lead id | 28/28, verify 51/51 |

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

Re-run on tip `02dba21` (applied to the working tree, then reverted; logs `evidence/mut_tip_*.log`):
idem → TC09, TC24 · occ → TC07, TC08, TC18, TC22 · both → 6 tests · approve-only gate removed → TC25, TC26 ·
re-resolve guard removed → TC21, TC25. All killed.

## Evidence (`evidence/`)

`vt087_final.log`, `verify_final_tip.log`, `coverage_final.txt`, `flaky_check.log`, `load_final.log`,
`http_load_final.log`, `mut_final_{idem,occ,both}.log`, `mut_final_*_http_load.log`, `tc21_red.log`, `tc24_red.log`.

Limits: in-memory store on one laptop, no real database or network hop between hosts; the p95 numbers show the
guard logic is not a bottleneck, not a production SLA.
