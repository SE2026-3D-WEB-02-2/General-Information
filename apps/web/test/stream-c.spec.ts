import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AnnotationDomainSnapshot, RoomJoinAck, RoomJoinPayload, ServerRealtimeEvent } from '@spriter/shared';
import { AnnotationWorkspaceStore } from '../src/app/annotation-store.ts';
import { FakeWorkspaceApi } from '../src/adapters/fake-workspace-api.ts';
import { ApiClientError, HttpAnnotationApi } from '../src/adapters/http-annotation-api.ts';
import { ModelUploadService } from '../src/adapters/model-upload.ts';
import { SocketRealtimeAdapter, type SocketLike } from '../src/adapters/socket-realtime-adapter.ts';
import { AnnotationThreadPanelController } from '../src/features/annotations/AnnotationThreadController.ts';
import { matchesAnnotationQuery } from '../src/features/annotations/annotation-view.ts';
import { FakeViewportBridge } from '../src/viewport/FakeViewportBridge.ts';

const base: AnnotationDomainSnapshot = {
  id: 'ann-c-test', modelId: 'model-gltf-01', authorId: 'user-ui-hieu', authorName: 'Hồ Trọng Hiếu',
  status: 'IN_PROGRESS', version: 4, position: [0, 0, 0], normal: [0, 1, 0],
  cameraState: { position: [1, 2, 3], target: [0, 0, 0] },
  comments: [{ id: 'c-1', authorId: 'user-ui-hieu', content: 'Đã kiểm tra góc này trên model.', createdAt: '2026-10-25T00:00:00.000Z' }],
  updatedAt: '2026-10-25T00:00:00.000Z',
};

