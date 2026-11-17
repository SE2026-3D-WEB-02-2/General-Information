#!/usr/bin/env node
/**
 * VT-087 — 100 concurrent approves over a REAL HTTP socket (node:http server + fetch).
 *
 * Complements scripts/vt087-load-test.mjs (in-process). Here every request goes through
 * TCP, JSON parsing, the auth middleware and the Idempotency-Key header path.
 *   A) CONTENTION : 100 approves, SAME annotation, expectedVersion=1, distinct keys
 *                   -> expect exactly 1x200 + 99x409, final version 2.
 *   B) THROUGHPUT : 100 approves on 100 DISTINCT annotations -> expect 100x200.
 *   C) RETRY STORM: 100 approves, SAME annotation, SAME key  -> expect 100x200, version 2.
 * Each scenario is repeated ROUNDS times so p95 is computed over many samples.
 * SLA target: p95 <= 3000 ms. Still a laptop + in-memory store: NOT a production SLA.
 */
import { performance } from 'node:perf_hooks';
import { createHmac } from 'node:crypto';
import { startSpriterHttpServer } from '../apps/api/src/server.ts';

const N = 100;
const ROUNDS = Number(process.env.ROUNDS ?? 5);
const P95_TARGET_MS = 3000;

function token() {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const b = Buffer.from(
    JSON.stringify({ sub: 'user-3d-huy', email: 'huy@spriter.local', name: 'Reviewer', role: 'REVIEWER', iat: now, exp: now + 3600 }),
  ).toString('base64url');
  const s = createHmac('sha256', process.env.JWT_SECRET ?? 'spriter-dev-hmac-secret-2026').update(`${h}.${b}`).digest('base64url');
  return `Bearer ${h}.${b}.${s}`;
}

function seed(app, id) {
  app.annotationRepo.seedModel({ id: 'model-gltf-01', name: 'turbine_housing_v1.glb', fileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
  const ts = new Date().toISOString();
  app.annotationRepo.seedRecord({
    id, model_id: 'model-gltf-01', author_id: 'user-author', status: 'OPEN', version: 1,
    position: [1, 0.9, -0.4], normal: [0, 1, 0], camera_state: { position: [3.5, 2.1, 4], target: [1, 0.9, -0.4] },
    mesh_name: 'Front_Housing_Flange', created_at: ts, updated_at: ts,
    // Resolving requires >= 1 comment of >= 10 chars (MISSING_RESOLUTION_COMMENT otherwise).
    comments: [{ id: `c-${id}`, authorId: 'user-author', content: 'Check opening gap at front flange.', createdAt: ts, annotationId: id }],
  });
}

function pct(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}
function summarize(lat) {
  const s = [...lat].sort((a, b) => a - b);
  const r = (x) => Number(x.toFixed(2));
  return { count: s.length, p50: r(pct(s, 0.5)), p95: r(pct(s, 0.95)), p99: r(pct(s, 0.99)), max: r(s[s.length - 1]) };
}

async function burst(base, auth, targets) {
  // targets: [{ id, key }] — all fired at once, each request timed individually.
  return Promise.all(
    targets.map(async ({ id, key }) => {
      const t0 = performance.now();
      const res = await fetch(`${base}/api/v1/annotations/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: auth, 'Idempotency-Key': key },
        body: JSON.stringify({ expectedVersion: 1 }),
      });
      await res.arrayBuffer();
      return { status: res.status, ms: performance.now() - t0 };
    }),
  );
}

async function main() {
  const { server, app } = startSpriterHttpServer(0);
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = token();
  const out = { environment: 'node:http on localhost + in-memory store (simulated)', concurrentTasks: N, rounds: ROUNDS, p95TargetMs: P95_TARGET_MS };
  const scen = { A_contention: { lat: [], ok: true }, B_throughput: { lat: [], ok: true }, C_retry_same_key: { lat: [], ok: true } };

  for (let round = 0; round < ROUNDS; round++) {
    const hot = `hot-${round}`;
    seed(app, hot);
    const a = await burst(base, auth, Array.from({ length: N }, (_, i) => ({ id: hot, key: `a-${round}-${i}` })));
    const a200 = a.filter((x) => x.status === 200).length;
    const a409 = a.filter((x) => x.status === 409).length;
    scen.A_contention.ok &&= a200 === 1 && a409 === N - 1 && (await app.annotationRepo.findById(hot)).version === 2;
    scen.A_contention.lat.push(...a.map((x) => x.ms));

    const ids = Array.from({ length: N }, (_, i) => `tp-${round}-${i}`);
    ids.forEach((id) => seed(app, id));
    const b = await burst(base, auth, ids.map((id, i) => ({ id, key: `b-${round}-${i}` })));
    const versions = await Promise.all(ids.map(async (id) => (await app.annotationRepo.findById(id)).version));
    scen.B_throughput.ok &&= b.every((x) => x.status === 200) && versions.every((v) => v === 2);
    scen.B_throughput.lat.push(...b.map((x) => x.ms));

    const retry = `retry-${round}`;
    seed(app, retry);
    const c = await burst(base, auth, Array.from({ length: N }, () => ({ id: retry, key: `c-${round}` })));
    const cStatuses = [...new Set(c.map((x) => x.status))];
    const cVersion = (await app.annotationRepo.findById(retry)).version;
    scen.C_retry_same_key.ok &&= cVersion === 2;
    scen.C_retry_same_key.statuses = cStatuses;
    scen.C_retry_same_key.lat.push(...c.map((x) => x.ms));
  }

  for (const [name, s] of Object.entries(scen)) {
    const lat = summarize(s.lat);
    out[name] = { integrityOk: s.ok, ...(s.statuses ? { statusesSeen: s.statuses } : {}), latencyMs: lat, meetsP95Target: lat.p95 <= P95_TARGET_MS };
  }
  console.log(JSON.stringify(out, null, 2));
  await new Promise((r) => server.close(r));
  const allOk = Object.values(scen).every((s) => s.ok);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
