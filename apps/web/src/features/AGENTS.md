# Scoped Agent Rules — Stream C (`apps/web/src/features/`)

1. **Owner:** Stream C (Collaboration UI, Thread Controller & Adapters Owner).
2. **Task Spec:** Always read `/docs/tasks/STREAM_C_COLLAB_UI.md` (`C1–C9`) and `/docs/contracts/DATA_AND_EVENTS.md`.
3. **Boundary & Testability Rules (`R4`, `R5`, `R6`):**
   - **No Three.js (`R5`):** Never import `three` or `@react-three/*` inside `src/features/**` or `src/adapters/**`. Interact with the 3D scene only via `ViewportBridge` (`src/viewport/bridge.ts`).
   - **No Duplicated Business Rules (`R6`):** Delegate all status transition and spatial lock checks to `evaluateAnnotationMutation` from `@spriter/shared`.
   - **OCC & Realtime Safety:** Always send `expectedVersion` when patching annotations, preserve user drafts on `409 CONCURRENCY_CONFLICT`, and guard incoming events via `shouldApplyIncomingSnapshot` / `classifyRealtimeVersionStep`.
4. **Verification:** Run `npm run test:web && npm run verify`.