describe('Stream C — collaboration workflow', () => {
  it('C1/C2: store notifies sidebar, focuses camera on sidebar selection, and captures a valid surface pick', () => {
    const bridge = new FakeViewportBridge();
    const store = new AnnotationWorkspaceStore(bridge);
    let changes = 0;
    const unsubscribe = store.subscribe(() => { changes += 1; });
    store.upsertSnapshot(base);
    assert.equal(store.getAnnotations().length, 1);
    store.selectAnnotation(base.id, true);
    assert.equal(bridge.getLastFocusedCamera()?.annotationId, base.id);
    assert.equal(bridge.getRenderedPins()[0]?.selected, true);
    bridge.emitSurfacePick({ position: [2, 0, 1], normal: [0, 1, 0], cameraState: base.cameraState });
    assert.deepEqual(store.getPendingPick()?.position, [2, 0, 1]);
    store.clearPendingPick();
    assert.equal(store.getPendingPick(), null);
    assert.ok(changes >= 3);
    unsubscribe();
  });

  it('C1: searches mesh name, author and full discussion beyond the shortened title', () => {
    const item = {
      ...base, meshName: 'Bộ phận cửa trước', authorName: 'Nguyễn Văn Hiếu',
      comments: [
        { ...base.comments[0]!, content: 'Một bình luận đầu tiên dài hơn bốn mươi tám ký tự để tiêu đề bị cắt bớt phần cuối quan trọng' },
        { ...base.comments[0]!, id: 'c-2', content: 'Cần kiểm tra khe hở phía bên phải.' },
      ],
    };
    assert.equal(matchesAnnotationQuery(item, 'cửa trước'), true);
    assert.equal(matchesAnnotationQuery(item, 'nguyễn văn hiếu'), true);
    assert.equal(matchesAnnotationQuery(item, 'phần cuối quan trọng'), true);
    assert.equal(matchesAnnotationQuery(item, 'khe hở phía bên phải'), true);
    assert.equal(matchesAnnotationQuery(item, 'không tồn tại'), false);
  });

  it('C3/C8: preserves a status attempt on 409, can accept server, and refuses invalid retry', async () => {
    // FakeWorkspaceApi has separate seed data; use a controlled port for this race.
    const port = {
      async patchAnnotation(_id: string, payload: { expectedVersion: number }) {
        if (payload.expectedVersion === 4) return { ok: false as const, statusCode: 409 as const, errorCode: 'CONCURRENCY_CONFLICT', serverSnapshot: { ...base, version: 5 } };
        return { ok: true as const, data: { ...base, version: 6, status: 'RESOLVED' as const } };
      },
    };
    const controller = new AnnotationThreadPanelController(base, port, { onAnnotationUpdated: () => {} });
    await assert.rejects(controller.updateStatus('RESOLVED'), /CONCURRENCY_CONFLICT/);
    assert.equal(controller.getPendingStatusAttempt(), 'RESOLVED');
    await controller.retryPendingStatusOnLatestVersion();
    assert.equal(controller.getSnapshot().version, 6);
    assert.equal(controller.getConflictState(), null);

    const archivedPort = {
      async patchAnnotation() { return { ok: false as const, statusCode: 409 as const, errorCode: 'CONCURRENCY_CONFLICT', serverSnapshot: { ...base, status: 'ARCHIVED' as const, version: 5 } }; },
    };
    const blocked = new AnnotationThreadPanelController(base, archivedPort, { onAnnotationUpdated: () => {} });
    await assert.rejects(blocked.updateStatus('RESOLVED'), /CONCURRENCY_CONFLICT/);
    await assert.rejects(blocked.retryPendingStatusOnLatestVersion(), /DOMAIN_PRECHECK_REJECTED/);
    assert.equal(blocked.getConflictState()?.version, 5, 'invalid retry must retain conflict details');
    assert.equal(blocked.acceptServerConflictSnapshot().status, 'ARCHIVED');
    assert.equal(blocked.getPendingStatusAttempt(), null);
  });

  it('C4: import checks file hash and reports invalid items before changing the mock workspace', async () => {
    const api = new FakeWorkspaceApi();
    const payload = await api.exportAnnotations('model-gltf-01');
    const originalCount = (await api.listAnnotations('model-gltf-01')).totalCount;
    const mismatch = { ...payload, modelMeta: { ...payload.modelMeta, fileHash: 'different-hash' } };
    await assert.rejects(api.importAnnotations('model-gltf-01', { mode: 'STRICT', payload: mismatch }), (error: unknown) => error instanceof ApiClientError && error.detail.errorCode === 'IMPORT_MODEL_HASH_MISMATCH');
    const invalid = { ...payload, annotations: [{ ...payload.annotations[0]!, status: 'RESOLVED' as const, comments: [] }] };
    await assert.rejects(api.importAnnotations('model-gltf-01', { payload: invalid }), (error: unknown) => error instanceof ApiClientError && error.detail.itemErrors?.[0]?.reasonCode === 'MISSING_RESOLUTION_COMMENT');
    assert.equal((await api.listAnnotations('model-gltf-01')).totalCount, originalCount);
    const imported = await api.importAnnotations('model-gltf-01', { mode: 'FORCE_HASH_MISMATCH', payload: mismatch });
    assert.equal(imported.importedCount, payload.annotations.length);
  });

  it('C5: HTTP adapter sends expectedVersion and reads 409/422 without overwriting the client state', async () => {
    const calls: Array<{ url: string; body: unknown; auth: string | null }> = [];
    let status = 409;
    const fetchFake: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body)), auth: new Headers(init?.headers).get('Authorization') });
      return new Response(JSON.stringify(status === 409
        ? { errorCode: 'CONCURRENCY_CONFLICT', message: 'Conflict', currentVersion: 5, serverSnapshot: { ...base, version: 5 } }
        : { errorCode: 'MISSING_RESOLUTION_COMMENT', message: 'Missing explanation' }), { status, headers: { 'Content-Type': 'application/json' } });
    };
    const api = new HttpAnnotationApi('http://api.local', fetchFake);
    api.setAccessToken('test-token');
    const conflict = await api.patchAnnotation(base.id, { expectedVersion: 4, status: 'RESOLVED' });
    assert.equal(conflict.ok, false);
    if (!conflict.ok) assert.equal(conflict.serverSnapshot?.version, 5);
    assert.equal(calls[0]?.body && (calls[0].body as { expectedVersion: number }).expectedVersion, 4);
    assert.equal(calls[0]?.auth, 'Bearer test-token');
    status = 422;
    const invalid = await api.patchAnnotation(base.id, { expectedVersion: 5, status: 'RESOLVED' });
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.errorCode, 'MISSING_RESOLUTION_COMMENT');
    assert.match(calls[0]!.url, /\/api\/v1\/annotations\/ann-c-test$/);
  });

  it('C6: upload flow hashes, requests URL, PUTs binary with progress, then confirms', async () => {
    const sequence: string[] = [];
    const api = new FakeWorkspaceApi();
    api.requestUploadUrl = async (body) => { sequence.push(`url:${body.fileHash}`); return { modelId: 'uploaded-model', uploadUrl: 'mock://put', storageKey: 'demo/test.glb', expiresInSeconds: 900, maxApiJsonBodyBytes: 1_048_576 }; };
    api.confirmUpload = async (id, body) => { sequence.push(`confirm:${id}:${body.fileHash}`); return { id, name: 'test.glb', storageKey: 'demo/test.glb', fileSize: body.fileSize, fileHash: body.fileHash, status: 'READY', uploadedBy: 'u-1', createdAt: new Date().toISOString() }; };
    const file = new File([new Uint8Array([1, 2, 3])], 'test.glb');
    const uploader = new ModelUploadService(api, async (_url, _file, progress) => { sequence.push('put'); progress(100); }, async () => 'abc123');
    const progress: number[] = [];
    const model = await uploader.upload(file, (value) => progress.push(value));
    assert.deepEqual(sequence, ['url:abc123', 'put', 'confirm:uploaded-model:abc123']);
    assert.deepEqual(progress, [100]);
    assert.equal(model.status, 'READY');
  });

  it('C7: realtime adapter ignores old versions, applies a newer snapshot and fetches a detected gap', async () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const socket: SocketLike = {
      on(event, handler) { handlers.set(event, handler); },
      off(event) { handlers.delete(event); },
      emit(_event: string, _payload: RoomJoinPayload, ack: (response: RoomJoinAck) => void) {
        ack({ ok: true, room: 'model:model-gltf-01', serverTime: '2026-10-25T01:00:00.000Z' });
      },
    };
    const store = new AnnotationWorkspaceStore(new FakeViewportBridge());
    store.upsertSnapshot({ ...base, version: 1 });
    let fetches = 0;
    const api = new FakeWorkspaceApi();
    api.listAnnotations = async () => { fetches += 1; return { items: [], nextCursor: null, totalCount: 0, serverTime: '2026-10-25T01:00:00.000Z' }; };
    const adapter = new SocketRealtimeAdapter(socket, 'model-gltf-01', store, api);
    adapter.start();
    await new Promise((resolve) => setImmediate(resolve));
    handlers.get('annotation:updated')?.({ type: 'annotation:updated', eventId: 'old', modelId: 'model-gltf-01', emittedAt: '', previousVersion: 0, annotation: { ...base, version: 1 } } satisfies ServerRealtimeEvent);
    assert.equal(store.getAnnotations()[0]?.version, 1);
    handlers.get('annotation:updated')?.({ type: 'annotation:updated', eventId: 'new', modelId: 'model-gltf-01', emittedAt: '', previousVersion: 3, annotation: { ...base, version: 4 } } satisfies ServerRealtimeEvent);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(store.getAnnotations()[0]?.version, 4);
    assert.ok(fetches >= 2, 'initial sync and version-gap catch-up should both fetch');
    assert.equal(store.hasMissedVersionGap(), false);
    adapter.stop();
    assert.equal(handlers.size, 0);
  });
});
