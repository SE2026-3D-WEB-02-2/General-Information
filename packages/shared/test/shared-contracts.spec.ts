import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  ALLOWED_TRANSITIONS,
  canActorModifyAnnotation,
  classifyRealtimeVersionStep,
  evaluateAnnotationMutation,
  type ExportFileV1,
  validateExportPayload,
  validateSurfacePick,
} from '../src/index.ts';

describe('@spriter/shared — Pure Domain Policy & Unified Contracts', () => {
  it('1. Enforces state transition matrix and allows RESOLVED if ANY comment in thread has >= 10 chars (even if last comment is short)', () => {
    const base = {
      status: 'OPEN' as const,
      comments: [],
      position: [1.0, 2.0, 3.0] as [number, number, number],
      normal: [0.0, 1.0, 0.0] as [number, number, number],
    };

    // Missing comment -> rejected
    const rejected = evaluateAnnotationMutation(base, { status: 'RESOLVED' });
    assert.equal(rejected.allowed, false);
    assert.equal(rejected.reasonCode, 'MISSING_RESOLUTION_COMMENT');

    // Thread has a detailed explanation (>= 10 chars) followed by a short "OK!" reply
    const withDetailedThenShortReply = {
      ...base,
      comments: [
        {
          id: 'c-1',
          authorId: 'u-1',
          content: 'Fixed flange thickness by 2.5mm to prevent stress concentration.',
          createdAt: '2026-10-25T04:00:00.000Z',
        },
        {
          id: 'c-2',
          authorId: 'u-2',
          content: 'OK!',
          createdAt: '2026-10-25T04:05:00.000Z',
        },
      ],
    };

    const allowed = evaluateAnnotationMutation(withDetailedThenShortReply, { status: 'RESOLVED' });
    assert.equal(allowed.allowed, true);
    assert.deepEqual(ALLOWED_TRANSITIONS.RESOLVED, ['IN_PROGRESS', 'ARCHIVED']);
    assert.deepEqual(ALLOWED_TRANSITIONS.ARCHIVED, []);
  });

  it('2. Validates golden ExportFileV1 fixture and reports per-item errors on invalid import items', () => {
    const fixturePath = path.resolve(import.meta.dirname, '../fixtures/export-v1.json');
    const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as ExportFileV1;

    const validCheck = validateExportPayload(fixture);
    assert.equal(validCheck.valid, true);

    const brokenPayload: ExportFileV1 = {
      ...fixture,
      annotations: [
        ...fixture.annotations,
        {
          ...fixture.annotations[0]!,
          id: 'ann-bad-normal',
          normal: [0, 0, 0],
        },
        {
          ...fixture.annotations[0]!,
          id: 'ann-bad-resolved',
          status: 'RESOLVED',
          comments: [{ id: 'c-short', authorId: 'u-1', content: 'short', createdAt: '2026-10-25T00:00:00Z' }],
        },
      ],
    };

    const invalidCheck = validateExportPayload(brokenPayload);
    assert.equal(invalidCheck.valid, false);
    if (!invalidCheck.valid) {
      assert.equal(invalidCheck.itemErrors.length, 2);
      assert.equal(invalidCheck.itemErrors[0]?.index, 1);
      assert.equal(invalidCheck.itemErrors[0]?.reasonCode, 'INVALID_UNIT_NORMAL_VECTOR');
      assert.equal(invalidCheck.itemErrors[1]?.index, 2);
      assert.equal(invalidCheck.itemErrors[1]?.reasonCode, 'MISSING_RESOLUTION_COMMENT');
    }
  });

  it('3. Classifies realtime version steps for normal update, stale packet, and missed-packet gap', () => {
    assert.equal(classifyRealtimeVersionStep(3, 3, 4), 'APPLY');
    assert.equal(classifyRealtimeVersionStep(4, 2, 3), 'IGNORE_STALE');
    assert.equal(classifyRealtimeVersionStep(2, 4, 5), 'APPLY_AND_FETCH_GAP');
  });

  it('4. Validates SurfacePick contract and actor permissions', () => {
    const validPick = validateSurfacePick({
      position: [1, 2, 3],
      normal: [0, 0, 1],
      cameraState: { position: [5, 5, 5], target: [1, 2, 3] },
    });
    assert.equal(validPick.valid, true);

    assert.equal(
      canActorModifyAnnotation({ id: 'u-2', role: 'REVIEWER' }, { authorId: 'u-1' }, 'ARCHIVE'),
      false,
    );
    assert.equal(
      canActorModifyAnnotation({ id: 'u-1', role: 'REVIEWER' }, { authorId: 'u-1' }, 'ARCHIVE'),
      true,
    );
    assert.equal(
      canActorModifyAnnotation({ id: 'u-lead', role: 'PROJECT_LEAD' }, { authorId: 'u-1' }, 'ARCHIVE'),
      true,
    );
  });
});
