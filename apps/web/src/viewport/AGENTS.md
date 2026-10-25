# Scoped Agent Rules — Stream B (`apps/web/src/viewport/`)

1. **Owner:** Stream B (3D glTF Viewport & Raycast Owner).
2. **Task Spec:** Always read `/docs/tasks/STREAM_B_3D_VIEWPORT.md` (`B1–B8`) and `/docs/contracts/DATA_AND_EVENTS.md`.
3. **Isolation Rule (`R4`):**
   - Never import from `apps/web/src/features/**` or `apps/api/**`.
   - Communicate with the 2D UI and Store exclusively through `ViewportBridge` (`apps/web/src/viewport/bridge.ts`).
   - Never mutate original mesh vertex coordinates when framing the camera; always emit raycast `SurfacePick` in **Model-Local Space** with unit-length normal (`validateUnitNormal(normal) === true`).
4. **Verification:** Run `npm run test:web && npm run verify`.
