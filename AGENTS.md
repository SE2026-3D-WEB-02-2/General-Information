# Spriter 3D Design Review — AI Agent Master Instructions

> **MANDATORY FOR ALL AI AGENTS (Antigravity/Gemini, Claude Code, Cursor, Copilot):**
> Read this file first before modifying any code in this repository.

## 1. System Architecture & Non-Negotiable Invariants
Spriter is a multi-user 3D glTF design review system built as an **`npm workspaces` Modular Monolith with Hexagonal Boundaries and Optimistic Concurrency Control (OCC)**:
- **Shared Contracts & Pure Policy (`@spriter/shared` -> `packages/shared/`):** Single Source of Truth for all DTOs, `ViewportBridge`, `ServerRealtimeEvent`, `ExportFileV1`, and `evaluateAnnotationMutation()`.
- **Backend API & Realtime (`@spriter/api` -> `apps/api/`):** Authoritative owner of `Annotation` state, OCC `expectedVersion` checks (`409 CONCURRENCY_CONFLICT`), spatial lock invariant (`422 SPATIAL_LOCKED_WHEN_RESOLVED`), and 7-day operational audit logs (`OPERATIONAL_LOG_TTL_DAYS = 7`).
- **Web Client (`@spriter/web` -> `apps/web/`):** Strictly separated into `src/viewport/` (3D Three.js/R3F canvas), `src/features/` (2D Collaboration UI & headless controllers), `src/adapters/` (HTTP/Socket/Fake ports), and `src/app/` (Workspace Store composition root).

## 2. Role & Task Routing for the 3-Person Team
When the user asks you to work on a task or feature, immediately read the corresponding stream file:
1. **Stream A (Tech Lead — Backend, Realtime, DB, Infra, Tasks `A1–A10`):**
   - Read: `docs/tasks/STREAM_A_BACKEND.md` and `apps/api/AGENTS.md`
   - Write Scope: `apps/api/**`, `infra/**`, `scripts/**`, `.github/**`, `apps/web/src/app/**`
2. **Stream B (3D Viewport & Raycast Owner, Tasks `B1–B8`):**
   - Read: `docs/tasks/STREAM_B_3D_VIEWPORT.md` and `apps/web/src/viewport/AGENTS.md`
   - Write Scope: `apps/web/src/viewport/**` (do not change `bridge.ts` signature without team approval)
3. **Stream C (2D Collaboration UI & Adapters Owner, Tasks `C1–C9`):**
   - Read: `docs/tasks/STREAM_C_COLLAB_UI.md` and `apps/web/src/features/AGENTS.md`
   - Write Scope: `apps/web/src/features/**`, `apps/web/src/adapters/**`
4. **Shared Data & Event Contracts:**
   - Read: `docs/contracts/DATA_AND_EVENTS.md` and `packages/shared/AGENTS.md`

## 3. Six Enforced Architectural Rules (`npm run arch:check`)
Your changes WILL FAIL CI if you violate any of these rules:
- **`R1 (shared-is-pure)`:** `packages/shared/**` must have zero external runtime dependencies and must never import from `apps/*`, `three`, or `react`.
- **`R2 (no-cross-app)`:** `apps/web/**` and `apps/api/**` must never import directly from each other; share via `@spriter/shared`.
- **`R3 (domain-is-pure)`:** `apps/api/src/modules/*/domain/**` must never import HTTP controllers or infrastructure drivers directly; use `ports.ts`.
- **`R4 (viewport-features-isolated)`:** `apps/web/src/viewport/**` and `apps/web/src/features/**` must never import each other directly; communicate exclusively via `apps/web/src/viewport/bridge.ts`.
- **`R5 (no-three-in-features)`:** `apps/web/src/features/**` and `apps/web/src/adapters/**` must NEVER import `three` or `@react-three/*`.
- **`R6 (single-source-business-rules)`:** Never duplicate status transition rules, minimum comment length (`10`), or normal vector math outside `packages/shared/src/domain/annotation-policy.ts`.

## 4. Mandatory Verification Gate Before Completing Any Task
Before reporting completion of any task, you MUST run:
```bash
npm run verify
```
(`npm run verify` executes `npm run arch:check && npm test` across `@spriter/shared`, `@spriter/api`, and `@spriter/web`).
