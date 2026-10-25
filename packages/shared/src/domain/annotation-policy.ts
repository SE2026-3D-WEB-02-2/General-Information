export type Vec3 = [number, number, number];

export interface CameraState {
  position: Vec3;
  target: Vec3;
}

export type AnnotationStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'ARCHIVED';

export interface CommentSummary {
  id: string;
  annotationId?: string;
  authorId: string;
  authorName?: string;
  content: string;
  createdAt: string;
}

/**
 * Authoritative Domain Snapshot used across REST API, WebSocket Events, Zustand Store, and Export/Import.
 * Unified field names eliminate manual mapping between API and Export/Import JSON.
 */
export interface AnnotationDomainSnapshot {
  id: string;
  modelId: string;
  authorId: string;
  authorName?: string;
  status: AnnotationStatus;
  version: number;
  position: Vec3;
  normal: Vec3;
  cameraState: CameraState;
  meshName?: string;
  comments: CommentSummary[];
  createdAt?: string;
  updatedAt: string;
}

export type PolicyReasonCode =
  | 'ANNOTATION_ARCHIVED_IMMUTABLE'
  | 'INVALID_STATE_TRANSITION'
  | 'MISSING_RESOLUTION_COMMENT'
  | 'INVALID_UNIT_NORMAL_VECTOR'
  | 'SPATIAL_LOCKED_WHEN_RESOLVED';

export interface PolicyEvaluationResult {
  allowed: boolean;
  reasonCode?: PolicyReasonCode;
  message?: string;
}

/**
 * Exact State Transition Matrix:
 * - OPEN -> IN_PROGRESS | RESOLVED
 * - IN_PROGRESS -> OPEN | RESOLVED
 * - RESOLVED -> IN_PROGRESS (reopen to edit) | ARCHIVED (final lock)
 * - ARCHIVED -> [] (terminal immutable state)
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<AnnotationStatus, ReadonlyArray<AnnotationStatus>>> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED'],
  IN_PROGRESS: ['OPEN', 'RESOLVED'],
  RESOLVED: ['IN_PROGRESS', 'ARCHIVED'],
  ARCHIVED: [],
};

export const MIN_RESOLUTION_COMMENT_LENGTH = 10;
export const NORMAL_VECTOR_TOLERANCE = 0.01;
export const CONTRACT_VERSION = '1.1.0';

/**
 * Validates that a 3D surface normal vector is finite and normalized (unit length ~ 1.0).
 */
export function validateUnitNormal(normal: Vec3): boolean {
  if (!Array.isArray(normal) || normal.length !== 3) {
    return false;
  }
  const [nx, ny, nz] = normal;
  const magnitude = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return Number.isFinite(magnitude) && Math.abs(magnitude - 1.0) <= NORMAL_VECTOR_TOLERANCE;
}

/**
 * Validates a 3D coordinate tuple [x, y, z].
 */
export function validateVec3(vec: unknown): vec is Vec3 {
  return (
    Array.isArray(vec) &&
    vec.length === 3 &&
    vec.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/**
 * Pure Domain Policy (Single Source of Truth shared between 2D/3D UI and Backend API).
 * Note on Resolution Rule: Requires AT LEAST ONE comment in the thread with >= 10 trimmed characters
 * (so subsequent short replies like "OK" or "Thanks" do not invalidate resolution eligibility).
 */
export function evaluateAnnotationMutation(
  current: Pick<AnnotationDomainSnapshot, 'status' | 'comments' | 'position' | 'normal'>,
  patch: {
    status?: AnnotationStatus;
    position?: Vec3;
    normal?: Vec3;
  },
): PolicyEvaluationResult {
  if (current.status === 'ARCHIVED') {
    return {
      allowed: false,
      reasonCode: 'ANNOTATION_ARCHIVED_IMMUTABLE',
      message: 'Archived annotations are immutable.',
    };
  }

  // Server/Domain Invariant: Spatial anchor cannot be moved once RESOLVED (unless simultaneously reopening to IN_PROGRESS)
  const isSpatialChanged = patch.position !== undefined || patch.normal !== undefined;
  if (current.status === 'RESOLVED' && isSpatialChanged && patch.status !== 'IN_PROGRESS') {
    return {
      allowed: false,
      reasonCode: 'SPATIAL_LOCKED_WHEN_RESOLVED',
      message: 'Cannot modify 3D spatial coordinates while annotation is RESOLVED.',
    };
  }

  const nextNormal = patch.normal ?? current.normal;
  if (!validateUnitNormal(nextNormal)) {
    return {
      allowed: false,
      reasonCode: 'INVALID_UNIT_NORMAL_VECTOR',
      message: 'Surface normal vector must be normalized (unit length ~ 1.0).',
    };
  }

  if (patch.status && patch.status !== current.status) {
    const allowedNext = ALLOWED_TRANSITIONS[current.status] ?? [];
    if (!allowedNext.includes(patch.status)) {
      return {
        allowed: false,
        reasonCode: 'INVALID_STATE_TRANSITION',
        message: `Transition from ${current.status} to ${patch.status} is not permitted.`,
      };
    }

    if (patch.status === 'RESOLVED') {
      const hasValidExplanation = current.comments.some(
        (comment) => comment.content.trim().length >= MIN_RESOLUTION_COMMENT_LENGTH,
      );

      if (!hasValidExplanation) {
        return {
          allowed: false,
          reasonCode: 'MISSING_RESOLUTION_COMMENT',
          message: `Resolving an annotation requires at least 1 comment in the thread with >= ${MIN_RESOLUTION_COMMENT_LENGTH} characters.`,
        };
      }
    }
  }

  return { allowed: true };
}

/**
 * Pure monotonic version guard for Realtime WebSocket / HTTP responses.
 */
export function shouldApplyIncomingSnapshot(localVersion: number, incomingVersion: number): boolean {
  return incomingVersion > localVersion;
}
