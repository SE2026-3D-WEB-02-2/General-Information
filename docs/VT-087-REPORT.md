# BT3 Individual Assignment — VT-087

## Reviewer Approval with Optimistic Concurrency Control

**Student:** Hoàng Đức Huy — 23001884
**Team:** SE2026-T22 · **Role:** Member
**Project:** 3D-WEB-02 — Collaborative 3D Scene Annotator ("Spriter")
**Repository:** https://github.com/SE2026-3D-WEB-02-2/General-Information
**Baseline commit:** `a88aac211712800cdc1c993edd0fc28ec5d988d1`
**Submission branch:** `individual/vt-087-reviewer-approval` (not merged)
**Mutation branch (evidence only):** `experiment/vt-087-mutation`

> Commitment: *I take responsibility for all code, tests and content in this work, and I declare my use of AI.*

---

## 1. Problem statement

The Collaborative 3D Scene Annotator needs a **Reviewer** role that can **read** and **approve**
annotations but can never **modify the original annotation data**. Approval must remain correct
when many requests touch the same resource at the same time, and repeated approval requests must
not produce repeated side effects.

The repository already ships a Modular-Monolith / Hexagonal backend with an in-memory store and a
documented Optimistic Concurrency Control (OCC) contract (HTTP `409 Conflict` on a stale version).
The work therefore reuses that mechanism instead of inventing a new one, and the assignment is to
*verify* it under a reviewer-approval slice rather than to assume it.

### 1.1 Acceptance criteria

| ID | Acceptance criterion | Verification |
|---|---|---|
| AC-01 | A reviewer can read annotations they are allowed to access | `GET` returns data — TC01 |
| AC-02 | A reviewer can approve an annotation | approval succeeds, state → `RESOLVED` — TC02 |
| AC-03 | A reviewer cannot edit or delete the original data | `PATCH`/`DELETE` rejected, data unchanged — TC03, TC04 |
| AC-04 | Two concurrent requests cannot produce an invalid state transition | concurrent integration test — TC07, TC08 |
| AC-05 | A repeated approval request has no unintended side effect | idempotency test — TC09, TC10 |

### 1.2 Non-functional constraints

1. **Performance:** p95 ≤ **3.0 s** at **100 concurrent tasks**.
2. **Data integrity:** no lost update, no wrong-version overwrite, no illegal transition under concurrency.
3. **Security:** reviewer permission is enforced in the **backend**, not by hiding UI controls.

### 1.3 Invariant / contract (the single most important one)

> A reviewer may only change the *review state* through a valid `approve` operation; the reviewer
> can never change the annotation's spatial content. Each resource transitions at most once per
> valid version, and no side effect may be produced by a repeated or racing request.

This contract is enforced in the domain service and re-verified by the mutation experiment.

---

## 2. AI-assisted implementation plan and review

### 2.1 Plan prompt (given to the coding agent)

> You are a Senior Software Engineer analysing the repository before implementing a feature.
> Repository: Collaborative 3D Scene Annotator.
> Change request: add a Reviewer role; the reviewer may read and approve annotations but may not
> modify original data; protect the system against a race condition when two concurrent requests
> change the same resource; protect the idempotency/concurrency guard.
> Requirements: (1) analyse only, do not change code; (2) identify backend/frontend/database/test
> architecture; (3) locate user-role, permission, annotation and resource-state files; (4) find where
> a race condition can arise; (5) propose the smallest implementable vertical slice; (6) propose a
> test-first plan; (7) list the exact files to change and why; (8) state assumptions, dependencies
> and unproven issues; (9) propose how to verify concurrency and idempotency; (10) propose how to run
> 100 concurrent tasks and measure p95.
> Do not claim a feature exists without evidence in the source.

### 2.2 Repository findings (evidence)

| Component | Evidence in source |
|---|---|
| Architecture | Modular monolith, Hexagonal: `apps/api/src/modules/*/{domain,http,adapters}` |
| Roles | `UserRole = 'REVIEWER' \| 'PROJECT_LEAD'` in `packages/shared/src/contracts/api-contracts.ts` |
| Permission | `canActorModifyAnnotation(...)` shared pure function |
| Concurrency | `updateIfVersion(id, expectedVersion, row, audit)` — atomic CAS in `in-memory.repository.ts` and `postgres.repository.ts` (`WHERE id = $1 AND version = $2`) |
| State machine | `ALLOWED_TRANSITIONS` in `packages/shared/src/domain/annotation-policy.ts` |
| Tests | `node --test`, `npm run verify` = `arch:check` + shared/api/web suites |

### 2.3 Rebuttals of the AI plan (≥2, with evidence)

