import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type ServerRealtimeEvent } from '@spriter/shared';
import { AnnotationService, OPERATIONAL_LOG_TTL_DAYS } from '../src/modules/annotations/domain/annotation.service.ts';
import { InMemoryAnnotationRepository } from '../src/modules/annotations/adapters/in-memory.repository.ts';
import { AnnotationController } from '../src/modules/annotations/http/annotation.controller.ts';

describe('@spriter/api — Hexagonal Domain, OCC Concurrency, Import & 7-Day Telemetry', () => {
  it('1. Protects server-side spatial lock invariant when annotation is already RESOLVED', async () => {
    const service = new AnnotationService();
    const controller = new AnnotationController(service);

    service.seedRecord({
      id: 'ann-101',
      model_id: 'model-gltf-01',
      author_id: 'user-a',
      status: 'RESOLVED',
      version: 3,
      position: [1.2, 0.8, -0.4],
      normal: [0, 1, 0],
      comments: [
        {
          id: 'c-1',
          authorId: 'user-a',
          content: 'Verified surface normal alignment on housing.',
          createdAt: '2026-10-25T04:00:00.000Z',
        },
      ],
      internal_storage_bucket_token: 's3-secret-token-xyz',
      updated_at: '2026-10-25T04:05:00.000Z',
    });

    const response = await controller.patchAnnotation({
      params: { id: 'ann-101' },
      actorId: 'user-b',
      body: {
        expectedVersion: 3,
        position: [9.9, 9.9, 9.9],
      },
    });

    assert.equal(response.statusCode, 422);
    assert.equal((response.body as any).errorCode, 'SPATIAL_LOCKED_WHEN_RESOLVED');
  });

  it('2. Prevents Lost Update when two users concurrently update the same annotation and strips internal DB fields', async () => {
    const publishedEvents: ServerRealtimeEvent[] = [];
    const repo = new InMemoryAnnotationRepository();
    const service = new AnnotationService(repo, undefined, {
      publishToModelRoom(_modelId, evt) {
        publishedEvents.push(evt);
      },
    });
    const controller = new AnnotationController(service);

    service.seedRecord({
      id: 'ann-race-1',
      model_id: 'model-gltf-01',
      author_id: 'user-a',
      status: 'IN_PROGRESS',
      version: 2,
      position: [0.5, 1.0, -0.2],
      normal: [0, 0, 1],
      comments: [
        {
          id: 'c-10',
          authorId: 'user-a',
          content: 'Fixed mesh topology on front bumper.',
          createdAt: '2026-10-25T04:00:00.000Z',
        },
      ],
      internal_storage_bucket_token: 'do-not-leak-me',
      updated_at: '2026-10-25T04:01:00.000Z',
    });

    const [resA, resB] = await Promise.all([
      controller.patchAnnotation({
        params: { id: 'ann-race-1' },
        actorId: 'user-a',
        body: { expectedVersion: 2, status: 'RESOLVED' },
      }),
      controller.patchAnnotation({
        params: { id: 'ann-race-1' },
        actorId: 'user-b',
        body: { expectedVersion: 2, status: 'OPEN', position: [1.5, 1.0, -0.2] },
      }),
    ]);

    assert.equal(resA.statusCode, 200);
    assert.equal((resA.body as any).version, 3);
    assert.equal((resA.body as any).status, 'RESOLVED');
    assert.equal('internal_storage_bucket_token' in (resA.body as any), false);

    assert.equal(resB.statusCode, 409);
    assert.equal((resB.body as any).errorCode, 'CONCURRENCY_CONFLICT');
    assert.equal((resB.body as any).currentVersion, 3);
    assert.equal((resB.body as any).serverSnapshot.status, 'RESOLVED');

    // Only 1 realtime event published (for the winning commit)
    assert.equal(publishedEvents.length, 1);
    assert.equal(publishedEvents[0]?.type, 'annotation:updated');
  });

  it('3. Domain race simulation: 984 concurrent tasks achieve 0 Lost Updates and 7-day operational log TTL', async () => {
    let fakeNow = new Date('2026-10-25T12:00:00.000Z');
    const repo = new InMemoryAnnotationRepository();
    const service = new AnnotationService(repo, { now: () => fakeNow });
    const controller = new AnnotationController(service);

    service.seedRecord({
      id: 'ann-hotspot',
      model_id: 'model-gltf-01',
      author_id: 'lead-01',
      status: 'OPEN',
      version: 1,
      position: [0, 0, 0],
      normal: [0, 1, 0],
      comments: [
        {
          id: 'c-1',
          authorId: 'lead-01',
          content: 'Initial design review comment with sufficient detail.',
          createdAt: '2026-10-25T11:00:00.000Z',
        },
      ],
      updated_at: '2026-10-25T11:00:00.000Z',
    });

    const CONCURRENT_TASKS = 984;
    const outcomes = await Promise.all(
      Array.from({ length: CONCURRENT_TASKS }, (_, idx) =>
        controller.patchAnnotation({
          params: { id: 'ann-hotspot' },
          actorId: `user-${idx + 1}`,
          body: { expectedVersion: 1, status: 'IN_PROGRESS' },
        }),
      ),
    );

    const succeeded = outcomes.filter((o) => o.statusCode === 200);
    const conflicted = outcomes.filter((o) => o.statusCode === 409);

    assert.equal(succeeded.length, 1);
    assert.equal(conflicted.length, CONCURRENT_TASKS - 1);

    const logs = service.getOperationalLogs();
    assert.equal(logs.length, CONCURRENT_TASKS);
    const firstLog = logs[0]!;
    const ttlDays =
      (Date.parse(firstLog.expiresAt) - Date.parse(firstLog.createdAt)) / (1000 * 60 * 60 * 24);
    assert.equal(Math.round(ttlDays), OPERATIONAL_LOG_TTL_DAYS);

    // Advance clock by 8 days -> all 984 logs expired and purged
    fakeNow = new Date('2026-11-02T13:00:00.000Z');
    const purgedCount = await service.purgeExpiredOperationalLogs();
    assert.equal(purgedCount, CONCURRENT_TASKS);
    assert.equal(service.getOperationalLogs().length, 0);
  });

  it('4. Enforces Import fileHash check (409) and per-annotation validation rollback (422)', async () => {
    const service = new AnnotationService();
    const controller = new AnnotationController(service);

    // 1. Mismatched fileHash in STRICT mode -> 409 IMPORT_MODEL_HASH_MISMATCH
    const hashMismatchRes = await controller.importAnnotations({
      params: { modelId: 'model-gltf-01' },
      actorId: 'user-lead',
      body: {
        mode: 'STRICT',
        payload: {
          schemaVersion: '1.0',
          exportedAt: '2026-10-25T05:00:00.000Z',
          modelMeta: { name: 'other.glb', fileHash: 'wrong-hash-999' },
          annotations: [],
        },
      },
    });
    assert.equal(hashMismatchRes.statusCode, 409);
    assert.equal((hashMismatchRes.body as any).errorCode, 'IMPORT_MODEL_HASH_MISMATCH');

    // 2. FORCE_HASH_MISMATCH with invalid item -> 422 IMPORT_VALIDATION_FAILED with itemErrors[]
    const invalidItemRes = await controller.importAnnotations({
      params: { modelId: 'model-gltf-01' },
      actorId: 'user-lead',
      body: {
        mode: 'FORCE_HASH_MISMATCH',
        payload: {
          schemaVersion: '1.0',
          exportedAt: '2026-10-25T05:00:00.000Z',
          modelMeta: { name: 'other.glb', fileHash: 'wrong-hash-999' },
          annotations: [
            {
              id: 'ann-invalid-1',
              modelId: 'model-gltf-01',
              authorId: 'u-1',
              status: 'RESOLVED',
              version: 1,
              position: [0, 0, 0],
              normal: [0, 1, 0],
              cameraState: { position: [1, 1, 1], target: [0, 0, 0] },
              comments: [], // Missing >=10 char comment for RESOLVED!
              updatedAt: '2026-10-25T05:00:00.000Z',
            },
          ],
        },
      },
    });
    assert.equal(invalidItemRes.statusCode, 422);
    assert.equal((invalidItemRes.body as any).errorCode, 'IMPORT_VALIDATION_FAILED');
    assert.equal((invalidItemRes.body as any).itemErrors.length, 1);
    assert.equal((invalidItemRes.body as any).itemErrors[0].reasonCode, 'MISSING_RESOLUTION_COMMENT');
  });
});
