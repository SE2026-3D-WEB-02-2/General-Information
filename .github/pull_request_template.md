## Task & Stream Identification
- **Stream:** `[ ] Stream A (Backend/Realtime)` | `[ ] Stream B (3D Viewport)` | `[ ] Stream C (Collab UI)` | `[ ] Shared Contract`
- **Task ID / GitHub Issue:** `Closes #...` (e.g. `[A2]`, `[B2]`, `[C3]`)

## Verification Gate Checklist (D1–D6)
- [ ] **D1 (Write Scope):** Modified files stay strictly within this stream's owned directories (`git status --short`).
- [ ] **D2 (Architecture Guardrails):** `npm run arch:check` passes with 0 violations of Rules `R1–R6`.
- [ ] **D3 (Single Source of Business Rules):** No status transition or spatial math logic duplicated outside `@spriter/shared`.
- [ ] **D4 (Contract Compliance):** All API/Realtime/Export payloads conform to `docs/contracts/DATA_AND_EVENTS.md`.
- [ ] **D5 (Automated Tests):** Added/updated unit or boundary tests for this task.
- [ ] **D6 (One-Command Verify):** `npm run verify` passes locally and on CI.

## Verification Output
```text
Paste output of `npm run verify` here
```
