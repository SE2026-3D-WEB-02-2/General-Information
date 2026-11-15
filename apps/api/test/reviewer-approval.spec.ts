import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHmac } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { startSpriterHttpServer } from '../src/server.ts';
import { SpriterApiApplication } from '../src/http/app-router.ts';
import { AnnotationService } from '../src/modules/annotations/domain/annotation.service.ts';
import { InMemoryAnnotationRepository } from '../src/modules/annotations/adapters/in-memory.repository.ts';
import type { AnnotationDomainSnapshot } from '@spriter/shared';
import { canActorModifyAnnotation, ALLOWED_TRANSITIONS } from '@spriter/shared';

// ---------------------------------------------------------------------------
// VT-087 reviewer-approval vertical slice.
// Exercises the real in-process Hexagonal backend (no HTTP server, no browser).
// A fake clock keeps every run deterministic.
// ---------------------------------------------------------------------------
const TS = '2026-10-24T09:00:00.000Z';

function signToken(payload, secret = 'spriter-dev-hmac-secret-2026') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const issuedAt = Math.floor(new Date(TS).getTime() / 1000);
  const body = { ...payload, iat: issuedAt, exp: issuedAt + 86400 };
  const payloadB64 = Buffer.from(JSON.stringify(body)).toString('base64url');
  const sig = createHmac('sha256', secret).update(`${header}.${payloadB64}`).digest('base64url');
  return `${header}.${payloadB64}.${sig}`;
}

const REVIEWER = signToken({ id: 'user-3d-huy', email: 'huy@spriter.local', name: 'Hoàng Đức Huy', role: 'REVIEWER' });
const MEMBER_TOKEN = signToken({ id: 'user-member', email: 'member@spriter.local', name: 'Member', role: 'MEMBER' });
const NO_TOKEN = '';

