import {
  type AnnotationDomainSnapshot,
  type AnnotationStatus,
  type CameraState,
  type CommentSummary,
  type PolicyReasonCode,
  type Vec3,
  evaluateAnnotationMutation,
  validateUnitNormal,
  validateVec3,
} from '../domain/annotation-policy.ts';

// ============================================================================
// 1. AUTH & PERMISSIONS CONTRACTS
// ============================================================================

export type UserRole = 'REVIEWER' | 'PROJECT_LEAD';

export interface UserSummary {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  role: UserRole;
}

export interface LoginRequestDto {
  email: string;
  password: string;
}

export interface RegisterRequestDto {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
  avatarUrl?: string;
}

export interface AuthSessionResponseDto {
  user: UserSummary;
  accessToken: string;
  expiresInSeconds: number;
}

/**
 * Permission Rules (Shared across UI & API):
 * - Any authenticated user (REVIEWER or PROJECT_LEAD) can create annotations, comment, and transition OPEN <-> IN_PROGRESS <-> RESOLVED.
 * - Only the annotation's original author OR a PROJECT_LEAD can transition RESOLVED -> ARCHIVED or delete an annotation.
 */
export function canActorModifyAnnotation(
  actor: Pick<UserSummary, 'id' | 'role'>,
  annotation: Pick<AnnotationDomainSnapshot, 'authorId'>,
  action: 'COMMENT' | 'TRANSITION_STANDARD' | 'ARCHIVE' | 'DELETE',
): boolean {
  if (action === 'COMMENT' || action === 'TRANSITION_STANDARD') {
    return Boolean(actor.id);
  }
  return actor.role === 'PROJECT_LEAD' || actor.id === annotation.authorId;
}

// ============================================================================
// 2. 3D MODEL METADATA & PRESIGNED UPLOAD CONTRACTS (STREAM A5 / B5 / C6)
// ============================================================================

/**
 * Maximum JSON payload size accepted directly by API Server (1MB).
 * Binary .glb files MUST be uploaded directly to S3/MinIO via Presigned URL.
 */
export const MAX_API_JSON_BODY_BYTES = 1_048_576;

export type ModelUploadStatus = 'UPLOAD_PENDING' | 'READY';

export interface ModelSummaryDto {
  id: string;
  name: string;
  storageKey: string;
  fileSize: number;
  fileHash: string;
  status: ModelUploadStatus;
  uploadedBy: string;
  downloadUrl?: string;
  createdAt: string;
}

export interface RequestModelUploadUrlDto {
  fileName: string;
  fileSize: number;
  fileHash: string;
  contentType?: string;
}

export interface PresignedUploadResponseDto {
  modelId: string;
  uploadUrl: string;
  storageKey: string;
  expiresInSeconds: number;
  maxApiJsonBodyBytes: number;
}

export interface ConfirmModelUploadDto {
  fileSize: number;
  fileHash: string;
}

// ============================================================================
// 3. REST API REQUEST / RESPONSE CONTRACTS (CRUD & PAGINATION)
// ============================================================================

export interface ListAnnotationsQueryDto {
  status?: AnnotationStatus;
  cursor?: string;
  limit?: number; // default 50, max 200
  updatedAfter?: string; // ISO timestamp for reconnect catch-up sync
}

export interface PaginatedAnnotationsResponseDto {
  items: AnnotationDomainSnapshot[];
  nextCursor: string | null;
  totalCount: number;
  serverTime: string;
}

export interface CreateAnnotationRequestDto {
  position: Vec3;
  normal: Vec3;
  cameraState: CameraState;
  meshName?: string;
  initialComment: string;
}

export interface CreateCommentRequestDto {
  content: string;
}

export interface CreateCommentResponseDto {
  comment: CommentSummary;
  annotationVersion: number;
}

export interface PatchAnnotationRequestDto {
  expectedVersion: number;
  status?: AnnotationStatus;
  position?: Vec3;
  normal?: Vec3;
  cameraState?: CameraState;
}

// ============================================================================
// 3. UNIFIED ERROR ENVELOPE (400 / 401 / 403 / 404 / 409 / 422)
// ============================================================================