1. **AI proposal: "add the Reviewer role on the frontend only."**
   **Rebutted.** The backend already owns authorization through
   `canActorModifyAnnotation` and the HTTP controllers. A frontend-only role would leave
   `PATCH /api/v1/annotations/:id` writable by anyone. Evidence:
   `packages/shared/src/contracts/api-contracts.ts` (permission rules) and
   `apps/api/src/modules/annotations/http/annotation.controller.ts`.
   → The patch therefore adds a **backend** endpoint and a **service-level** RBAC gate.

2. **AI proposal: "checking the status before approving is enough to avoid races."**
   **Rebutted.** A check-then-write sequence is not atomic. The repository's own adapter shows the
   correct pattern: an atomic Compare-And-Swap keyed on the version
   (`WHERE id = $1 AND version = $2`). Evidence:
   `apps/api/src/modules/annotations/adapters/postgres.repository.ts` and
   `in-memory.repository.ts#updateIfVersion`. → The slice reuses OCC rather than a bare status check.

3. **AI proposal: "the in-memory backend is enough to prove concurrency."**
   **Qualified, not rejected.** The in-memory `updateIfVersion` is atomic *in-process*, which is
   enough to exercise the service-level contract, but it does **not** prove production database
   atomicity. Evidence: the in-memory adapter vs. the SQL CAS in `postgres.repository.ts`.
   → Results are reported as a *simulated environment*, never as a production SLA.

### 2.4 Correct vs. insufficient-evidence AI comments

- **Correct:** *"The approve endpoint must be RBAC-gated in the backend, not merely hidden in the
  UI."* Verified against `canActorModifyAnnotation` and the controller layer.
- **Insufficient evidence:** *"The implementation is thread-safe."* At the time only sequential
  tests existed; no concurrent test had run. The claim was not provable until TC08 (concurrent
  approvals) and the 100-task harness were executed.

### 2.5 AI-generated artefacts that look plausible but are not trustworthy immediately

1. A concurrency test built on `Promise.all` **without a start barrier** — it is timing-dependent
   and can pass for the wrong reason. Fixed by adding an explicit barrier in
   `scripts/vt087-load-test.mjs`.
2. A permission test that asserts only the HTTP `403` **without asserting the data is unchanged**.
   A `403` could still hide a partial write. Fixed by asserting version/content after every
   negative case (TC03–TC05, TC10, TC11).

---

## 3. Risk-based test strategy

### 3.1 Level allocation

| Level | Scope | In this slice |
|---|---|---|
| Unit | permission rules, version comparison, idempotency key | TC05 (service RBAC) |
| Integration / API | reviewer approve, unauthorized update, concurrency | TC01–TC04, TC06–TC11 |
| E2E | reviewer approves through the UI | **Not required** — see 3.2 |

**Not needed (explicitly out of scope):** 3D rendering tests, large-file upload tests,
cross-browser tests, and production-database tests. The reviewer-approval authority is entirely
server-side, so the meaningful contract is at the API/router boundary; the web layer's HTTP
adapter is already covered by the existing `stream-c` suite.

### 3.2 Decision table

Legend: **R** = Reviewer, **P** = Project Lead, **V** = current version, **V1** = version the client
read. `Y/N/-` = yes / no / not considered.

| # | Authenticated | Role can approve | Action = approve | Version valid | Duplicate request | Expected |
|---|---|---|---|---|---|---|
| T1 | Y | Y (R) | Y | Y | N | **Approve** (200) |
| T2 | Y | Y (R) | N (edit content) | Y | N | **Deny** (403) |
| T3 | Y | N | Y | Y | N | **Deny** (403) |
| T4 | Y | Y (R) | Y | N | N | **Conflict** (409) |
| T5 | N | - | Y | - | - | **Unauthorized** (401) |
| T6 | Y | Y (R) | Y | Y | Y | **Idempotent** (200, no 2nd side effect) |

**Test-data selection:** start from one valid baseline (T1); vary one condition at a time to
isolate the failure cause (T2–T5); combine version + duplicate to exercise the race and the retry
(T4, T6); add two requests with the same version to force the race; add a retry after success to
exercise idempotency.

### 3.3 Test cases (12)

| ID | Test case | Level | Expected | Priority |
|---|---|---|---|---|
| TC01 | Reviewer reads annotations | API | 200, data present | P1 |
| TC02 | Reviewer approves a valid annotation | Unit/API | state → `RESOLVED`, version +1 | P1 |
| TC03 | Reviewer edits original content | API | 403, data unchanged | P1 (negative) |
| TC04 | Reviewer deletes original | API | 403, data unchanged | P1 (negative) |
| TC05 | Non-privileged role approves | Unit/API | 403 | P1 (negative) |
| TC06 | Unauthenticated approve | API | 401 | P1 (negative) |
| TC07 | Approve with a stale version | Integration | 409, no overwrite | P1 (failure path) |
| TC08 | Two simultaneous approves, same version | Integration | exactly one valid transition | P1 |
| TC09 | Repeat an already-successful approve | Integration | no second side effect | P1 |
| TC10 | Approve without an Idempotency-Key | API | 422, no state change | P1 (failure path) |
| TC11 | Store fails during update | Integration | error propagates, no partial state | P1 (failure path) |
| TC12 | Approve a non-existent annotation | API | 404 | P2 |

