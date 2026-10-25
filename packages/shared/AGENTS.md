# Scoped Agent Rules — `@spriter/shared` (`packages/shared/`)

1. **Purpose:** Authoritative Single Source of Truth for pure domain policies (`annotation-policy.ts`) and data/event contracts (`api-contracts.ts`, `realtime-contracts.ts`, `viewport-bridge.ts`).
2. **Purity Rule (`R1`):** Zero external runtime dependencies. Never import from `apps/api`, `apps/web`, `three`, `react`, or `node:http`.
3. **Change Governance:** Any breaking change to exported types requires updating `CONTRACT_VERSION` in `src/domain/annotation-policy.ts` and `docs/contracts/DATA_AND_EVENTS.md`.
4. **Verification:** Run `npm run test:shared && npm run arch:check`.
