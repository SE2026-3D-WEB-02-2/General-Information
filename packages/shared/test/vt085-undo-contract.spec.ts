/**
 * VT-085 — Unit tests for the pure undo-delete contract in @spriter/shared.
 * Focus risk: boundary / empty data slipping past validation.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  UNDO_DELETE_WINDOW_MS,
  checkDeleteAnnotationResponse,
  isUndoWindowOpen,
  parseRestoreAnnotationRequest,
} from '../src/index.ts';

const VALID = '9f2c4e6a8b0d1f3a5c7e9b1d3f5a7c9e';
const contract = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '../fixtures/undo-delete.contract.json'), 'utf8'),
) as { undoWindowMs: number; interactions: Array<{ id: string; response: { example?: unknown } }> };

describe('VT-085 shared contract — undo delete', () => {
  it('TC-01: window constant in code equals the window published in the contract fixture', () => {
    assert.equal(UNDO_DELETE_WINDOW_MS, contract.undoWindowMs);
    assert.equal(UNDO_DELETE_WINDOW_MS, 30_000);
  });

  it('TC-02: accepts exactly one well-formed token and returns a clean DTO (extra keys dropped)', () => {
    assert.deepEqual(parseRestoreAnnotationRequest({ undoToken: VALID }), { ok: true, value: { undoToken: VALID } });
    assert.deepEqual(parseRestoreAnnotationRequest({ undoToken: VALID, admin: true }), { ok: true, value: { undoToken: VALID } });
  });

  const rejected: Array<[string, unknown]> = [
    ['undefined body', undefined],
    ['null body', null],
    ['array body', []],
    ['string body', VALID],
    ['number body', 0],
    ['empty object', {}],
    ['undoToken undefined', { undoToken: undefined }],
    ['undoToken null', { undoToken: null }],
    ['empty string', { undoToken: '' }],
    ['whitespace only', { undoToken: '   ' }],
    ['tab/newline only', { undoToken: '\t\n' }],
    ['number token', { undoToken: 123 }],
    ['boolean token', { undoToken: true }],
    ['array token', { undoToken: [VALID] }],
    ['31 chars', { undoToken: VALID.slice(0, 31) }],
    ['33 chars', { undoToken: `${VALID}0` }],
    ['uppercase hex', { undoToken: VALID.toUpperCase() }],
    ['padded valid token', { undoToken: ` ${VALID} ` }],
    ['non-hex 32 chars', { undoToken: 'z'.repeat(32) }],
    ['10 KB token', { undoToken: 'a'.repeat(10_240) }],
  ];
  for (const [label, body] of rejected) {
    it(`TC-03: rejects ${label} with VALIDATION_FAILED`, () => {
      const r = parseRestoreAnnotationRequest(body);
      assert.equal(r.ok, false);
      assert.equal(!r.ok && r.errorCode, 'VALIDATION_FAILED');
      assert.ok(!('value' in r), 'a rejected parse must not hand back a default value');
    });
  }

  it('TC-04: window boundary — open strictly before expiry, closed at and after, closed on empty/invalid expiry', () => {
    const exp = '2026-11-16T03:00:30.000Z';
    const expMs = Date.parse(exp);
    assert.equal(isUndoWindowOpen(expMs - 1, exp), true);
    assert.equal(isUndoWindowOpen(expMs, exp), false);
    assert.equal(isUndoWindowOpen(expMs + 1, exp), false);
    assert.equal(isUndoWindowOpen(expMs - 1, ''), false, 'empty expiry must not mean "never expires"');
    assert.equal(isUndoWindowOpen(expMs - 1, 'not-a-date'), false);
    assert.equal(isUndoWindowOpen(Number.NaN, exp), false);
  });

  it('TC-05: the contract example for DELETE passes the shared response checker; broken shapes are reported', () => {
    const example = contract.interactions.find((i) => i.id === 'C01')!.response.example;
    assert.deepEqual(checkDeleteAnnotationResponse(example), []);
    assert.ok(checkDeleteAnnotationResponse({ deletedId: 'ann-1' }).length >= 2, 'legacy {deletedId} is not the new contract');
    assert.ok(checkDeleteAnnotationResponse({ deletedId: '', undoToken: VALID, undoExpiresAt: '2026-11-16T03:00:30.000Z' }).length > 0);
    assert.ok(checkDeleteAnnotationResponse({ deletedId: 'a', undoToken: '', undoExpiresAt: '2026-11-16T03:00:30.000Z' }).length > 0);
    assert.ok(checkDeleteAnnotationResponse({ deletedId: 'a', undoToken: VALID, undoExpiresAt: '' }).length > 0);
    assert.ok(checkDeleteAnnotationResponse(null).length > 0);
  });
});
