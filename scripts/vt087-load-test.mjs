#!/usr/bin/env node
/**
 * VT-087 Reviewer Approval — 100 Concurrent Tasks Load & Latency Benchmark
 *
 * Two distinct experiments (they measure different things and are NOT interchangeable):
 *   A) CONTENTION : 100 simultaneous approves on the SAME annotation + same expectedVersion.
 *                   Expect exactly 1 success (200) and 99 conflicts (409); final version == 2.
 *   B) THROUGHPUT : 100 simultaneous approves spread over 100 DISTINCT annotations.
 *                   Expect 100 successes (200); every final version == 2.
 *
 * SLA target: p95 <= 3000 ms (3.0 s) at 100 concurrent tasks.
 * Environment: in-process Hexagonal backend with the default in-memory store.
 *   -> This is a simulated-environment result, NOT a production SLA.
 */
import { performance } from 'node:perf_hooks';
import { SpriterApiApplication } from '../apps/api/src/http/app-router.ts';

const CONCURRENT_TASKS = 100;
const P95_TARGET_MS = 3000;

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function summarize(latenciesMs) {
  const s = [...latenciesMs].sort((a, b) => a - b);
  return {
    count: s.length,
    p50: Number(percentile(s, 0.5).toFixed(2)),
    p95: Number(percentile(s, 0.95).toFixed(2)),
    p99: Number(percentile(s, 0.99).toFixed(2)),
    max: Number(s[s.length - 1].toFixed(2)),
  };
}

/** Barrier: build all tasks first, then release them at the same instant. */
function makeBarrier(n) {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const entries = Array.from({ length: n }, () => {
    const promise = gate.then(() => performance.now());
    return { promise };
  });
  return { entries, release };
}

async function loginReviewer(app) {
  const res = await app.handleRequest({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: { email: 'huy@spriter.local', password: 'Spriter3D#2026' },
  });
  if (res.statusCode !== 200) throw new Error(`reviewer login failed: ${res.statusCode}`);
  return `Bearer ${res.body.accessToken}`;
}

async function seedAnnotation(app, token, i) {
  const res = await app.handleRequest({
    method: 'POST',
    path: '/api/v1/models/model-gltf-01/annotations',
    headers: { authorization: token },
    body: {
      position: [i * 0.1, 1.0, 0.0],
      normal: [0, 1, 0],
      cameraState: { position: [0, 2, 5], target: [i * 0.1, 1.0, 0.0] },
      initialComment: `VT-087 load-test review pin #${i + 1} with sufficient detail.`,
    },
  });
  if (res.statusCode !== 201) throw new Error(`seed #${i} failed: ${res.statusCode}`);
  return res.body.id;
}

async function main() {
  const app = new SpriterApiApplication();
  const token = await loginReviewer(app);

  // ---- Scenario A: 100 approves on the SAME annotation (contention) ----
  const hotId = await seedAnnotation(app, token, 0);
  const barrierA = makeBarrier(CONCURRENT_TASKS);
  const latA = [];
  const tasksA = barrierA.entries.map(({ promise }, idx) =>
    promise.then((start) =>
      app
        .handleRequest({
          method: 'POST',
          path: `/api/v1/annotations/${hotId}/approve`,
          headers: { authorization: token, idempotencyKey: `contention-${idx}` },
          body: { expectedVersion: 1 },
        })
        .then((res) => {
          latA.push(performance.now() - start);
          return res.statusCode;
        }),
    ),
  );
  const wallA0 = performance.now();
  barrierA.release();
  const codesA = await Promise.all(tasksA);
  const wallA = performance.now() - wallA0;
  const okA = codesA.filter((c) => c === 200).length;
  const conflictA = codesA.filter((c) => c === 409).length;
  const otherA = CONCURRENT_TASKS - okA - conflictA;
  const finalA = (await app.annotationRepo.findById(hotId)).version;

  // ---- Scenario B: 100 approves across 100 DISTINCT annotations (throughput) ----
  const ids = [];
  for (let i = 0; i < CONCURRENT_TASKS; i++) ids.push(await seedAnnotation(app, token, i + 1));
  const barrierB = makeBarrier(CONCURRENT_TASKS);
  const latB = [];
  const tasksB = barrierB.entries.map(({ promise }, idx) =>
    promise.then((start) =>
      app
        .handleRequest({
          method: 'POST',
          path: `/api/v1/annotations/${ids[idx]}/approve`,
          headers: { authorization: token, idempotencyKey: `throughput-${idx}` },
          body: { expectedVersion: 1 },
        })
        .then((res) => {
          latB.push(performance.now() - start);
          return res.statusCode;
        }),
    ),
  );
  const wallB0 = performance.now();
  barrierB.release();
  const codesB = await Promise.all(tasksB);
  const wallB = performance.now() - wallB0;
  const okB = codesB.filter((c) => c === 200).length;
  const conflictB = codesB.filter((c) => c === 409).length;
  const otherB = CONCURRENT_TASKS - okB - conflictB;
  const versionsB = [];
  for (const id of ids) versionsB.push((await app.annotationRepo.findById(id)).version);
  const allV2 = versionsB.every((v) => v === 2);

  const report = {
    environment: 'in-process Hexagonal backend, in-memory store (simulated, not production)',
    concurrentTasks: CONCURRENT_TASKS,
    p95TargetMs: P95_TARGET_MS,
    scenarioA_contention: {
      description: '100 approves, SAME annotation, same expectedVersion=1',
      http200: okA,
      http409: conflictA,
      other: otherA,
      finalVersion: finalA,
      integrityOk: okA === 1 && conflictA === CONCURRENT_TASKS - 1 && finalA === 2,
      latencyMs: summarize(latA),
      wallMs: Number(wallA.toFixed(2)),
    },
    scenarioB_throughput: {
      description: '100 approves, 100 DISTINCT annotations, expectedVersion=1',
      http200: okB,
      http409: conflictB,
      other: otherB,
      allFinalVersionsAre2: allV2,
      integrityOk: okB === CONCURRENT_TASKS && allV2,
      latencyMs: summarize(latB),
      wallMs: Number(wallB.toFixed(2)),
    },
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
