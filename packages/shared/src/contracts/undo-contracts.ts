/**
 * VT-085 — Undo for annotation delete (pure contract, no runtime dependencies).
 *
 * DELETE /api/v1/annotations/:id          → 200 DeleteAnnotationResponseDto
 * POST   /api/v1/annotations/:id/restore  → 200 AnnotationDomainSnapshot (version = deletedVersion + 1)
 *   400 VALIDATION_FAILED · 403 FORBIDDEN_OPERATION · 404 UNDO_NOT_AVAILABLE
 *   409 RESTORE_ID_CONFLICT · 410 UNDO_WINDOW_EXPIRED · 503 RESTORE_FAILED
 * Golden examples: packages/shared/fixtures/undo-delete.contract.json
 */

export const UNDO_DELETE_WINDOW_MS = 30_000;

/** 128-bit token rendered as exactly 32 lowercase hex chars. No trimming, no case folding. */
export const UNDO_TOKEN_PATTERN = /^[0-9a-f]{32}$/;

export interface DeleteAnnotationResponseDto {
  deletedId: string;
  undoToken: string;
  /** ISO-8601; restore is accepted while now < undoExpiresAt. */
  undoExpiresAt: string;
}

export interface RestoreAnnotationRequestDto {
  undoToken: string;
}

export type UndoErrorCode =
  | 'UNDO_NOT_AVAILABLE'
  | 'UNDO_WINDOW_EXPIRED'
  | 'RESTORE_ID_CONFLICT'
  | 'RESTORE_FAILED';

export type ParseRestoreResult =
  | { ok: true; value: RestoreAnnotationRequestDto }
  | { ok: false; errorCode: 'VALIDATION_FAILED'; message: string };

export function isUndoToken(value: unknown): value is string {
  return typeof value === 'string' && UNDO_TOKEN_PATTERN.test(value);
}

/** Parses an untrusted restore body. Empty, blank, padded or mistyped tokens are rejected, never defaulted. */
export function parseRestoreAnnotationRequest(body: unknown): ParseRestoreResult {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, errorCode: 'VALIDATION_FAILED', message: 'Request body must be a JSON object { undoToken }.' };
  }
  const token = (body as Record<string, unknown>).undoToken;
  if (!isUndoToken(token)) {
    return {
      ok: false,
      errorCode: 'VALIDATION_FAILED',
      message: 'undoToken must be the 32-character lowercase hex token returned by DELETE.',
    };
  }
  return { ok: true, value: { undoToken: token } };
}

/** True only while nowMs < expiry. An empty or unparseable expiry closes the window. */
export function isUndoWindowOpen(nowMs: number, undoExpiresAtIso: string): boolean {
  const expiresMs = Date.parse(undoExpiresAtIso);
  return Number.isFinite(nowMs) && Number.isFinite(expiresMs) && nowMs < expiresMs;
}

/** Returns contract violations of a DELETE response body ([] = conforms). Used by provider tests and the web consumer. */
export function checkDeleteAnnotationResponse(body: unknown): string[] {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return ['body must be an object'];
  const b = body as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof b.deletedId !== 'string' || b.deletedId.length === 0) problems.push('deletedId must be a non-empty string');
  if (!isUndoToken(b.undoToken)) problems.push('undoToken must match UNDO_TOKEN_PATTERN');
  if (typeof b.undoExpiresAt !== 'string' || !Number.isFinite(Date.parse(b.undoExpiresAt))) {
    problems.push('undoExpiresAt must be an ISO-8601 timestamp');
  }
  return problems;
}
