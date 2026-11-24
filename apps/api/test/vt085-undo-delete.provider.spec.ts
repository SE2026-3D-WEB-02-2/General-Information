/**
 * VT-085 — Provider-side contract verification for "undo delete annotation".
 *
 * Every interaction in packages/shared/fixtures/undo-delete.contract.json is replayed against the
 * real provider (SpriterApiApplication.handleRequest) with an injected clock. The web consumer test
 * (apps/web/test/vt085-undo-delete.consumer.spec.ts) is verified against the SAME fixture, so the two
 * sides cannot drift apart silently.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { AnnotationDomainSnapshot, ServerRealtimeEvent, UserSummary } from '@spriter/shared';
import { SpriterApiApplication } from '../src/http/app-router.ts';
import { InMemoryAnnotationRepository } from '../src/modules/annotations/adapters/in-memory.repository.ts';
import { AnnotationService } from '../src/modules/annotations/domain/annotation.service.ts';
import type { InternalDbAnnotationRecord, UndoTombstoneStorePort } from '../src/modules/annotations/domain/ports.ts';

type ActorKey = 'author' | 'lead' | 'otherReviewer';
interface Interaction {
  id: string;
  ac: string;
  given: string;
  description: string;
  atMsAfterDelete?: number;
  request: { method: 'DELETE' | 'POST'; path: string; actor: ActorKey; body?: unknown; bodyIsAbsent?: boolean };
  response: {
    status: number;
    errorCode?: string;
    expect?: 'SNAPSHOT_RESTORED_VERSION_PLUS_ONE';
    tombstoneMustSurvive?: boolean;
    example?: Record<string, unknown>;
  };
}
interface ContractFixture {
  undoWindowMs: number;
  clockStart: string;
  actors: Record<ActorKey, UserSummary>;
  seedAnnotation: AnnotationDomainSnapshot;
  interactions: Interaction[];
}

const fixturePath = path.resolve(import.meta.dirname, '../../../packages/shared/fixtures/undo-delete.contract.json');
const contract = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as ContractFixture;
const SEED = contract.seedAnnotation;
const ANN_PATH = `/api/v1/annotations/${SEED.id}`;
const LIST_PATH = `/api/v1/models/${SEED.modelId}/annotations`;
const TOKEN_FORMAT = /^[0-9a-f]{32}$/;
const MODEL_FILE_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

/** JSON round-trip = what a consumer actually receives over the wire. */
const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function toDbRecord(s: AnnotationDomainSnapshot): InternalDbAnnotationRecord {
  return structuredClone({
    id: s.id,
    model_id: s.modelId,
    author_id: s.authorId,
    status: s.status,
    version: s.version,
    position: s.position,
    normal: s.normal,
    camera_state: s.cameraState,
    comments: s.comments,
    created_at: s.createdAt,
    updated_at: s.updatedAt,
  });
}

function substituteToken(value: unknown, token: string): unknown {
  if (typeof value === 'string') return value.replaceAll('{{undoToken}}', token);
  if (Array.isArray(value)) return value.map((v) => substituteToken(v, token));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substituteToken(v, token)]));
  }
  return value;
}

class ProviderHarness {
  nowMs = Date.parse(contract.clockStart);
  readonly events: ServerRealtimeEvent[] = [];
  readonly app = new SpriterApiApplication({
    clock: { now: () => new Date(this.nowMs) },
    realtime: { publishToModelRoom: (_modelId, event) => this.events.push(event) },
  });
  deletedAtMs = 0;
  undoToken = '';
  before: AnnotationDomainSnapshot | undefined;

  constructor() {
    this.app.annotationService.seedRecord(toDbRecord(SEED));
  }

  bearer(actor: ActorKey): string {
    return `Bearer ${this.app.authService.signAccessToken(contract.actors[actor])}`;
  }

