#!/usr/bin/env node
/**
 * VT-085 load check: 80 concurrent users/tasks against the REAL Node HTTP server (apps/api/src/server.ts),
 * target p95 <= 2500 ms per request.
 *
 *  S1  80 users concurrently DELETE their own annotation (3 comments each) and then UNDO it.
 *      Checks: every restore returns the exact pre-delete snapshot (version +1) → 0 data loss.
 *  S2  80 concurrent restore attempts with ONE token on ONE deleted annotation.
 *      Checks: exactly 1 × 200, 79 × 404 (at-most-once).
 *  S3  80 concurrent restores with empty/blank/malformed bodies.
 *      Checks: all 400 and the tombstones still restore afterwards (boundary data never consumes undo).
 * S1 is repeated ROUNDS times so p95 is not taken from one lucky run.
 *
 * Usage: node scripts/vt085-load-test.mjs [--rounds=5] [--json=path]
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { startSpriterHttpServer } from '../apps/api/src/server.ts';

const USERS = 80;
const P95_TARGET_MS = 2500;
const ROUNDS = Number(process.argv.find((a) => a.startsWith('--rounds='))?.split('=')[1] ?? 5);
const JSON_OUT = process.argv.find((a) => a.startsWith('--json='))?.split('=')[1];
const MODEL = 'model-gltf-01';

const origLog = console.log;
console.log = () => {}; // silence the server banner
const { server, app } = startSpriterHttpServer(0);
await new Promise((r) => server.once('listening', r));
console.log = origLog;
const BASE = `http://127.0.0.1:${server.address().port}`;

const users = Array.from({ length: USERS }, (_, i) => ({
  id: `load-user-${String(i).padStart(2, '0')}`,
  email: `load${i}@spriter.local`,
  name: `Load User ${i}`,
  role: 'REVIEWER',
}));
const lead = { id: 'user-lead-nekover2', email: 'lead@spriter.local', name: 'Lead', role: 'PROJECT_LEAD' };
const bearer = (u) => `Bearer ${app.authService.signAccessToken(u)}`;

async function call(method, path, user, body) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { authorization: bearer(user), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json, ms: performance.now() - t0 };
}

async function seedAnnotationFor(user, i) {
  const created = await call('POST', `/api/v1/models/${MODEL}/annotations`, user, {
    position: [0, i * 0.01, 0],
    normal: [0, 0, -1],
    cameraState: { position: [0, 0, 0], target: [0, 0, 0] },
    initialComment: `Ghi chú review số ${i} — khe hở mép trước.`,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await call('POST', `/api/v1/annotations/${created.body.id}/comments`, user, { content: 'OK' });
  const last = await call('POST', `/api/v1/annotations/${created.body.id}/comments`, user, { content: 'Fixed: 10c' });
  return last.body; // snapshot v3 with 3 comments
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
function stats(latencies) {
  const s = [...latencies].sort((a, b) => a - b);
  return { n: s.length, p50: pct(s, 0.5), p95: pct(s, 0.95), p99: pct(s, 0.99), max: s[s.length - 1] };
}
const strip = ({ version, updatedAt, ...rest }) => rest;

const report = { users: USERS, p95TargetMs: P95_TARGET_MS, rounds: [], s2: null, s3: null };
const allLatencies = [];

// ---------------- S1 ----------------
for (let round = 1; round <= ROUNDS; round++) {
  const before = await Promise.all(users.map((u, i) => seedAnnotationFor(u, round * 100 + i)));
  const wallT0 = performance.now();
  const flows = await Promise.all(
    users.map(async (u, i) => {
      const del = await call('DELETE', `/api/v1/annotations/${before[i].id}`, u);
      const res = await call('POST', `/api/v1/annotations/${before[i].id}/restore`, u, { undoToken: del.body.undoToken });
      return { del, res, before: before[i] };
    }),
  );
  const wallMs = performance.now() - wallT0;
  let dataLoss = 0;
  for (const f of flows) {
    assert.equal(f.del.status, 200);
    assert.equal(f.res.status, 200, JSON.stringify(f.res.body));
    const intact =
      f.res.body.version === f.before.version + 1 &&
      JSON.stringify(strip(f.res.body)) === JSON.stringify(strip(f.before));
    if (!intact) dataLoss++;
  }
  const lat = flows.flatMap((f) => [f.del.ms, f.res.ms]);
  allLatencies.push(...lat);
  const r = { round, requests: lat.length, wallMs, dataLoss, ...stats(lat) };
  report.rounds.push(r);
  console.log(`S1 round ${round}: ${lat.length} req, wall ${wallMs.toFixed(1)} ms, p50 ${r.p50.toFixed(1)} / p95 ${r.p95.toFixed(1)} / p99 ${r.p99.toFixed(1)} / max ${r.max.toFixed(1)} ms, dataLoss=${dataLoss}`);
  assert.equal(dataLoss, 0, 'every restore must equal the pre-delete snapshot');
}

// ---------------- S2 ----------------
{
  const target = await seedAnnotationFor(lead, 9999);
  const del = await call('DELETE', `/api/v1/annotations/${target.id}`, lead);
  const results = await Promise.all(
    Array.from({ length: USERS }, () => call('POST', `/api/v1/annotations/${target.id}/restore`, lead, { undoToken: del.body.undoToken })),
  );
  const ok = results.filter((r) => r.status === 200).length;
  const notAvail = results.filter((r) => r.status === 404 && r.body.errorCode === 'UNDO_NOT_AVAILABLE').length;
  report.s2 = { ok200: ok, notAvailable404: notAvail, ...stats(results.map((r) => r.ms)) };
  console.log(`S2 contention: 200=${ok} 404=${notAvail} p95 ${report.s2.p95.toFixed(1)} ms`);
  assert.equal(ok, 1);
  assert.equal(notAvail, USERS - 1);
  allLatencies.push(...results.map((r) => r.ms));
}

// ---------------- S3 ----------------
{
  const badBodies = [undefined, null, [], {}, { undoToken: '' }, { undoToken: '   ' }, { undoToken: 123 }, { undoToken: 'A'.repeat(32) }];
  const seeded = await Promise.all(users.map((u, i) => seedAnnotationFor(u, 5000 + i)));
  const tokens = await Promise.all(users.map(async (u, i) => (await call('DELETE', `/api/v1/annotations/${seeded[i].id}`, u)).body.undoToken));
  const bad = await Promise.all(users.map((u, i) => call('POST', `/api/v1/annotations/${seeded[i].id}/restore`, u, badBodies[i % badBodies.length])));
  const all400 = bad.every((r) => r.status === 400 && r.body.errorCode === 'VALIDATION_FAILED');
  const good = await Promise.all(users.map((u, i) => call('POST', `/api/v1/annotations/${seeded[i].id}/restore`, u, { undoToken: tokens[i] })));
  const survived = good.filter((r) => r.status === 200).length;
  report.s3 = { rejected400: bad.filter((r) => r.status === 400).length, tombstonesSurvived: survived, ...stats(bad.map((r) => r.ms)) };
  console.log(`S3 boundary bodies: 400=${report.s3.rejected400}/${USERS}, tombstones still restorable=${survived}/${USERS}, p95 ${report.s3.p95.toFixed(1)} ms`);
  assert.ok(all400);
  assert.equal(survived, USERS);
  allLatencies.push(...bad.map((r) => r.ms), ...good.map((r) => r.ms));
}

report.overall = stats(allLatencies);
console.log(`OVERALL ${report.overall.n} requests: p50 ${report.overall.p50.toFixed(1)} / p95 ${report.overall.p95.toFixed(1)} / p99 ${report.overall.p99.toFixed(1)} / max ${report.overall.max.toFixed(1)} ms (target p95 <= ${P95_TARGET_MS} ms) → ${report.overall.p95 <= P95_TARGET_MS ? 'PASS' : 'FAIL'}`);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
server.close();
assert.ok(report.overall.p95 <= P95_TARGET_MS);
