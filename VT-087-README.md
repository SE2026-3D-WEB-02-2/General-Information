# VT-087 — Reviewer Approval Vertical Slice

Individual assignment BT3 (student 23001884), team SE2026-T22.
Branch: `individual/vt-087-reviewer-approval`
Baseline commit: `a88aac211712800cdc1c993edd0fc28ec5d988d1`

## What this branch adds

- `POST /api/v1/annotations/:id/approve` — reviewer-only approval endpoint.
- RBAC gate in `AnnotationService.approveAnnotation` (only `REVIEWER` / `PROJECT_LEAD`).
- `Idempotency-Key` guard (HTTP header, body fallback) so a retried approve has no second side effect.
- Reviewer content-protection gate: an explicit `REVIEWER` cannot mutate `position` / `normal` / `cameraState`.
- Reuses the existing Optimistic Concurrency Control (OCC) pre-check + atomic Compare-And-Swap.
- `apps/api/test/reviewer-approval.spec.ts` — TC01–TC20 vertical-slice suite (20 tests).
- `scripts/vt087-load-test.mjs` — 100-task contention + throughput benchmark.

## Prerequisites

```bash
npm install
```

## Run the tests

```bash
# Whole monorepo (architecture check + shared/api/web suites)
npm run verify

# Only the VT-087 vertical slice (20 tests, TC01–TC20)
npm run test:vt087

# API suite
npm run test:api

# 100 concurrent-task load benchmark (JSON report)
npm run test:vt087:load
```

## Reproduce the RED → GREEN evidence

```bash
git switch individual/vt-087-reviewer-approval
git checkout 3281ebe86ac84d0b4aee1db95895e2c1f78ebe4d   # RED: tests only, no implementation
npm run test:vt087                                       # suite has 12 tests (TC01–TC12); TC02/03/05/07/08/09 FAIL
git checkout eb2cd62f7aa928c7cad63afb70ce7f4150ac7924   # GREEN: + implementation patch
npm run test:vt087                                       # 12/12 PASS (TC01–TC12)
git checkout 22dd10bd70852e953d4efd8e3014c9f332050ec2   # final tip: T2 tests added
npm run test:vt087                                       # 20/20 PASS (TC01–TC20)
```

## Reproduce the mutation experiment

```bash
git switch experiment/vt-087-mutation
git checkout exp/vt087-mutA                             # MUTANT A: idempotency guard removed
npm run test:vt087                                      # TC09 FAILS
git checkout exp/vt087-mutB1                            # MUTANT B1: OCC pre-check removed (equivalent — CAS covers it)
npm run test:vt087                                      # all pass -> SURVIVED (equivalent)
git checkout exp/vt087-mutB2                            # MUTANT B2: CAS !committed removed
npm run test:vt087                                      # TC08 + TC18 FAIL
git checkout exp/vt087-mutB                             # MUTANT B: pre-check + CAS removed
npm run test:vt087                                      # TC07 + TC08 + TC18 FAIL
git checkout exp/vt087-mutC                             # MUTANT C: reviewer content gate removed
npm run test:vt087                                      # TC03 FAILS
git checkout exp/vt087-mutD                             # MUTANT D: RBAC role check removed
npm run test:vt087                                      # TC05 + TC14 FAIL
```

The mutation branch is **not** part of the submission; the submission branch never contains it.

## Files changed vs baseline

| File | Change |
|---|---|
| `apps/api/src/modules/annotations/domain/annotation.service.ts` | `approveAnnotation`, idempotency store, reviewer content gate, optional role |
| `apps/api/src/modules/annotations/http/annotation.controller.ts` | `approveAnnotation` HTTP mapping |
| `apps/api/src/http/app-router.ts` | `POST .../approve` route + `Idempotency-Key` header |
|| `packages/shared/src/contracts/api-contracts.ts` | `canActorModifyAnnotation` accepts optional role |

## Commit table — final branch tip (22dd10b)

| Hash (short) | Subject | What changed | Tests added in it |
|---|---|---|---|
| 3281ebe | test(vt-087): add reviewer-approval vertical-slice tests (RED) | tests | TC01–TC11 (RED, some failing) |
| eb2cd62 | feat(vt-087): reviewer approval with OCC + idempotency guard | implementation | TC01–TC12 (GREEN, 12 all pass) |
| 9123a4d | test(vt-087): add TC10/TC11 risk tests + 100-task load harness | tests | TC10, TC11 (risk tests) |
| bccd603 | test(vt-087): add TC12 not-found path + tighten req() types | tests | TC12 |
| 924b8df | docs(vt-087): add README + English report for BT3 | docs | 0 |
| 22dd10b | test(vt-087): add T2 tests (TC13-TC20) | tests | TC13–TC20 (8 tests) |

## Evidence pack

- Full English report: `docs/VT-087-REPORT.md`
- This README: `VT-087-README.md`
- Mutation raw logs: `evidence/mutA.log`, `evidence/mutB1.log`, `evidence/mutB2.log`, `evidence/mutB.log`, `evidence/mutC.log`, `evidence/mutD.log`
- Load raw JSON (30 runs): `evidence/load-1.json` … `evidence/load-30.json`
- Coverage raw output: `evidence/coverage.txt` (`node --experimental-test-coverage --test apps/api/test/reviewer-approval.spec.ts`)
