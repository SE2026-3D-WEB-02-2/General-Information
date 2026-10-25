# Scoped Agent Rules — Stream A (`@spriter/api` / `apps/api/`)

1. **Owner:** Stream A (Tech Lead — Backend, Realtime, DB, Infrastructure).
2. **Task Spec:** Always read `/docs/tasks/STREAM_A_BACKEND.md` (`A1–A10`) and `/docs/contracts/DATA_AND_EVENTS.md`.
3. **Hexagonal Boundary (`R3`):**
   - `src/modules/*/domain/**` owns OCC concurrency checks (`expectedVersion`), calls `evaluateAnnotationMutation` from `@spriter/shared`, and enforces `OPERATIONAL_LOG_TTL_DAYS = 7`. It must only depend on `ports.ts` and `@spriter/shared`.
   - `src/modules/*/http/**` is a thin transport adapter mapping domain outcomes to `200`, `201`, `400`, `404`, `409`, `422`.
   - `src/modules/*/adapters/**` implements `AnnotationRepositoryPort` and `RealtimePublisherPort`.
4. **Verification:** Run `npm run test:api && npm run verify`.