function seedModel(app) {
  const model = { id: 'model-gltf-01', name: 'turbine_housing_v1.glb', fileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' };
  app.annotationRepo.seedModel(model);
}

function seedAnnotation(app, ann = {}) {
  seedModel(app);
  const record = {
    id: ann.id ?? 'ann-review-1',
    model_id: 'model-gltf-01',
    author_id: 'user-author',
    status: 'OPEN',
    version: 1,
    position: [1.0, 0.9, -0.4],
    normal: [0.0, 1.0, 0.0],
    camera_state: { position: [3.5, 2.1, 4], target: [1.0, 0.9, -0.4] },
    mesh_name: 'Front_Housing_Flange',
    comments: [{ id: 'c-1', authorId: 'user-author', content: 'Check opening gap at front flange.', createdAt: TS, annotationId: 'ann-review-1' }],
    created_at: TS,
    updated_at: TS,
    ...ann,
  };
  app.annotationRepo.seedRecord(record);
  return record.id;
}

function seedAnnotationViaRepo(repo, id = 'ann-review-1') {
  const record = {
    id,
    model_id: 'model-gltf-01',
    author_id: 'user-author',
    status: 'OPEN',
    version: 1,
    position: [1.0, 0.9, -0.4],
    normal: [0.0, 1.0, 0.0],
    camera_state: { position: [3.5, 2.1, 4], target: [1.0, 0.9, -0.4] },
    mesh_name: 'Front_Housing_Flange',
    comments: [{ id: 'c-1', authorId: 'user-author', content: 'Check opening gap at front flange.', createdAt: TS, annotationId: id }],
    created_at: TS,
    updated_at: TS,
  };
  repo.seedRecord(record);
  return id;
}

type ReqOpts = { auth?: string; idempotencyKey?: string; body?: unknown };
function req(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, { auth = REVIEWER, idempotencyKey, body }: ReqOpts = {}) {
  return {
    method,
    path,
    headers: {
      authorization: auth === NO_TOKEN ? NO_TOKEN : 'Bearer ' + auth,
      idempotencyKey,
    },
    body: body ?? undefined,
  };
}

describe('VT-087 Reviewer Approval — vertical slice', () => {
  it('TC01 READ — reviewer can list annotations (200, data present)', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    const res = await app.handleRequest(req('GET', '/api/v1/models/model-gltf-01/annotations'));
    assert.equal(res.statusCode, 200);
    assert.equal((res.body).items.length, 1);
    assert.equal((res.body).items[0].status, 'OPEN');
  });

  it('TC02 APPROVE — valid reviewer approval transitions to RESOLVED', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    const res = await app.handleRequest(req('POST', `/api/v1/annotations/${id}/approve`, {
      auth: REVIEWER, idempotencyKey: 'approve-k2', body: { expectedVersion: 1 },
    }));
    assert.equal(res.statusCode, 200);
    const s = (res.body).snapshot;
    assert.equal(s.status, 'RESOLVED');
    assert.equal(s.version, 2);
    assert.equal(s.id, id);
  });

  it('TC03 NO-EDIT — reviewer PATCH to position is FORBIDDEN (403) and data unchanged', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    const before = await app.annotationRepo.findById(id);
    const res = await app.handleRequest(req('PATCH', `/api/v1/annotations/${id}`, {
      auth: REVIEWER, body: { expectedVersion: 1, position: [9.9, 9.9, 9.9] },
    }));
    assert.equal(res.statusCode, 403);
    const after = await app.annotationRepo.findById(id);
    assert.equal(after.version, 1);
    assert.deepEqual(after.position, [1.0, 0.9, -0.4]);
  });

  it('TC04 NO-DELETE — reviewer DELETE is FORBIDDEN (403)', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    const res = await app.handleRequest(req('DELETE', `/api/v1/annotations/${id}`, { auth: REVIEWER }));
    assert.equal(res.statusCode, 403);
    assert.ok(await app.annotationRepo.findById(id));
  });

  it('TC05 MEMBER — non-privileged role cannot approve (403)', async () => {
    const repo = new InMemoryAnnotationRepository();
    seedAnnotationViaRepo(repo);
    const service = new AnnotationService(repo, { now: () => new Date(TS) });
    const id = seedAnnotationViaRepo(repo);
    const result = await service.approveAnnotation(id, 'member-1', { expectedVersion: 1, idempotencyKey: 'approve-k5' }, 'MEMBER');
    assert.equal(result.status, 'FORBIDDEN');
    assert.equal((await repo.findById(id)).version, 1);
  });

  it('TC06 UNAUTHORIZED — approve without a valid token is UNAUTHORIZED (401)', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    const res = await app.handleRequest(req('POST', `/api/v1/annotations/${id}/approve`, { auth: NO_TOKEN, idempotencyKey: 'approve-k6', body: { expectedVersion: 1 } }));
    assert.equal(res.statusCode, 401);
  });

  it('TC07 OLD-VERSION — stale-version approve is CONCURRENCY_CONFLICT (409), data untouched', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    const current = await app.annotationRepo.findById(id);
    const next = { ...current, version: 9, status: 'RESOLVED', updated_at: TS };
    app.annotationRepo.seedRecord(next);
    const res = await app.handleRequest(req('POST', `/api/v1/annotations/${id}/approve`, {
      auth: REVIEWER, idempotencyKey: 'approve-k7', body: { expectedVersion: 1 },
    }));
    assert.equal(res.statusCode, 409);
    const fresh = await app.annotationRepo.findById(id);
    assert.equal(fresh.version, 9);
    assert.equal(fresh.status, 'RESOLVED');
  });

  it('TC08 CONCURRENT — two simultaneous approves leave exactly one resolved', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    const hits = [];
    const p1 = app.handleRequest(req('POST', `/api/v1/annotations/${id}/approve`, {
      auth: REVIEWER, idempotencyKey: 'approve-k8-p1', body: { expectedVersion: 1 },
    })).then((r) => { hits.push(1); return r; });
    const p2 = app.handleRequest(req('POST', `/api/v1/annotations/${id}/approve`, {
      auth: REVIEWER, idempotencyKey: 'approve-k8-p2', body: { expectedVersion: 1 },
    })).then((r) => { hits.push(2); return r; });
    const [a, b] = await Promise.all([p1, p2]);
    const succeeded = [a, b].filter((r) => r.statusCode === 200);
    const conflicted = [a, b].filter((r) => r.statusCode === 409);
    assert.equal(succeeded.length, 1, `expected 1 success, got ${succeeded.length}`);
    assert.equal(conflicted.length, 1, `expected 1 conflict, got ${conflicted.length}`);
    const final = await app.annotationRepo.findById(id);
    assert.equal(final.version, 2);
    assert.equal(final.status, 'RESOLVED');
    assert.deepEqual(hits, [1, 2], 'both requests scheduled concurrently');
  });

  it('TC09 IDEMPOTENT — re-submitting the same approve key has no second side effect', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    const first = await app.handleRequest(req('POST', `/api/v1/annotations/${id}/approve`, {
      auth: REVIEWER, idempotencyKey: 'approve-k9', body: { expectedVersion: 1 },
    }));
    assert.equal(first.statusCode, 200);
    const versionAfterFirst = (await app.annotationRepo.findById(id)).version;
    const second = await app.handleRequest(req('POST', `/api/v1/annotations/${id}/approve`, {
      auth: REVIEWER, idempotencyKey: 'approve-k9', body: { expectedVersion: 1 },
    }));
    assert.equal(second.statusCode, 200);
    const fresh = await app.annotationRepo.findById(id);
    assert.equal(fresh.version, versionAfterFirst, 'no version increment on idempotent retry');
    assert.equal(fresh.status, 'RESOLVED');
  });

  it('TC10 MISSING-KEY — approve without an Idempotency-Key is rejected (422), no state change', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    const res = await app.handleRequest(req('POST', `/api/v1/annotations/${id}/approve`, {
      auth: REVIEWER, body: { expectedVersion: 1 },
    }));
    assert.equal(res.statusCode, 422);
    assert.equal((res.body as any).errorCode, 'MISSING_IDEMPOTENCY_KEY');
    const fresh = (await app.annotationRepo.findById(id))!;
    assert.equal(fresh.version, 1);
    assert.equal(fresh.status, 'OPEN');
  });

  it('TC11 STORE-FAILURE — a failing store propagates and leaves no partial state', async () => {
    const repo = new InMemoryAnnotationRepository();
    seedAnnotationViaRepo(repo);
    const failingRepo = {
      findById: (targetId: string) => repo.findById(targetId),
      appendAuditLog: () => {},
      updateIfVersion: async () => {
        throw new Error('store unavailable');
      },
    };
    const service = new AnnotationService(failingRepo as any, { now: () => new Date(TS) });
    await assert.rejects(
      () => service.approveAnnotation('ann-review-1', 'user-3d-huy', { expectedVersion: 1, idempotencyKey: 'approve-k11' }, 'REVIEWER'),
      /store unavailable/,
    );
    const rec = (await repo.findById('ann-review-1'))!;
    assert.equal(rec.version, 1, 'no partial commit');
    assert.equal(rec.status, 'OPEN', 'no partial state transition');
  });

  it('TC12 NOT-FOUND — approving a non-existent annotation returns 404', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const res = await app.handleRequest(req('POST', '/api/v1/annotations/ann-does-not-exist/approve', {
      auth: REVIEWER, idempotencyKey: 'approve-k12', body: { expectedVersion: 1 },
    }));
    assert.equal(res.statusCode, 404);
    assert.equal((res.body as any).errorCode, 'ANNOTATION_NOT_FOUND');
  });

  // ---- T2: additional reviewer-approval tests (see docs/T2 tests) ----

  it('TC13 MISSING-EXPECTED-VERSION — approve over HTTP without expectedVersion is 400 and leaves data unchanged', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    const res = await app.handleRequest(req('POST', `/api/v1/annotations/${id}/approve`, { auth: REVIEWER, body: {} }));
    assert.equal(res.statusCode, 400);
    assert.equal((res.body as any).errorCode, 'MISSING_EXPECTED_VERSION');
    const fresh = await app.annotationRepo.findById(id);
    assert.equal(fresh!.version, 1);
    assert.equal(fresh!.status, 'OPEN');
  });

  it('TC14 MEMBER-HTTP — non-privileged role over HTTP is rejected and leaves data unchanged', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    const res = await app.handleRequest(req('POST', `/api/v1/annotations/${id}/approve`, { auth: MEMBER_TOKEN, idempotencyKey: 'k14', body: { expectedVersion: 1 } }));
    assert.equal(res.statusCode, 403);
    const fresh = await app.annotationRepo.findById(id);
    assert.equal(fresh!.version, 1);
    assert.equal(fresh!.status, 'OPEN');
  });

  it('TC15 INVALID-STATE — approving an ARCHIVED annotation is not allowed (matches the shared policy source)', async () => {
    const repo = new InMemoryAnnotationRepository();
    const record: any = {
      id: 'ann-arch-1', model_id: 'model-gltf-01', author_id: 'user-author',
      status: 'ARCHIVED', version: 3, position: [1, 0, 0], normal: [0, 1, 0],
      camera_state: { position: [3.5, 2.1, 4], target: [1, 0, 0] }, mesh_name: 'X',
      comments: [{ id: 'c1', authorId: 'user-author', content: 'resolved', createdAt: TS, annotationId: 'ann-arch-1' }],
      created_at: TS, updated_at: TS,
    };
    repo.seedRecord(record);
    const svc = new AnnotationService(repo, { now: () => new Date(TS) });
    const res = await svc.approveAnnotation('ann-arch-1', 'user-3d-huy', { expectedVersion: 3, idempotencyKey: 'k15' }, 'REVIEWER');
    // Expected result must match the shared policy source (ALLOWED_TRANSITIONS has no ARCHIVED -> RESOLVED).
    assert.equal(res.status, 'INVARIANT_VIOLATED');
    assert.equal(res.reasonCode, 'ANNOTATION_ARCHIVED_IMMUTABLE');
    assert.equal((await repo.findById('ann-arch-1')).version, 3);
    assert.equal((await repo.findById('ann-arch-1')).status, 'ARCHIVED');
  });

  it('TC16 SAME-IDEMPOTENCY-KEY — same key for a DIFFERENT annotation: record actual behaviour', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const idA = seedAnnotation(app, { id: 'ann-a' });
    const idB = seedAnnotation(app, { id: 'ann-b' });
    const rA = await app.handleRequest(req('POST', `/api/v1/annotations/${idA}/approve`, { auth: REVIEWER, idempotencyKey: 'k16', body: { expectedVersion: 1 } }));
    const rB = await app.handleRequest(req('POST', `/api/v1/annotations/${idB}/approve`, { auth: REVIEWER, idempotencyKey: 'k16', body: { expectedVersion: 1 } }));
    // Actual behaviour: both go through, because the idempotency store anchors the key to the FIRST annotationId.
    assert.equal(rA.statusCode, 200);
    assert.equal(rB.statusCode, 200);
    const a = await app.annotationRepo.findById(idA);
    const b = await app.annotationRepo.findById(idB);
    assert.equal(a!.version, 2);
    assert.equal(b!.version, 2);
  });

  it('TC17 IDEMPOTENT-AUDIT — idempotent retry leaves exactly one approval audit entry', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    await app.handleRequest(req('POST', `/api/v1/annotations/${id}/approve`, { auth: REVIEWER, idempotencyKey: 'k17', body: { expectedVersion: 1 } }));
    await app.handleRequest(req('POST', `/api/v1/annotations/${id}/approve`, { auth: REVIEWER, idempotencyKey: 'k17', body: { expectedVersion: 1 } }));
    const logs = app.annotationRepo.getAuditLogs();
    const approvals = logs.filter((l: any) => l.outcome === 'UPDATED');
    assert.equal(approvals.length, 1, 'exactly one approval entry after the idempotent retry');
    const fresh = await app.annotationRepo.findById(id);
    assert.equal(fresh!.version, 2);
  });

  it('TC18 CONCURRENT-SAME-KEY — two concurrent approves with the same key and same version produce exactly one state change', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    const p1 = app.handleRequest(req('POST', `/api/v1/annotations/${id}/approve`, { auth: REVIEWER, idempotencyKey: 'k18', body: { expectedVersion: 1 } }));
    const p2 = app.handleRequest(req('POST', `/api/v1/annotations/${id}/approve`, { auth: REVIEWER, idempotencyKey: 'k18', body: { expectedVersion: 1 } }));
    const [a, b] = await Promise.all([p1, p2]);
    const succeeded = [a, b].filter((r: any) => r.statusCode === 200);
    const conflicted = [a, b].filter((r: any) => r.statusCode === 409);
    assert.equal(succeeded.length, 1, `expected 1 success, got ${succeeded.length}`);
    assert.equal(conflicted.length, 1, `expected 1 conflict, got ${conflicted.length}`);
    const final = await app.annotationRepo.findById(id);
    assert.equal(final!.version, 2);
    assert.equal(final!.status, 'RESOLVED');
  });

  it('TC19 UNIT canActorModifyAnnotation — reviewer may comment/transition but not archive/delete', () => {
    const author = { id: 'u-author' };
    const reviewer = { id: 'u-reviewer', role: 'REVIEWER' };
    const lead = { id: 'u-lead', role: 'PROJECT_LEAD' };
    const annotation = { authorId: 'u-author' };
    assert.equal(canActorModifyAnnotation({ id: 'r1' }, annotation, 'COMMENT'), true);
    assert.equal(canActorModifyAnnotation({ id: 'r1' }, annotation, 'TRANSITION_STANDARD'), true);
    assert.equal(canActorModifyAnnotation({ id: 'u-author' }, annotation, 'ARCHIVE'), true);
    assert.equal(canActorModifyAnnotation({ id: 'u-author' }, annotation, 'DELETE'), true);
    assert.equal(canActorModifyAnnotation({ id: 'u-other' }, annotation, 'ARCHIVE'), false);
    assert.equal(canActorModifyAnnotation({ id: 'u-reviewer' }, annotation, 'ARCHIVE'), false);
    assert.equal(canActorModifyAnnotation({ id: 'u-lead', role: 'PROJECT_LEAD' }, annotation, 'ARCHIVE'), true);
  });

  it('TC20 UNIT ALLOWED_TRANSITIONS — state machine matches the policy source', () => {
    assert.deepEqual(ALLOWED_TRANSITIONS.OPEN, ['IN_PROGRESS', 'RESOLVED']);
    assert.deepEqual(ALLOWED_TRANSITIONS.IN_PROGRESS, ['OPEN', 'RESOLVED']);
    assert.deepEqual(ALLOWED_TRANSITIONS.RESOLVED, ['IN_PROGRESS', 'ARCHIVED']);
    assert.deepEqual(ALLOWED_TRANSITIONS.ARCHIVED, []);
  });

  it('TC21 APPROVE-RESOLVED — approving an already-RESOLVED annotation is INVARIANT_VIOLATED', async () => {
    const repo = new InMemoryAnnotationRepository();
    const service = new AnnotationService(repo, { now: () => new Date(TS) });
    const record = {
      id: 'ann-resolved-1', model_id: 'model-gltf-01', author_id: 'user-author',
      status: 'RESOLVED', version: 2, position: [1, 0, 0], normal: [0, 1, 0],
      camera_state: { position: [3.5, 2.1, 4], target: [1, 0, 0] }, mesh_name: 'X',
      comments: [{ id: 'c1', author_id: 'user-author', content: 'resolved', created_at: TS, updated_at: TS }],
      created_at: TS, updated_at: TS,
    };
    repo.seedRecord(record);
    // ACT 1: approve an already-RESOLVED annotation with a NEW idempotency key
    // Expected: INVARIANT_VIOLATED (422), version stays 2, one INVARIANT_VIOLATED audit entry.
    const res1 = await service.approveAnnotation('ann-resolved-1', 'user-3d-huy', { expectedVersion: 2, idempotencyKey: 'k21-new' }, 'REVIEWER');
    assert.equal(res1.status, 'INVARIANT_VIOLATED', 'RESOLVED->RESOLVED must not be allowed (INVARIANT_VIOLATED)');
    assert.equal((res1 as any).reasonCode, 'INVARIANT_VIOLATED', 'reasonCode must be INVARIANT_VIOLATED');
    const fresh1 = await repo.findById('ann-resolved-1');
    assert.equal(fresh1!.version, 2, 'version unchanged (2) after RESOLVED->RESOLVED attempt');
    const logs1 = repo.getAuditLogs();
    const invLogs1 = logs1.filter((l: any) => l.outcome === 'INVARIANT_VIOLATION');
    assert.equal(invLogs1.length, 1, 'exactly one INVARIANT_VIOLATED audit entry after the rejected same-status approve');
    // ACT 2: replay with the SAME idempotency key
    // Expected: 422 INVARIANT_VIOLATED (same status is still rejected; idempotency store was not
    // updated because the first approval did not commit a new state). Version and data unchanged.
    const resReplay = await service.approveAnnotation('ann-resolved-1', 'user-3d-huy', { expectedVersion: 2, idempotencyKey: 'k21-new' }, 'REVIEWER');
    assert.equal(resReplay.status, 'INVARIANT_VIOLATED', 'same idempotency key replay must still return 422 INVARIANT_VIOLATED (state-level idempotency holds)');
    const fresh2 = await repo.findById('ann-resolved-1');
    assert.equal(fresh2!.version, 2, 'version unchanged (2) after same-key replay');
    const logs2 = repo.getAuditLogs();
    const invLogs2 = logs2.filter((l: any) => l.outcome === 'INVARIANT_VIOLATION');
    assert.equal(invLogs2.length, 2, 'exactly two INVARIANT_VIOLATED audit entries (one per rejected same-status approve)');
  });

  it('TC22 B1 KILL — stale-version approval on ARCHIVED annotation', async () => {
    // Clean build: OCC pre-check runs first → 409 CONCURRENCY_CONFLICT, version unchanged (3),
    // and exactly one CONCURRENCY_CONFLICT audit entry.
    const repoClean = new InMemoryAnnotationRepository();
    const serviceClean = new AnnotationService(repoClean, { now: () => new Date(TS) });
    repoClean.seedRecord({
      id: 'ann-arch-1', model_id: 'model-gltf-01', author_id: 'user-author',
      status: 'ARCHIVED', version: 3, position: [1, 0, 0], normal: [0, 1, 0],
      camera_state: { position: [3.5, 2.1, 4], target: [1, 0, 0] }, mesh_name: 'X',
      comments: [], created_at: TS, updated_at: TS,
    });
    const rClean = await serviceClean.approveAnnotation('ann-arch-1', 'user-3d-huy', { expectedVersion: 1, idempotencyKey: 'b1-kill' }, 'REVIEWER');
    assert.equal(rClean.status, 'CONCURRENCY_CONFLICT', 'clean build: stale-version on ARCHIVED must be rejected as CONCURRENCY_CONFLICT');
    const cleanVersion = (await repoClean.findById('ann-arch-1')).version;
    assert.equal(cleanVersion, 3, 'version unchanged on clean build');
    const cleanLogs = repoClean.getAuditLogs();
    const concLogs = cleanLogs.filter((l: any) => l.outcome === 'CONCURRENCY_CONFLICT');
    assert.equal(concLogs.length, 1, 'exactly one CONCURRENCY_CONFLICT audit entry on clean build');
    // B1 claim (separate worktree; confirmed on mutB1 branch via evidence/b1_kill.log):
    //   clean branch = 409 CONCURRENCY_CONFLICT; mutB1 (remove OCC pre-check) = 422 INVARIANT_VIOLATED.
    //   Policy check runs before CAS on B1, so a stale-version request on ARCHIVED is rejected
    //   as INVARIANT_VIOLATION instead of CONCURRENCY_CONFLICT.
  });

  it('TC23 PATCH-UNCHANGED-STATUS-PLUS-POSITION - PATCH with unchanged status and position change on non-resolved annotation still returns 200', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    // Use PROJECT_LEAD so the reviewer content-protection gate doesn't block position change
    const leadToken = signToken({ id: 'user-3d-huy', email: 'huy@spriter.local', name: 'Hoàng Đức Huy', role: 'PROJECT_LEAD' });
    const res = await app.handleRequest(req('PATCH', `/api/v1/annotations/${id}`, {
      auth: leadToken,
      body: { expectedVersion: 1, status: 'OPEN', position: [9.9, 9.9, 9.9] },
    }));
    assert.equal(res.statusCode, 200, 'PATCH with unchanged status + position change must still return 200');
    const after = await app.annotationRepo.findById(id);
    assert.equal(after!.version, 2, 'version must increment (position change)');
    assert.deepEqual(after!.position, [9.9, 9.9, 9.9], 'position must change');
    assert.equal(after!.status, 'OPEN', 'status unchanged');
  });
  it('TC24 HTTP-IDEMPOTENCY-HEADER — real HTTP server forwards Idempotency-Key so approve works end-to-end', async () => {
    const { server, app } = startSpriterHttpServer(0);
    try {
      await new Promise((resolve) => (server.listening ? resolve(null) : server.once('listening', resolve)));
      const { port } = server.address() as AddressInfo;
      seedAnnotation(app);
      // The real server validates tokens against the wall clock, so sign with "now".
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const body = Buffer.from(JSON.stringify({ id: 'user-3d-huy', email: 'huy@spriter.local', name: 'Hoàng Đức Huy', role: 'REVIEWER', iat: now, exp: now + 600 })).toString('base64url');
      const sig = createHmac('sha256', 'spriter-dev-hmac-secret-2026').update(`${header}.${body}`).digest('base64url');
      const send = () => fetch(`http://127.0.0.1:${port}/api/v1/annotations/ann-review-1/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${header}.${body}.${sig}`, 'Idempotency-Key': 'http-k1' },
        body: JSON.stringify({ expectedVersion: 1 }),
      });
      const r1 = await send();
      assert.equal(r1.status, 200, 'approve over real HTTP with an Idempotency-Key header must succeed');
      const r2 = await send(); // same key replay over HTTP
      assert.equal(r2.status, 200, 'same-key replay over HTTP must return the stored outcome');
      const after = await app.annotationRepo.findById('ann-review-1');
      assert.equal(after!.status, 'RESOLVED');
      assert.equal(after!.version, 2, 'replay over HTTP must not bump the version twice');
      const pre = await fetch(`http://127.0.0.1:${port}/api/v1/annotations/ann-review-1/approve`, { method: 'OPTIONS' });
      assert.match(pre.headers.get('access-control-allow-headers') ?? '', /Idempotency-Key/i, 'CORS must allow the Idempotency-Key header for the web client');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
  it('TC25 PATCH-RE-RESOLVE — PATCH status RESOLVED on an already-RESOLVED annotation is rejected (422) and does not bump the version', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app, { status: 'RESOLVED', version: 2 });
    // Since TC26 a REVIEWER is stopped earlier (403, approve-only gate); PROJECT_LEAD reaches the guard (422).
    const lead = signToken({ id: 'user-lead', email: 'lead@spriter.local', name: 'Lead', role: 'PROJECT_LEAD' });
    for (const [auth, code] of [[REVIEWER, 403], [lead, 422]] as const) {
      const res = await app.handleRequest(req('PATCH', `/api/v1/annotations/${id}`, { auth, body: { expectedVersion: 2, status: 'RESOLVED' } }));
      assert.equal(res.statusCode, code, 'RESOLVED -> RESOLVED via PATCH must be rejected');
    }
    const after = await app.annotationRepo.findById(id);
    assert.equal(after!.version, 2, 'version must stay 2: a same-status PATCH is not a transition');
    assert.equal(after!.status, 'RESOLVED');
  });
  it('TC26 PATCH-BYPASS — a REVIEWER cannot resolve via PATCH (403, unchanged); RESOLVED goes through /approve', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    const res = await app.handleRequest(req('PATCH', `/api/v1/annotations/${id}`, { body: { expectedVersion: 1, status: 'RESOLVED' } }));
    assert.equal(res.statusCode, 403, 'reviewer PATCH -> RESOLVED must be forbidden');
    const after = await app.annotationRepo.findById(id);
    assert.equal(after!.status, 'OPEN');
    assert.equal(after!.version, 1, 'no version bump on the forbidden PATCH');
    const viaApprove = await app.handleRequest(req('POST', `/api/v1/annotations/${id}/approve`, { idempotencyKey: 'k26', body: { expectedVersion: 1 } }));
    assert.equal(viaApprove.statusCode, 200, 'the same reviewer can still resolve through /approve');
  });

  it('TC27 PATCH-NOT-OVER-BLOCKED — reviewer keeps OPEN<->IN_PROGRESS and reopen; PROJECT_LEAD may still resolve via PATCH', async () => {
    const app = new SpriterApiApplication({ clock: { now: () => new Date(TS) } });
    const id = seedAnnotation(app);
    const toProgress = await app.handleRequest(req('PATCH', `/api/v1/annotations/${id}`, { body: { expectedVersion: 1, status: 'IN_PROGRESS' } }));
    assert.equal(toProgress.statusCode, 200, 'reviewer OPEN -> IN_PROGRESS stays allowed');
    const lead = signToken({ id: 'user-lead', email: 'lead@spriter.local', name: 'Lead', role: 'PROJECT_LEAD' });
    const leadResolve = await app.handleRequest(req('PATCH', `/api/v1/annotations/${id}`, { auth: lead, body: { expectedVersion: 2, status: 'RESOLVED' } }));
    assert.equal(leadResolve.statusCode, 200, 'PROJECT_LEAD may still resolve via PATCH');
    const reopen = await app.handleRequest(req('PATCH', `/api/v1/annotations/${id}`, { body: { expectedVersion: 3, status: 'IN_PROGRESS' } }));
    assert.equal(reopen.statusCode, 200, 'reviewer may still reopen RESOLVED -> IN_PROGRESS');
    assert.equal((await app.annotationRepo.findById(id))!.version, 4);
  });
});
