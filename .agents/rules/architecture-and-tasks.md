---
trigger: always_on
description: Enforce Spriter 3D Design Review architecture boundaries, task routing for Streams A/B/C, and mandatory verification gates.
---

# Spriter Workspace Architecture & Agent Rules

1. Always consult `/AGENTS.md` and `/docs/contracts/DATA_AND_EVENTS.md` for authoritative data contracts, state transition matrix, OCC concurrency rules, and Socket.io event schemas.
2. Respect the 3 parallel development streams:
   - **Stream A (Backend & Realtime):** `docs/tasks/STREAM_A_BACKEND.md` (`apps/api/**`)
   - **Stream B (3D Viewport & Raycast):** `docs/tasks/STREAM_B_3D_VIEWPORT.md` (`apps/web/src/viewport/**`)
   - **Stream C (2D Collaboration UI & Adapters):** `docs/tasks/STREAM_C_COLLAB_UI.md` (`apps/web/src/features/**`, `apps/web/src/adapters/**`)
3. Run `npm run verify` (`npm run arch:check && npm test`) after any code change.
