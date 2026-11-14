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
- `apps/api/test/reviewer-approval.spec.ts` — TC01–TC12 vertical-slice suite.
- `scripts/vt087-load-test.mjs` — 100-task contention + throughput benchmark.

## Prerequisites

```bash
npm install
```

## Run the tests

```bash
# Whole monorepo (architecture check + shared/api/web suites)
npm run verify

# Only the VT-087 vertical slice (12 tests)
npm run test:vt087

# API suite
npm run test:api

# 100 concurrent-task load benchmark (JSON report)
npm run test:vt087:load
```

## Reproduce the RED → GREEN evidence

```bash
git switch individual/vt-087-reviewer-approval
git checkout 3281ebe86ac84d0b4aee1db95895e2c1f78ebe4d   # tests only, no implementation
npm run test:vt087                                       # expect TC02/03/05/07/08/09 to FAIL
git checkout eb2cd62f7aa928c7cad63afb70ce7f4150ac7924   # + implementation patch
npm run test:vt087                                       # expect 12/12 PASS
```

## Reproduce the mutation experiment

```bash
git switch experiment/vt-087-mutation
git checkout b2aac28fb250f653ec09e7c5b5fc079e4e66e9dd   # MUTATION A: idempotency guard removed
npm run test:vt087                                       # TC09 FAILS
git checkout 00fb87409f2be5717ca6673bb44399161310efc2   # MUTATION B: concurrency guard removed
npm run test:vt087                                       # TC07 + TC08 FAIL
```

The mutation branch is **not** part of the submission; the submission branch never contains it.

## Files changed vs baseline

| File | Change |
|---|---|
| `apps/api/src/modules/annotations/domain/annotation.service.ts` | `approveAnnotation`, idempotency store, reviewer content gate, optional role |
| `apps/api/src/modules/annotations/http/annotation.controller.ts` | `approveAnnotation` HTTP mapping |
| `apps/api/src/http/app-router.ts` | `POST .../approve` route + `Idempotency-Key` header |
| `packages/shared/src/contracts/api-contracts.ts` | `canActorModifyAnnotation` accepts optional role |
