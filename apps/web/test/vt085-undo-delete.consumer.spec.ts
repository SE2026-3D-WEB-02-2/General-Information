/**
 * VT-085 — Consumer-side contract verification for "undo delete annotation".
 *
 * The consumer (HttpAnnotationApi + SocketRealtimeAdapter/AnnotationWorkspaceStore) is driven by the
 * response examples of packages/shared/fixtures/undo-delete.contract.json — the same file the provider
 * test replays against the real API. A fake fetch records what the consumer SENDS so the request side of
 * the contract is checked too.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { AnnotationDomainSnapshot, RoomJoinAck, RoomJoinPayload, ServerRealtimeEvent } from '@spriter/shared';
import { AnnotationWorkspaceStore } from '../src/app/annotation-store.ts';
import { FakeWorkspaceApi } from '../src/adapters/fake-workspace-api.ts';
import { HttpAnnotationApi } from '../src/adapters/http-annotation-api.ts';
import { SocketRealtimeAdapter, type SocketLike } from '../src/adapters/socket-realtime-adapter.ts';
import { FakeViewportBridge } from '../src/viewport/FakeViewportBridge.ts';

interface Interaction {
  id: string;
  request: { method: string; path: string };
  response: { status: number; errorCode?: string; expect?: string; example?: Record<string, unknown> };
}
const fixturePath = path.resolve(import.meta.dirname, '../../../packages/shared/fixtures/undo-delete.contract.json');
const contract = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as {
  seedAnnotation: AnnotationDomainSnapshot;
  interactions: Interaction[];
};
const SEED = contract.seedAnnotation;
const BASE = 'http://api.test';
const TOKEN = '9f2c4e6a8b0d1f3a5c7e9b1d3f5a7c9e';
const RESTORED_EXAMPLE: AnnotationDomainSnapshot = { ...structuredClone(SEED), version: SEED.version + 1, updatedAt: '2026-11-16T03:00:10.000Z' };

interface Recorded { url: string; method: string; headers: Headers; body: string | undefined }

function fakeFetch(status: number, body: unknown, log: Recorded[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    log.push({ url: String(input), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body as string | undefined });
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

function exampleBody(ix: Interaction): unknown {
  if (ix.response.expect === 'SNAPSHOT_RESTORED_VERSION_PLUS_ONE') return RESTORED_EXAMPLE;
  return ix.response.example ?? { errorCode: ix.response.errorCode, message: `${ix.id} example` };
}

describe('VT-085 consumer contract — HttpAnnotationApi', () => {
  it('C01 consumer: DELETE request shape and DeleteAnnotationResponseDto parsing', async () => {
    const ix = contract.interactions.find((i) => i.id === 'C01')!;
    const log: Recorded[] = [];
    const api = new HttpAnnotationApi(BASE, fakeFetch(200, ix.response.example, log));
    api.setAccessToken('jwt-test');
    const result = await api.deleteAnnotation(SEED.id);
    assert.deepEqual(result, ix.response.example);
    assert.equal(log.length, 1);
    assert.equal(log[0]!.method, 'DELETE');
    assert.equal(log[0]!.url, `${BASE}${ix.request.path}`);
    assert.equal(log[0]!.headers.get('authorization'), 'Bearer jwt-test');
    assert.equal(log[0]!.body, undefined, 'DELETE carries no body');
  });

  it('consumer request side: restore sends exactly POST …/restore {"undoToken"} as JSON', async () => {
    const log: Recorded[] = [];
    const api = new HttpAnnotationApi(BASE, fakeFetch(200, RESTORED_EXAMPLE, log));
    await api.restoreAnnotation(SEED.id, TOKEN);
    assert.equal(log[0]!.method, 'POST');
    assert.equal(log[0]!.url, `${BASE}/api/v1/annotations/${SEED.id}/restore`);
    assert.equal(log[0]!.headers.get('content-type'), 'application/json');
    assert.deepEqual(JSON.parse(log[0]!.body!), { undoToken: TOKEN });
  });

  for (const ix of contract.interactions.filter((i) => i.request.method === 'POST')) {
    it(`${ix.id} consumer: ${ix.response.status} is mapped without inventing data`, async () => {
      const log: Recorded[] = [];
      const api = new HttpAnnotationApi(BASE, fakeFetch(ix.response.status, exampleBody(ix), log));
      const result = await api.restoreAnnotation(SEED.id, TOKEN);
      if (ix.response.status === 200) {
        assert.equal(result.ok, true);
        assert.deepEqual(result.ok && result.data, RESTORED_EXAMPLE, 'restored snapshot passed through unchanged');
      } else {
        assert.equal(result.ok, false);
        assert.ok(!('data' in result), 'an error result must not contain a (default) snapshot');
        assert.equal(!result.ok && result.statusCode, ix.response.status);
        assert.equal(!result.ok && result.errorCode, ix.response.errorCode);
      }
    });
  }

  for (const bad of ['', '   ', 'not-a-token', TOKEN.toUpperCase()]) {
    it(`consumer guard: restoreAnnotation(${JSON.stringify(bad)}) is rejected locally and never hits the network`, async () => {
      const log: Recorded[] = [];
      const api = new HttpAnnotationApi(BASE, fakeFetch(200, RESTORED_EXAMPLE, log));
      const result = await api.restoreAnnotation(SEED.id, bad);
      assert.equal(result.ok, false);
      assert.equal(!result.ok && result.errorCode, 'VALIDATION_FAILED');
      assert.equal(log.length, 0);
    });
  }

  it('failure path: a network exception propagates — it is not converted into a fake success', async () => {
    const api = new HttpAnnotationApi(BASE, (async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
    await assert.rejects(api.restoreAnnotation(SEED.id, TOKEN), /fetch failed/);
  });
});

describe('VT-085 consumer contract — realtime (annotation:deleted → annotation:created)', () => {
  async function connect() {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const socket: SocketLike = {
      on(event, handler) { handlers.set(event, handler); },
      off(event) { handlers.delete(event); },
      emit(_e: string, _p: RoomJoinPayload, ack: (r: RoomJoinAck) => void) { ack({ ok: true, room: `model:${SEED.modelId}`, serverTime: '2026-11-16T03:00:00.000Z' }); },
    };
    const store = new AnnotationWorkspaceStore(new FakeViewportBridge());
    const adapter = new SocketRealtimeAdapter(socket, SEED.modelId, store, new FakeWorkspaceApi());
    adapter.start();
    await new Promise((r) => setImmediate(r));
    const fire = async (event: ServerRealtimeEvent) => { handlers.get(event.type)?.(event); await new Promise((r) => setImmediate(r)); };
    return { store, fire };
  }

  it('TC-13: a restored snapshot (version N+1) re-appears in the store with its whole thread', async () => {
    const { store, fire } = await connect();
    store.upsertSnapshot(SEED);
    await fire({ type: 'annotation:deleted', eventId: 'e1', modelId: SEED.modelId, emittedAt: '', annotationId: SEED.id });
    assert.equal(store.getAnnotations().some((a) => a.id === SEED.id), false);
    await fire({ type: 'annotation:created', eventId: 'e2', modelId: SEED.modelId, emittedAt: '', annotation: RESTORED_EXAMPLE });
    const got = store.getAnnotations().find((a) => a.id === SEED.id);
    assert.deepEqual(got, RESTORED_EXAMPLE);
  });

  it('TC-13b: a client that missed the delete event still converges (N+1 > N is applied)', async () => {
    const { store, fire } = await connect();
    store.upsertSnapshot(SEED);
    await fire({ type: 'annotation:created', eventId: 'e3', modelId: SEED.modelId, emittedAt: '', annotation: RESTORED_EXAMPLE });
    assert.equal(store.getAnnotations().find((a) => a.id === SEED.id)?.version, SEED.version + 1);
  });
});
