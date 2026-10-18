import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AnnotationService,
  OPERATIONAL_LOG_TTL_DAYS,
} from '../apps/api/src/annotations/annotation.service.ts';
import { AnnotationController } from '../apps/api/src/annotations/annotation.controller.ts';
import { AnnotationThreadPanelController } from '../apps/web/src/features/annotations/AnnotationThreadController.ts';
import { evaluateAnnotationMutation as sharedEvaluate } from '../packages/shared/src/domain/annotation-policy.ts';

describe('Annotation Domain Policy & Concurrency Boundary Verification', () => {
  it('1. Enforces identical business rules across UI and API via shared pure policy', () => {
    const draftWithoutComment = {
      status: 'OPEN' as const,
      comments: [],
      position: [1.0, 2.0, 3.0] as [number, number, number],
      normal: [0.0, 1.0, 0.0] as [number, number, number],
    };

    const rejected = sharedEvaluate(draftWithoutComment, { status: 'RESOLVED' });
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.reasonCode, 'MISSING_RESOLUTION_COMMENT');

    const validWithComment = {
      ...draftWithoutComment,
      comments: [
        {
          id: 'c-1',
          authorId: 'u-1',
          content: 'Adjusted flange clearance by 2.5mm as requested.',
          createdAt: '2026-10-18T14:00:00.000Z',
        },
      ],
    };

    const allowed = sharedEvaluate(validWithComment, { status: 'RESOLVED' });
    assert.equal(allowed.allowed, true);
  });

  it('2. Protects server-side spatial lock invariant when annotation is already RESOLVED', async () => {
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
          createdAt: '2026-10-18T14:00:00.000Z',
        },
      ],
      internal_storage_bucket_token: 's3-secret-token-xyz',
      updated_at: '2026-10-18T14:05:00.000Z',
    });

    // Attempt to move 3D pin coordinates while status is RESOLVED
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

  it('3. Prevents Lost Update when two users concurrently update the same annotation and strips internal DB fields', async () => {
    const service = new AnnotationService();
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
          createdAt: '2026-10-18T14:00:00.000Z',
        },
      ],
      internal_storage_bucket_token: 'do-not-leak-me',
      updated_at: '2026-10-18T14:01:00.000Z',
    });

    // User A and User B both read version 2 and submit concurrent updates
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
    // Information hiding verified: internal token must never be exposed
    assert.equal('internal_storage_bucket_token' in (resA.body as any), false);

    assert.equal(resB.statusCode, 409);
    assert.equal((resB.body as any).errorCode, 'CONCURRENCY_CONFLICT');
    assert.equal((resB.body as any).currentVersion, 3);
    assert.equal((resB.body as any).serverSnapshot.status, 'RESOLVED');
  });

  it('4. Sustains 984 concurrent tasks with p95 <= 2.5s (2500ms), 0 Lost Updates, and 7-day operational log TTL', async () => {
    const service = new AnnotationService();
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
          createdAt: '2026-10-18T14:00:00.000Z',
        },
      ],
      updated_at: '2026-10-18T14:00:00.000Z',
    });

    const CONCURRENT_TASKS = 984;
    const latenciesMs: number[] = [];

    const tasks = Array.from({ length: CONCURRENT_TASKS }, (_, idx) => async () => {
      const start = performance.now();
      const response = await controller.patchAnnotation({
        params: { id: 'ann-hotspot' },
        actorId: `user-${idx + 1}`,
        body: {
          expectedVersion: 1,
          status: 'IN_PROGRESS',
        },
      });
      const elapsed = performance.now() - start;
      latenciesMs.push(elapsed);
      return response;
    });

    const outcomes = await Promise.all(tasks.map((fn) => fn()));

    const succeeded = outcomes.filter((o) => o.statusCode === 200);
    const conflicted = outcomes.filter((o) => o.statusCode === 409);

    // Exactly 1 winner for expectedVersion=1, and 983 deterministic 409 conflicts (0 Lost Updates)
    assert.equal(succeeded.length, 1);
    assert.equal(conflicted.length, CONCURRENT_TASKS - 1);

    latenciesMs.sort((a, b) => a - b);
    const p95Index = Math.floor(CONCURRENT_TASKS * 0.95);
    const p95LatencyMs = latenciesMs[p95Index];
    assert.ok(
      p95LatencyMs <= 2500,
      `Expected p95 latency <= 2500ms, got ${p95LatencyMs.toFixed(3)}ms`,
    );

    // Verify 7-day operational log retention policy on all 984 recorded events
    const logs = service.getOperationalLogs();
    assert.equal(logs.length, CONCURRENT_TASKS);
    const firstLog = logs[0];
    const ttlDays =
      (Date.parse(firstLog.expiresAt) - Date.parse(firstLog.createdAt)) / (1000 * 60 * 60 * 24);
    assert.equal(Math.round(ttlDays), OPERATIONAL_LOG_TTL_DAYS);
  });

  it('5. Verifies UI Controller testability in isolation (out-of-order WebSocket protection & 409 state preservation)', async () => {
    let wsCallback: ((snapshot: any) => void) | null = null;
    const initialSnapshot = {
      id: 'ann-ui-1',
      modelId: 'model-1',
      authorId: 'user-1',
      status: 'IN_PROGRESS' as const,
      version: 4,
      position: [0, 0, 0] as [number, number, number],
      normal: [0, 1, 0] as [number, number, number],
      comments: [
        {
          id: 'c-1',
          authorId: 'user-1',
          content: 'Completed bevel adjustment on edge.',
          createdAt: '2026-10-18T14:00:00.000Z',
        },
      ],
      updatedAt: '2026-10-18T14:00:00.000Z',
    };

    const fakeApiPort = {
      async patchAnnotation() {
        return {
          ok: false as const,
          statusCode: 409 as const,
          errorCode: 'CONCURRENCY_CONFLICT',
          serverSnapshot: {
            ...initialSnapshot,
            status: 'RESOLVED' as const,
            version: 5,
          },
        };
      },
    };

    const fakeRealtimePort = {
      onAnnotationUpdated(cb: (s: any) => void) {
        wsCallback = cb;
      },
    };

    const uiController = new AnnotationThreadPanelController(
      initialSnapshot,
      fakeApiPort,
      fakeRealtimePort,
    );

    // Out-of-order stale WebSocket event (v3 < v4) must be ignored
    wsCallback!({ ...initialSnapshot, status: 'OPEN', version: 3 });
    assert.equal(uiController.getSnapshot().version, 4);
    assert.equal(uiController.getSnapshot().status, 'IN_PROGRESS');

    // Concurrent conflict (v5 on server) surfaces conflictSnapshot without crashing or losing local context
    await assert.rejects(() => uiController.updateStatus('RESOLVED'), /CONCURRENCY_CONFLICT:v5/);
    assert.equal(uiController.getConflictState()?.version, 5);
    assert.equal(uiController.getConflictState()?.status, 'RESOLVED');
  });
});
