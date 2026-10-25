import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AnnotationWorkspaceStore } from '../src/app/annotation-store.ts';
import { FakeAnnotationApi } from '../src/adapters/fake-annotation-api.ts';
import { AnnotationThreadPanelController } from '../src/features/annotations/AnnotationThreadController.ts';
import { FakeViewportBridge } from '../src/viewport/FakeViewportBridge.ts';

describe('@spriter/web — ViewportBridge, Workspace Store & UI Controller Isolation', () => {
  it('1. Verifies UI Controller testability in isolation (out-of-order WebSocket protection, 409 preservation & retry on latest)', async () => {
    let wsCallback: ((snapshot: any) => void) | null = null;
    const initialSnapshot = {
      id: 'ann-ui-1',
      modelId: 'model-1',
      authorId: 'user-1',
      status: 'IN_PROGRESS' as const,
      version: 4,
      position: [0, 0, 0] as [number, number, number],
      normal: [0, 1, 0] as [number, number, number],
      cameraState: {
        position: [2, 2, 2] as [number, number, number],
        target: [0, 0, 0] as [number, number, number],
      },
      comments: [
        {
          id: 'c-1',
          authorId: 'user-1',
          content: 'Completed bevel adjustment on edge.',
          createdAt: '2026-10-25T04:00:00.000Z',
        },
      ],
      updatedAt: '2026-10-25T04:00:00.000Z',
    };

    const fakeApi = new FakeAnnotationApi();
    // Server has already advanced to version 5 (still IN_PROGRESS)
    fakeApi.seed({ ...initialSnapshot, version: 5 });

    const fakeRealtimePort = {
      onAnnotationUpdated(cb: (s: any) => void) {
        wsCallback = cb;
      },
    };

    const uiController = new AnnotationThreadPanelController(
      initialSnapshot,
      fakeApi,
      fakeRealtimePort,
    );

    // Out-of-order stale WebSocket event (v3 < v4) must be ignored
    wsCallback!({ ...initialSnapshot, status: 'OPEN', version: 3 });
    assert.equal(uiController.getSnapshot().version, 4);
    assert.equal(uiController.getSnapshot().status, 'IN_PROGRESS');

    // First attempt with expectedVersion=4 hits 409 Conflict (server is at v5)
    await assert.rejects(() => uiController.updateStatus('RESOLVED'), /CONCURRENCY_CONFLICT:v5/);
    assert.equal(uiController.getConflictState()?.version, 5);
    assert.equal(uiController.getPendingStatusAttempt(), 'RESOLVED');

    // User clicks "Retry on Latest (v5)" -> succeeds and advances to v6!
    await uiController.retryPendingStatusOnLatestVersion();
    assert.equal(uiController.getSnapshot().version, 6);
    assert.equal(uiController.getSnapshot().status, 'RESOLVED');
    assert.equal(uiController.getConflictState(), null);
  });

  it('2. Coordinates ViewportBridge raycast picks, pin selection, camera focus, and version gap detection in AnnotationWorkspaceStore', () => {
    const bridge = new FakeViewportBridge();
    const store = new AnnotationWorkspaceStore(bridge);

    bridge.setPlacementMode(true);
    assert.equal(bridge.isPlacementMode(), true);

    bridge.emitSurfacePick({
      position: [1.5, 2.0, -0.5],
      normal: [0, 1, 0],
      cameraState: { position: [4, 4, 4], target: [1.5, 2.0, -0.5] },
      meshName: 'Door_Panel',
    });

    assert.equal(bridge.isPlacementMode(), false);
    assert.deepEqual(store.getPendingPick()?.position, [1.5, 2.0, -0.5]);

    // Upsert annotation v1
    store.upsertSnapshot({
      id: 'ann-1',
      modelId: 'm-1',
      authorId: 'u-1',
      status: 'OPEN',
      version: 1,
      position: [1.5, 2.0, -0.5],
      normal: [0, 1, 0],
      cameraState: { position: [4, 4, 4], target: [1.5, 2.0, -0.5] },
      comments: [],
      updatedAt: '2026-10-25T05:00:00.000Z',
    });

    assert.equal(bridge.getRenderedPins().length, 1);

    // Selecting from sidebar triggers camera focus on ViewportBridge
    store.selectAnnotation('ann-1', true);
    assert.equal(bridge.getLastFocusedCamera()?.annotationId, 'ann-1');

    // Simulate missed version gap (local v1, incoming v4 with previousVersion=3)
    const step = store.handleRealtimeUpdate(3, {
      id: 'ann-1',
      modelId: 'm-1',
      authorId: 'u-1',
      status: 'IN_PROGRESS',
      version: 4,
      position: [1.5, 2.0, -0.5],
      normal: [0, 1, 0],
      cameraState: { position: [4, 4, 4], target: [1.5, 2.0, -0.5] },
      comments: [],
      updatedAt: '2026-10-25T05:05:00.000Z',
    });

    assert.equal(step, 'APPLY_AND_FETCH_GAP');
    assert.equal(store.hasMissedVersionGap(), true);
    assert.equal(store.getSelectedAnnotation()?.version, 4);
  });
});