  send(method: 'GET' | 'POST' | 'DELETE', reqPath: string, actor: ActorKey, body?: unknown) {
    return this.app.handleRequest({
      method,
      path: reqPath,
      headers: { authorization: this.bearer(actor), contentType: 'application/json' },
      body,
    }) as Promise<{ statusCode: number; body: any }>;
  }

  async listIds(): Promise<string[]> {
    const res = await this.send('GET', LIST_PATH, 'lead');
    return (res.body.items as AnnotationDomainSnapshot[]).map((a) => a.id);
  }

  async findLive(): Promise<AnnotationDomainSnapshot | undefined> {
    const res = await this.send('GET', LIST_PATH, 'lead');
    return (res.body.items as AnnotationDomainSnapshot[]).find((a) => a.id === SEED.id);
  }

  async deleteAsAuthor() {
    this.before = wire(await this.findLive());
    this.deletedAtMs = this.nowMs;
    const res = await this.send('DELETE', ANN_PATH, 'author');
    assert.equal(res.statusCode, 200, `DELETE must succeed, got ${JSON.stringify(res.body)}`);
    this.undoToken = res.body.undoToken;
    return res;
  }

  restore(actor: ActorKey, body: unknown) {
    return this.send('POST', `${ANN_PATH}/restore`, actor, body);
  }

  advanceTo(msAfterDelete: number) {
    this.nowMs = this.deletedAtMs + msAfterDelete;
  }
}

async function arrange(given: string): Promise<{ h: ProviderHarness; heal: () => void }> {
  const h = new ProviderHarness();
  let heal = () => {};
  if (given === 'ANNOTATION_EXISTS') return { h, heal };

  await h.deleteAsAuthor();
  if (given === 'ANNOTATION_DELETED_AND_RESTORED') {
    h.advanceTo(1000);
    const first = await h.restore('author', { undoToken: h.undoToken });
    assert.equal(first.statusCode, 200);
  }
  if (given === 'ANNOTATION_DELETED_THEN_ID_REOCCUPIED') {
    const imported = await h.send('POST', `/api/v1/models/${SEED.modelId}/annotations/import`, 'lead', {
      mode: 'STRICT',
      payload: {
        schemaVersion: '1.0',
        exportedAt: contract.clockStart,
        modelMeta: { name: 'turbine_housing_v1.glb', fileHash: MODEL_FILE_HASH },
        annotations: [
          { ...SEED, status: 'OPEN', version: 1, position: [9, 9, 9], comments: [{ id: 'cmt-import-1', authorId: 'user-lead-nekover2', content: 'Pin mới tạo lại qua import.', createdAt: contract.clockStart }] },
        ],
      },
    });
    assert.equal(imported.statusCode, 201, JSON.stringify(imported.body));
  }
  if (given === 'ANNOTATION_DELETED_AND_REPOSITORY_WRITE_FAILS') {
    const repo = h.app.annotationRepo;
    const realInsert = repo.insert.bind(repo);
    repo.insert = async () => {
      throw new Error('simulated storage failure (disk full)');
    };
    heal = () => {
      repo.insert = realInsert;
    };
  }
  return { h, heal };
}

function assertRestoredEqualsDeleted(before: AnnotationDomainSnapshot, restored: AnnotationDomainSnapshot, nowIso: string) {
  const got = wire(restored);
  assert.equal(got.version, before.version + 1, 'restored version must be deletedVersion + 1 (monotonic)');
  assert.equal(got.updatedAt, nowIso, 'updatedAt must be the restore time from the injected clock');
  const { version: _v1, updatedAt: _u1, ...gotRest } = got;
  const { version: _v2, updatedAt: _u2, ...beforeRest } = before;
  assert.deepEqual(gotRest, beforeRest, 'every business field must equal the snapshot at delete time');
}

