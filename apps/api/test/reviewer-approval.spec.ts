import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createHmac } from 'node:crypto';
import { SpriterApiApplication } from '../src/http/app-router.ts';
import { AnnotationService } from '../src/modules/annotations/domain/annotation.service.ts';
import { InMemoryAnnotationRepository } from '../src/modules/annotations/adapters/in-memory.repository.ts';
import type { AnnotationDomainSnapshot } from '@spriter/shared';

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

function req(method, path, { auth = REVIEWER, idempotencyKey, body } = {}) {
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
});