export type ApiErrorCode =
  | PolicyReasonCode
  | 'MISSING_EXPECTED_VERSION'
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN_OPERATION'
  | 'EMAIL_ALREADY_EXISTS'
  | 'PAYLOAD_TOO_LARGE'
  | 'ANNOTATION_NOT_FOUND'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_UPLOAD_NOT_READY'
  | 'CONCURRENCY_CONFLICT'
  | 'IMPORT_MODEL_HASH_MISMATCH'
  | 'IMPORT_VALIDATION_FAILED';

export interface ImportItemError {
  index: number;
  annotationId: string;
  reasonCode: PolicyReasonCode | 'INVALID_SCHEMA';
  message: string;
}

export interface ApiErrorEnvelope {
  errorCode: ApiErrorCode;
  message: string;
  /** Present on 409 CONCURRENCY_CONFLICT */
  currentVersion?: number;
  /** Present on 409 CONCURRENCY_CONFLICT so client can inspect or retry on latest state */
  serverSnapshot?: AnnotationDomainSnapshot;
  /** Present on 409 IMPORT_MODEL_HASH_MISMATCH */
  expectedFileHash?: string;
  actualFileHash?: string;
  /** Present on 422 IMPORT_VALIDATION_FAILED (per-annotation validation report) */
  itemErrors?: ImportItemError[];
}

// ============================================================================
// 4. EXPORT / IMPORT JSON v1 CONTRACT (UNIFIED FIELDS + LEGACY SPATIAL SUPPORT)
// ============================================================================

export interface ExportFileV1 {
  schemaVersion: '1.0';
  exportedAt: string;
  modelMeta: {
    name: string;
    fileHash: string;
  };
  annotations: AnnotationDomainSnapshot[];
}

export interface ImportAnnotationsRequestDto {
  /**
   * STRICT (default): Rejects with 409 IMPORT_MODEL_HASH_MISMATCH if payload.modelMeta.fileHash !== model.fileHash.
   * FORCE_HASH_MISMATCH: Proceeds even if fileHash differs (after user confirms warning dialog).
   */
  mode?: 'STRICT' | 'FORCE_HASH_MISMATCH';
  payload: ExportFileV1;
}

export interface ImportAnnotationsResponseDto {
  importedCount: number;
  annotations: AnnotationDomainSnapshot[];
}

/**
 * Validates an ExportFileV1 payload and returns per-item errors if any annotation violates
 * schema or domain invariants (e.g. RESOLVED without >=10 char comment, non-unit normal vector).
 */
export function validateExportPayload(
  payload: ExportFileV1,
): { valid: true } | { valid: false; itemErrors: ImportItemError[] } {
  const itemErrors: ImportItemError[] = [];

  for (let idx = 0; idx < payload.annotations.length; idx++) {
    const item = payload.annotations[idx]!;
    if (!validateVec3(item.position) || !validateVec3(item.normal)) {
      itemErrors.push({
        index: idx,
        annotationId: item.id ?? `index-${idx}`,
        reasonCode: 'INVALID_SCHEMA',
        message: 'position and normal must be finite [x, y, z] tuples.',
      });
      continue;
    }

    if (!validateUnitNormal(item.normal)) {
      itemErrors.push({
        index: idx,
        annotationId: item.id,
        reasonCode: 'INVALID_UNIT_NORMAL_VECTOR',
        message: 'Surface normal vector must be normalized (unit length ~ 1.0).',
      });
      continue;
    }

    if (item.status === 'RESOLVED') {
      // Check resolution invariant by evaluating transition from OPEN -> RESOLVED
      const check = evaluateAnnotationMutation(
        {
          status: 'OPEN',
          comments: item.comments ?? [],
          position: item.position,
          normal: item.normal,
        },
        { status: 'RESOLVED' },
      );
      if (!check.allowed && check.reasonCode) {
        itemErrors.push({
          index: idx,
          annotationId: item.id,
          reasonCode: check.reasonCode,
          message: check.message ?? 'Invalid RESOLVED state in import payload.',
        });
      }
    }
  }

  return itemErrors.length === 0 ? { valid: true } : { valid: false, itemErrors };
}
