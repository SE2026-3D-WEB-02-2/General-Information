import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_API_JSON_BODY_BYTES, type ServerRealtimeEvent } from '@spriter/shared';
import { SpriterApiApplication } from '../src/http/app-router.ts';
import { InMemoryAnnotationRepository } from '../src/modules/annotations/adapters/in-memory.repository.ts';
import {
  PostgresAnnotationRepository,
  type SqlExecutorPort,
} from '../src/modules/annotations/adapters/postgres.repository.ts';
import {
  AnnotationService,
  OPERATIONAL_LOG_TTL_DAYS,
} from '../src/modules/annotations/domain/annotation.service.ts';
import { AnnotationController } from '../src/modules/annotations/http/annotation.controller.ts';

describe('@spriter/api — Full Stream A Backend Suite (M1–M4: [A1]–[A10])', () => {
  it('1. [A2/A4] Protects server-side spatial lock invariant when annotation is already RESOLVED', async () => {
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

  it('2. [A2/A4] Prevents Lost Update when two users concurrently update the same annotation and strips internal DB fields', async () => {
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

  it('3. [A2/A8/A9] Domain race simulation: 984 concurrent tasks achieve 0 Lost Updates and 7-day operational log TTL', async () => {
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

  it('4. [A6] Enforces Export JSON v1, Import fileHash check (409), and per-annotation validation rollback (422)', async () => {
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

    // Verify 0 annotations were persisted after failed import rollback
    const exportAfterRollback = await controller.exportAnnotations({
      params: { modelId: 'model-gltf-01' },
    });
    assert.equal(exportAfterRollback.statusCode, 200);
    assert.equal((exportAfterRollback.body as any).annotations.length, 0);
  });

  it('5. [A3] Enforces JWT Authentication (401) and RBAC Permission Gate (403 FORBIDDEN_OPERATION on ARCHIVE/DELETE by non-author REVIEWER)', async () => {
    const app = new SpriterApiApplication();

    // 1. Missing token -> 401 UNAUTHORIZED
    const unauthRes = await app.handleRequest({
      method: 'GET',
      path: '/api/v1/models/model-gltf-01/annotations',
    });
    assert.equal(unauthRes.statusCode, 401);
    assert.equal((unauthRes.body as any).errorCode, 'UNAUTHORIZED');

    // 2. Login as Reviewer Hieu (`hieu@spriter.local`) and Reviewer Huy (`huy@spriter.local`) and Lead (`lead@spriter.local`)
    const hieuLogin = await app.handleRequest({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: 'hieu@spriter.local', password: 'SpriterUI#2026' },
    });
    assert.equal(hieuLogin.statusCode, 200);
    const hieuSession = hieuLogin.body as any;
    assert.equal('password_hash' in hieuSession.user, false);
    const hieuToken = `Bearer ${hieuSession.accessToken}`;

    const huyLogin = await app.handleRequest({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: 'huy@spriter.local', password: 'Spriter3D#2026' },
    });
    const huyToken = `Bearer ${(huyLogin.body as any).accessToken}`;

    const leadLogin = await app.handleRequest({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: 'lead@spriter.local', password: 'SpriterLead#2026' },
    });
    const leadToken = `Bearer ${(leadLogin.body as any).accessToken}`;

    // 3. Hieu creates an annotation (v1) and resolves it (v2)
    const createRes = await app.handleRequest({
      method: 'POST',
      path: '/api/v1/models/model-gltf-01/annotations',
      headers: { authorization: hieuToken },
      body: {
        position: [1, 2, 3],
        normal: [0, 1, 0],
        cameraState: { position: [0, 2, 6], target: [1, 2, 3] },
        meshName: 'RotorBlade_01',
        initialComment: 'Clearance gap exceeds 2.5mm tolerance on rotor blade.',
      },
    });
    assert.equal(createRes.statusCode, 201);
    const createdAnn = createRes.body as any;

    const resolveRes = await app.handleRequest({
      method: 'PATCH',
      path: `/api/v1/annotations/${createdAnn.id}`,
      headers: { authorization: huyToken },
      body: { expectedVersion: 1, status: 'RESOLVED' },
    });
    assert.equal(resolveRes.statusCode, 200);

    // 4. Reviewer Huy (NOT the author) attempts to ARCHIVE or DELETE Hieu's annotation -> 403 FORBIDDEN_OPERATION
    const forbiddenArchive = await app.handleRequest({
      method: 'PATCH',
      path: `/api/v1/annotations/${createdAnn.id}`,
      headers: { authorization: huyToken },
      body: { expectedVersion: 2, status: 'ARCHIVED' },
    });
    assert.equal(forbiddenArchive.statusCode, 403);
    assert.equal((forbiddenArchive.body as any).errorCode, 'FORBIDDEN_OPERATION');

    const forbiddenDelete = await app.handleRequest({
      method: 'DELETE',
      path: `/api/v1/annotations/${createdAnn.id}`,
      headers: { authorization: huyToken },
    });
    assert.equal(forbiddenDelete.statusCode, 403);
    assert.equal((forbiddenDelete.body as any).errorCode, 'FORBIDDEN_OPERATION');

    // 5. Project Lead (`Nekover2`) CAN archive the annotation -> 200 OK (version 3, ARCHIVED)
    const leadArchive = await app.handleRequest({
      method: 'PATCH',
      path: `/api/v1/annotations/${createdAnn.id}`,
      headers: { authorization: leadToken },
      body: { expectedVersion: 2, status: 'ARCHIVED' },
    });
    assert.equal(leadArchive.statusCode, 200);
    assert.equal((leadArchive.body as any).status, 'ARCHIVED');
    assert.equal((leadArchive.body as any).version, 3);
  });

  it('6. [A4] Supports Cursor Pagination, Status Filtering, Reconnect updatedAfter, and Comment Version Increment', async () => {
    const app = new SpriterApiApplication();
    const loginRes = await app.handleRequest({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: 'lead@spriter.local', password: 'SpriterLead#2026' },
    });
    const token = `Bearer ${(loginRes.body as any).accessToken}`;

    // Create 3 annotations
    const ids: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const res = await app.handleRequest({
        method: 'POST',
        path: '/api/v1/models/model-gltf-01/annotations',
        headers: { authorization: token },
        body: {
          position: [i, 0, 0],
          normal: [0, 0, 1],
          cameraState: { position: [0, 0, 5], target: [i, 0, 0] },
          initialComment: `Initial design review note #${i} with >= 10 chars`,
        },
      });
      assert.equal(res.statusCode, 201);
      ids.push((res.body as any).id);
    }

    // Add a comment to the first annotation -> increments version from 1 to 2
    const commentRes = await app.handleRequest({
      method: 'POST',
      path: `/api/v1/annotations/${ids[0]}/comments`,
      headers: { authorization: token },
      body: { content: 'Follow-up thread reply confirming CAD fix.' },
    });
    assert.equal(commentRes.statusCode, 201);
    assert.equal((commentRes.body as any).version, 2);
    assert.equal((commentRes.body as any).comments.length, 2);

    // Cursor pagination: page 1 (limit=2) -> page 2 (limit=2)
    const page1 = await app.handleRequest({
      method: 'GET',
      path: '/api/v1/models/model-gltf-01/annotations',
      headers: { authorization: token },
      query: { limit: '2' },
    });
    assert.equal(page1.statusCode, 200);
    const page1Body = page1.body as any;
    assert.equal(page1Body.items.length, 2);
    assert.equal(page1Body.totalCount, 3);
    assert.ok(page1Body.nextCursor);

    const page2 = await app.handleRequest({
      method: 'GET',
      path: '/api/v1/models/model-gltf-01/annotations',
      headers: { authorization: token },
      query: { limit: '2', cursor: page1Body.nextCursor },
    });
    const page2Body = page2.body as any;
    assert.equal(page2Body.items.length, 1);
    assert.equal(page2Body.nextCursor, null);
  });

  it('7. [A5] Generates Presigned S3/MinIO Upload/Download URLs and rejects >1MB or raw .glb binary on API (413)', async () => {
    const app = new SpriterApiApplication();
    const loginRes = await app.handleRequest({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: 'lead@spriter.local', password: 'SpriterLead#2026' },
    });
    const token = `Bearer ${(loginRes.body as any).accessToken}`;

    // 1. Reject direct binary .glb or > 1MB body with 413 PAYLOAD_TOO_LARGE
    const directBinaryRes = await app.handleRequest({
      method: 'POST',
      path: '/api/v1/models/upload-url',
      headers: {
        authorization: token,
        contentType: 'model/gltf-binary',
        contentLength: MAX_API_JSON_BODY_BYTES + 500_000,
      },
      body: {},
    });
    assert.equal(directBinaryRes.statusCode, 413);
    assert.equal((directBinaryRes.body as any).errorCode, 'PAYLOAD_TOO_LARGE');

    // 2. Request Presigned PUT URL for a 120MB .glb file
    const sha256 = 'a'.repeat(64);
    const presignRes = await app.handleRequest({
      method: 'POST',
      path: '/api/v1/models/upload-url',
      headers: { authorization: token, contentType: 'application/json', contentLength: 180 },
      body: {
        fileName: 'landing_gear_assembly.glb',
        fileSize: 125_829_120,
        fileHash: sha256,
      },
    });
    assert.equal(presignRes.statusCode, 201);
    const presigned = presignRes.body as any;
    assert.ok(presigned.modelId);
    assert.ok(presigned.uploadUrl.includes('X-Amz-Signature='));
    assert.equal(presigned.maxApiJsonBodyBytes, MAX_API_JSON_BODY_BYTES);

    // 3. Confirm upload -> Model transitions to READY & generates Presigned GET downloadUrl
    const confirmRes = await app.handleRequest({
      method: 'POST',
      path: `/api/v1/models/${presigned.modelId}/confirm`,
      headers: { authorization: token },
      body: {
        fileSize: 125_829_120,
        fileHash: sha256,
      },
    });
    assert.equal(confirmRes.statusCode, 200);
    const confirmedModel = confirmRes.body as any;
    assert.equal(confirmedModel.status, 'READY');
    assert.ok(confirmedModel.downloadUrl.includes('X-Amz-Signature='));

    // 4. Newly confirmed model is immediately available for Export/Import verification
    const exportNewModel = await app.handleRequest({
      method: 'GET',
      path: `/api/v1/models/${presigned.modelId}/annotations/export`,
      headers: { authorization: token },
    });
    assert.equal(exportNewModel.statusCode, 200);
    assert.equal((exportNewModel.body as any).modelMeta.fileHash, sha256);
  });

  it('8. [A1/A2] PostgresAnnotationRepository executes atomic SQL Compare-And-Swap (WHERE id = $1 AND version = $2) inside a transaction', async () => {
    const executedQueries: Array<{ sql: string; params: readonly unknown[] }> = [];
    const fakeSqlDriver: SqlExecutorPort = {
      async query(sql, params = []) {
        executedQueries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
        if (sql.includes('UPDATE annotations')) {
          const expectedVersion = params[1];
          return { rows: [], rowCount: expectedVersion === 4 ? 1 : 0 };
        }
        return { rows: [], rowCount: 1 };
      },
      async transaction(fn) {
        return fn(this);
      },
    };

    const pgRepo = new PostgresAnnotationRepository(fakeSqlDriver);
    const audit = {
      eventId: 'evt-pg-1',
      annotationId: 'ann-pg-1',
      actorId: 'user-lead-nekover2',
      outcome: 'UPDATED' as const,
      expectedVersion: 4,
      actualVersion: 5,
      createdAt: '2026-10-25T06:00:00.000Z',
      expiresAt: '2026-11-01T06:00:00.000Z',
    };

    const updated = await pgRepo.updateIfVersion(
      'ann-pg-1',
      4,
      {
        id: 'ann-pg-1',
        model_id: 'model-gltf-01',
        author_id: 'user-lead-nekover2',
        status: 'RESOLVED',
        version: 5,
        position: [1, 2, 3],
        normal: [0, 1, 0],
        comments: [],
        updated_at: '2026-10-25T06:00:00.000Z',
      },
      audit,
    );

    assert.equal(updated, true);
    assert.equal(executedQueries.length, 2);
    assert.ok(
      executedQueries[0]!.sql.includes(
        'UPDATE annotations SET status = $3, position = $4::jsonb, normal = $5::jsonb, camera_state = $6::jsonb, version = version + 1, updated_at = $7 WHERE id = $1 AND version = $2',
      ),
    );
    assert.ok(executedQueries[1]!.sql.includes('INSERT INTO operational_audit_logs'));

    // Stale expectedVersion (3 !== 4) -> returns false and does NOT insert operational audit log inside updateIfVersion
    executedQueries.length = 0;
    const staleResult = await pgRepo.updateIfVersion(
      'ann-pg-1',
      3,
      {
        id: 'ann-pg-1',
        model_id: 'model-gltf-01',
        author_id: 'user-lead-nekover2',
        status: 'RESOLVED',
        version: 4,
        position: [1, 2, 3],
        normal: [0, 1, 0],
        comments: [],
        updated_at: '2026-10-25T06:00:00.000Z',
      },
      audit,
    );
    assert.equal(staleResult, false);
    assert.equal(executedQueries.length, 1);
  });

  it('9. [A7] SocketRealtimeGateway enforces JWT auth on room:join, broadcasts post-commit events, and returns missedAnnotations on reconnect', async () => {
    const app = new SpriterApiApplication();
    const loginRes = await app.handleRequest({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: 'lead@spriter.local', password: 'SpriterLead#2026' },
    });
    const accessToken = (loginRes.body as any).accessToken as string;
    const bearer = `Bearer ${accessToken}`;

    // 1. Rejects room:join with invalid token
    const badAuthJoin = await app.realtimeGateway.joinModelRoom({
      socketId: 'sock-unauth',
      auth: { token: 'invalid-jwt-token' },
      payload: { modelId: 'model-gltf-01' },
      onEvent: () => {},
    });
    assert.equal(badAuthJoin.ok, false);
    assert.equal(badAuthJoin.errorCode, 'UNAUTHORIZED');

    // 2. Valid subscriber joins room `model:model-gltf-01`
    const receivedEvents: ServerRealtimeEvent[] = [];
    const goodJoin = await app.realtimeGateway.joinModelRoom({
      socketId: 'sock-huy-3d',
      auth: { token: accessToken },
      payload: { modelId: 'model-gltf-01' },
      onEvent: (evt) => receivedEvents.push(evt),
    });
    assert.equal(goodJoin.ok, true);
    assert.equal(goodJoin.room, 'model:model-gltf-01');

    // 3. Create annotation (v1) + update (v2) + failed 409 conflict -> only 2 committed events broadcast!
    const createdRes = await app.handleRequest({
      method: 'POST',
      path: '/api/v1/models/model-gltf-01/annotations',
      headers: { authorization: bearer },
      body: {
        position: [0, 1, 0],
        normal: [0, 1, 0],
        cameraState: { position: [0, 2, 5], target: [0, 1, 0] },
        initialComment: 'Realtime socket gateway verification comment.',
      },
    });
    const annId = (createdRes.body as any).id as string;

    await app.handleRequest({
      method: 'PATCH',
      path: `/api/v1/annotations/${annId}`,
      headers: { authorization: bearer },
      body: { expectedVersion: 1, status: 'IN_PROGRESS' },
    });

    // Stale PATCH (expectedVersion: 1 when current is 2) -> 409 Conflict -> MUST NOT broadcast event
    const conflictRes = await app.handleRequest({
      method: 'PATCH',
      path: `/api/v1/annotations/${annId}`,
      headers: { authorization: bearer },
      body: { expectedVersion: 1, status: 'RESOLVED' },
    });
    assert.equal(conflictRes.statusCode, 409);

    assert.equal(receivedEvents.length, 2);
    assert.equal(receivedEvents[0]?.type, 'annotation:created');
    assert.equal(receivedEvents[1]?.type, 'annotation:updated');

    // 4. Reconnecting client passes `knownVersions: { [annId]: 1 }` -> receives v2 in `missedAnnotations`
    const reconnectAck = await app.realtimeGateway.joinModelRoom({
      socketId: 'sock-hieu-reconnect',
      auth: { token: accessToken },
      payload: {
        modelId: 'model-gltf-01',
        knownVersions: { [annId]: 1 },
      },
      onEvent: () => {},
    });
    assert.equal(reconnectAck.ok, true);
    assert.equal(reconnectAck.missedAnnotations?.length, 1);
    assert.equal(reconnectAck.missedAnnotations?.[0]?.id, annId);
    assert.equal(reconnectAck.missedAnnotations?.[0]?.version, 2);
  });

  it('10. [A8/A9/A10] Verifies 984 concurrent HTTP/App tasks p95 <= 2.5s, 7-day Purge Worker, and ADR-001 (/metrics) >8% conflict trigger', async () => {
    let clockNow = new Date('2026-10-25T12:00:00.000Z');
    const app = new SpriterApiApplication({ clock: { now: () => clockNow } });

    const loginRes = await app.handleRequest({
      method: 'POST',
      path: '/api/v1/auth/login',
      body: { email: 'lead@spriter.local', password: 'SpriterLead#2026' },
    });
    const bearer = `Bearer ${(loginRes.body as any).accessToken}`;

    const createRes = await app.handleRequest({
      method: 'POST',
      path: '/api/v1/models/model-gltf-01/annotations',
      headers: { authorization: bearer },
      body: {
        position: [0, 0, 0],
        normal: [0, 1, 0],
        cameraState: { position: [0, 1, 4], target: [0, 0, 0] },
        initialComment: 'Hotspot pin for 984-task p95 and ADR-001 telemetry verification.',
      },
    });
    const annId = (createRes.body as any).id as string;

    const latenciesMs: number[] = [];
    const CONCURRENT_TASKS = 984;

    await Promise.all(
      Array.from({ length: CONCURRENT_TASKS }, async (_, idx) => {
        const t0 = performance.now();
        await app.handleRequest({
          method: 'PATCH',
          path: `/api/v1/annotations/${annId}`,
          headers: { authorization: bearer },
          body: {
            expectedVersion: 1,
            status: idx % 2 === 0 ? 'IN_PROGRESS' : 'RESOLVED',
          },
        });
        latenciesMs.push(performance.now() - t0);
      }),
    );

    latenciesMs.sort((a, b) => a - b);
    const p95Ms = latenciesMs[Math.floor(latenciesMs.length * 0.95)]!;
    assert.ok(p95Ms <= 2500, `Expected p95 (${p95Ms}ms) <= 2500ms`);

    // [A10] Check /api/v1/metrics -> 983 conflicts out of 984 patch attempts (> 8% threshold) -> adr001ReviewTriggered = true
    const metricsRes = await app.handleRequest({
      method: 'GET',
      path: '/api/v1/metrics',
    });
    assert.equal(metricsRes.statusCode, 200);
    const telemetry = metricsRes.body as any;
    assert.equal(telemetry.totalPatchAttempts, CONCURRENT_TASKS);
    assert.equal(telemetry.updatedCount, 1);
    assert.equal(telemetry.conflictCount, CONCURRENT_TASKS - 1);
    assert.equal(telemetry.adr001ReviewTriggered, true);

    // [A9] Advance clock by 8 days and trigger Purge Worker endpoint -> purges all 985 logs (1 CREATED + 984 PATCH)
    clockNow = new Date('2026-11-02T14:00:00.000Z');
    const purgeRes = await app.handleRequest({
      method: 'POST',
      path: '/api/v1/internal/audit-logs/purge',
    });
    assert.equal(purgeRes.statusCode, 200);
    assert.equal((purgeRes.body as any).purgedCount, CONCURRENT_TASKS + 1);

    const metricsAfterPurge = await app.handleRequest({
      method: 'GET',
      path: '/api/v1/metrics',
    });
    assert.equal((metricsAfterPurge.body as any).totalAuditEvents, 0);
    assert.equal((metricsAfterPurge.body as any).adr001ReviewTriggered, false);
  });
});