The 100-task load experiment is reported separately as **PERF-100**.

---

## 4. Test-first implementation (RED → patch → GREEN)

### 4.1 Method

1. Baseline: `npm install`, `npm run verify` on a clean tree.
2. Branch `individual/vt-087-reviewer-approval` from baseline `a88aac2`.
3. Write the tests first (commit `3281ebe`), run them, record the failure.
4. Apply the smallest patch (commit `eb2cd62`), review the full diff, run the tests, record the pass.

### 4.2 Evidence

| Evidence | Commit / file | Result |
|---|---|---|
| E01 Baseline | `a88aac2` | clean tree |
| E02 RED (tests only) | `3281ebe` | API suite: 13 pass / **6 fail** (TC02, TC03, TC05, TC07, TC08, TC09) |
| E03 Patch | `eb2cd62` | 4 files, +151 / −3 |
| E04 GREEN | `eb2cd62` | API suite: 19 pass / 0 fail |
| E05 Final | `bccd603` | `npm run verify`: **35 pass / 0 fail**; VT-087: **12/12** |

RED failure reasons were all *behaviour not yet implemented* (missing route → 404, missing RBAC
gate, missing content gate, missing idempotency guard), not test-harness errors.

### 4.3 The patch (files and intent)

| File | Change |
|---|---|
| `annotation.service.ts` | `approveAnnotation()` with RBAC + idempotency store; reviewer content gate in `updateWithConcurrencyControl` |
| `annotation.controller.ts` | `approveAnnotation()` maps service outcome → HTTP status |
| `app-router.ts` | `POST /api/v1/annotations/:id/approve`; plumbs the `Idempotency-Key` header |
| `api-contracts.ts` | `canActorModifyAnnotation` accepts an optional role |

**How concurrency is handled:** the service performs an OCC pre-check, then delegates to the
atomic `updateIfVersion` CAS. The loser of a race receives `409 CONCURRENCY_CONFLICT` with the
server snapshot; the winner commits exactly one version increment.

---

## 5. Mutation / deliberate-bug experiment

The required mutation — **removing the idempotency/concurrency guard** — was applied on a separate
branch `experiment/vt-087-mutation` and never merged.

| Experiment | Commit | Guard removed | Tests that caught it |
|---|---|---|---|
| MUTATION A | `b2aac28` | idempotency early-return in `approveAnnotation` | **TC09** fails (`409 != 200`) |
| MUTATION B | `00fb874` | OCC pre-check + CAS (`!committed`) handling | **TC07** (`200 != 409`), **TC08** fail |

Restoring the correct code makes the suite green again (12/12). This proves the suite detects the
exact bug class the assignment targets, rather than only passing on correct code.

---

## 6. Coverage and flaky-test analysis

### 6.1 Coverage (Node built-in test coverage, VT-087 + API suites)

| File | Line | Branch | Functions |
|---|---|---|---|
| `annotation.service.ts` | 86.28% | 81.71% | 95.65% |
| `annotation.controller.ts` | 76.16% | 56.76% | 100% |
| `app-router.ts` | 92.18% | 88.06% | 100% |

Coverage is used **in context**, not as a quality score. The VT-087-relevant branches (RBAC,
idempotency, content gate, OCC conflict, store failure) are all exercised. The remaining uncovered
lines are mostly pre-existing create/comment/import/export paths unrelated to this slice. The
controller's branch coverage is the weakest because several `switch` arms (e.g. approve `400`
missing-`expectedVersion`, approve `403` via HTTP) are not reached; that is a documented residual
gap, not a claim of completeness.

### 6.2 Flaky-test risks checked

| Risk | Mitigation |
|---|---|
| Concurrency test depends on timing | explicit **barrier** releases all tasks at the same instant (`scripts/vt087-load-test.mjs`) instead of `sleep()` |
| Shared state between tests | every test builds its own `SpriterApiApplication` + seeded fixture; no order dependence |
| Unstable latency | load harness repeated **5×**; integrity assertion held in 5/5 runs |

---

## 7. Performance / risk experiment (PERF-100)

Harness: `scripts/vt087-load-test.mjs` (barrier-synchronised, in-process backend).
Target: **p95 ≤ 3000 ms at 100 concurrent tasks.**