describe('VT-085 provider contract — undo delete (fixture replay)', () => {
  for (const ix of contract.interactions) {
    it(`${ix.id} [${ix.ac}] ${ix.description} → ${ix.response.status}`, async () => {
      const { h, heal } = await arrange(ix.given);
      if (ix.atMsAfterDelete !== undefined) h.advanceTo(ix.atMsAfterDelete);

      // C01 is the DELETE itself.
      if (ix.request.method === 'DELETE') {
        const fresh = new ProviderHarness();
        const res = await fresh.deleteAsAuthor();
        assert.equal(res.statusCode, ix.response.status);
        assert.deepEqual(Object.keys(res.body).sort(), Object.keys(ix.response.example!).sort(), 'response keys must match the contract example');
        assert.equal(res.body.deletedId, SEED.id, 'deletedId kept for backward compatibility');
        assert.match(res.body.undoToken, TOKEN_FORMAT, 'undoToken must be 32 lowercase hex chars');
        assert.equal(res.body.undoExpiresAt, new Date(fresh.deletedAtMs + contract.undoWindowMs).toISOString());
        assert.deepEqual(await fresh.listIds(), [], 'the annotation is gone after delete');
        return;
      }

      const body = ix.request.bodyIsAbsent ? undefined : substituteToken(ix.request.body, h.undoToken);
      const res = await h.restore(ix.request.actor, body);

      assert.equal(res.statusCode, ix.response.status, `body: ${JSON.stringify(res.body)}`);
      if (ix.response.errorCode) {
        assert.equal(res.body.errorCode, ix.response.errorCode);
        assert.equal(typeof res.body.message, 'string');
        assert.ok(!('comments' in res.body) && !('id' in res.body), 'an error must never carry (default) annotation data');
      }

      if (ix.response.expect === 'SNAPSHOT_RESTORED_VERSION_PLUS_ONE') {
        assertRestoredEqualsDeleted(h.before!, res.body, new Date(h.nowMs).toISOString());
        const live = await h.findLive();
        assert.ok(live, 'restored annotation is listed again');
        assert.deepEqual(wire(live), wire(res.body), 'list and restore response agree');
      } else if (ix.given === 'ANNOTATION_EXISTS') {
        assert.equal((await h.findLive())?.version, SEED.version, 'a never-deleted annotation is untouched');
      } else if (ix.given === 'ANNOTATION_DELETED_THEN_ID_REOCCUPIED') {
        const live = await h.findLive();
        assert.deepEqual(live?.position, [9, 9, 9], 'the re-imported row must not be overwritten');
        assert.equal(live?.comments.length, 1);
      } else if (ix.given !== 'ANNOTATION_DELETED_AND_RESTORED') {
        assert.deepEqual(await h.listIds(), [], 'a rejected restore must not change state');
      }

      if (ix.response.tombstoneMustSurvive) {
        heal();
        const retry = await h.restore('author', { undoToken: h.undoToken });
        assert.equal(retry.statusCode, 200, `the tombstone must survive a rejected attempt: ${JSON.stringify(retry.body)}`);
        assertRestoredEqualsDeleted(h.before!, retry.body, new Date(h.nowMs).toISOString());
      }
    });
  }
});