| Scenario | Requests | 200 | 409 | Integrity | p50 | p95 | p99 |
|---|---|---|---|---|---|---|---|
| **A — Contention** (100 approves, same resource, same version) | 100 | 1 | 99 | final version = 2 ✔ | 31.93 ms | **31.94 ms** | 31.94 ms |
| **B — Throughput** (100 approves, 100 distinct resources) | 100 | 100 | 0 | all final versions = 2 ✔ | 13.67 ms | **13.77 ms** | 13.77 ms |

Repeated runs (5×): scenario A p95 ranged **29.66–149.28 ms**, scenario B **13.53–63.16 ms** —
all far below 3.0 s, with integrity true in every run.

**Honest limitation:** this is an **in-memory, single-process** result. It validates the service
contract (one winner, correct final version, no lost update) but is **not** a production SLA and
says nothing about network, database, or multi-instance contention.

---

## 8. Traceability matrix

| AC / Risk | Test | Test file | Commit | Result |
|---|---|---|---|---|
| AC-01 Read | TC01 | `apps/api/test/reviewer-approval.spec.ts` | `bccd603` | PASS |
| AC-02 Approve | TC02 | same | `eb2cd62` | PASS |
| AC-03 No edit/delete | TC03, TC04 | same | `eb2cd62` | PASS |
| AC-03 negative | TC05, TC06 | same | `eb2cd62` | PASS |
| AC-04 Concurrency | TC07, TC08 | same | `eb2cd62` | PASS |
| AC-05 Idempotency | TC09, TC10 | same | `9123a4d` | PASS |
| Failure path | TC11, TC12 | same | `9123a4d`/`bccd603` | PASS |
| NFR performance | PERF-100 | `scripts/vt087-load-test.mjs` | `9123a4d` | p95 ≤ 3.0 s ✔ |
| Mutation (idempotency) | TC09 | same | `b2aac28` | FAIL (caught) |
| Mutation (concurrency) | TC07, TC08 | same | `00fb874` | FAIL (caught) |

---

## 9. AI Usage Log

| ID | Tool | Prompt intent | Output used | Changed / rejected | Evidence |
|---|---|---|---|---|---|
| AI01 | Coding agent | analyse repository, plan slice | architecture + file list | rejected "frontend-only role" and "status check is enough" | §2.3 |
| AI02 | Coding agent | generate tests | TC01–TC12 | added barrier + data-unchanged assertions | §2.5 |
| AI03 | Coding agent | implement patch | service/controller/router diff | reviewed full diff; made role optional | commit `eb2cd62` |
| AI04 | AI self-review | review patch after tests | review comments | classified correct vs. unproven | §2.4 |

---

## 10. Reflection (≈300 words)

My confidence rose most when the tests failed for the *right* reasons before the patch and passed
for the right reasons after it. Six tests failed on the clean baseline with causes that mapped
one-to-one to missing behaviour — no route, no RBAC gate, no content gate, no idempotency guard —
and each turned green only after the corresponding production code existed. That is stronger
evidence than a suite that was written against already-working code.

The most valuable test was TC08, the two-request race on the same version. It forced me to reason
about what "correct" means under concurrency: not just counting responses, but asserting that
exactly one request won, one received `409`, and the final version was exactly 2. TC09 then showed
that a retry must be idempotent rather than merely conflicting. The mutation experiment was the
decisive check: removing the idempotency guard broke TC09, and removing the concurrency guard
broke TC07 and TC08. Because the suite catches the exact bug class it was designed for, I trust it
more than the raw coverage number.

Coverage told me *where* the suite is thin (the controller's `switch` arms) but not whether the
suite is good; the mutation result is what actually justifies the claim. The AI's correct comment —
that authorization must live in the backend — was confirmed by reading the shared policy, while its
"thread-safe" claim was rightly treated as unproven until a concurrent test existed.

What remains unproven: the load result is an in-memory, single-process simulation. It validates the
contract but not production behaviour under a real database, network latency, or multiple server
instances. The highest-value next test would be to run the same 100-task harness against the
PostgreSQL adapter with a real database, and to add a multi-instance test so the atomic CAS is
verified where it actually matters. I would also close the controller's uncovered `400`/`403`
approve branches, which are reachable only with malformed or role-less requests.

---

## Appendix A — Reproduction commands

```bash
npm install
npm run verify                 # 35 tests
npm run test:vt087             # 12 tests
npm run test:vt087:load        # PERF-100 JSON
```

## Appendix B — Commit history

```
bccd603 test(vt-087): add TC12 not-found path + tighten req() types
9123a4d test(vt-087): add TC10/TC11 risk tests + 100-task load harness
eb2cd62 feat(vt-087): reviewer approval with OCC + idempotency guard
3281ebe test(vt-087): add reviewer-approval vertical-slice tests (RED)
a88aac2 (baseline) Merge pull request #28 ...
```

Mutation branch: `b2aac28` (A), `00fb874` (B) — not merged.