describe('VT-085 provider — invariants outside the fixture', () => {
  it('TC-RT: the deleted event never leaks undoToken; a successful restore emits exactly one annotation:created', async () => {
    const h = new ProviderHarness();
    await h.deleteAsAuthor();
    const deletedEvents = h.events.filter((e) => e.type === 'annotation:deleted');
    assert.equal(deletedEvents.length, 1);
    assert.ok(!JSON.stringify(deletedEvents).includes(h.undoToken), 'undoToken must not be broadcast to the room');

    h.advanceTo(500);
    await h.restore('otherReviewer', { undoToken: h.undoToken }); // rejected 403
    assert.equal(h.events.filter((e) => e.type === 'annotation:created').length, 0, 'no event on a rejected restore');

    const ok = await h.restore('author', { undoToken: h.undoToken });
    const created = h.events.filter((e) => e.type === 'annotation:created');
    assert.equal(created.length, 1);
    assert.deepEqual(wire((created[0] as any).annotation), wire(ok.body));
  });

  it('TC-CAS: a comment committed between the delete\'s read and write is still in the tombstone (no lost comment)', async () => {
    const h = new ProviderHarness();
    const repo = h.app.annotationRepo;
    const realFind = repo.findById.bind(repo);
    let armed = true;
    let acknowledgedComment = '';
    repo.findById = async (id: string) => {
      const row = await realFind(id);
      if (armed) {
        armed = false;
        // Another reviewer's comment commits after DELETE has read version 5 but before it writes.
        const res = await h.app.annotationService.addComment(id, 'user-3d-huy', { content: 'Bình luận chen giữa lúc xoá' });
        assert.equal(res.status, 'OK');
        acknowledgedComment = 'Bình luận chen giữa lúc xoá';
      }
      return row;
    };
    const del = await h.send('DELETE', ANN_PATH, 'author');
    assert.equal(del.statusCode, 200);
    h.deletedAtMs = h.nowMs;
    h.advanceTo(1000);
    const res = await h.restore('author', { undoToken: del.body.undoToken });
    assert.equal(res.statusCode, 200);
    const contents = (res.body as AnnotationDomainSnapshot).comments.map((c) => c.content);
    assert.ok(contents.includes(acknowledgedComment), `acknowledged comment lost: ${JSON.stringify(contents)}`);
    assert.equal(res.body.version, SEED.version + 2, 'deleted at v6 (after the comment) → restored v7');
  });

  it('TC-RACE: 80 concurrent restores with the same token → exactly one 200, the rest 404', async () => {
    const h = new ProviderHarness();
    await h.deleteAsAuthor();
    h.advanceTo(2000);
    const results = await Promise.all(
      Array.from({ length: 80 }, (_, i) => h.restore(i % 2 ? 'author' : 'lead', { undoToken: h.undoToken })),
    );
    const codes = results.map((r) => r.statusCode);
    assert.equal(codes.filter((c) => c === 200).length, 1, `codes: ${codes.join(',')}`);
    assert.equal(codes.filter((c) => c === 404).length, 79);
    assert.equal(h.events.filter((e) => e.type === 'annotation:created').length, 1);
    assert.deepEqual(await h.listIds(), [SEED.id]);
  });

  it('TC-TOMB: if the undo store cannot save, the delete is rolled back — no undo token for a row that could not be restored', async () => {
    // Added after mutant M4 (swallow tombstone-save failure) survived the first suite.
    const repo = new InMemoryAnnotationRepository();
    repo.seedRecord(toDbRecord(SEED));
    const events: ServerRealtimeEvent[] = [];
    const brokenStore: UndoTombstoneStorePort = {
      save: async () => { throw new Error('undo store unavailable'); },
      peek: async () => undefined,
      claim: async () => undefined,
    };
    const service = new AnnotationService(
      repo,
      { now: () => new Date(contract.clockStart) },
      { publishToModelRoom: (_m, e) => events.push(e) },
      brokenStore,
    );
    await assert.rejects(service.deleteAnnotation(SEED.id, SEED.authorId, 'REVIEWER'), /undo store unavailable/);
    const row = await repo.findById(SEED.id);
    assert.ok(row, 'the row must be put back when its tombstone could not be stored');
    assert.equal(row.comments.length, SEED.comments.length);
    assert.equal(events.filter((e) => e.type === 'annotation:deleted').length, 0, 'no delete may be broadcast');
  });

  it('TC-ROUTE: an empty id segment (//restore) never reaches the restore handler', async () => {
    const h = new ProviderHarness();
    const res = await h.send('POST', '/api/v1/annotations//restore', 'author', { undoToken: '0'.repeat(32) });
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.errorCode, 'NOT_FOUND');
  });
});
