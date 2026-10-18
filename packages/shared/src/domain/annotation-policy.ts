export type AnnotationStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'ARCHIVED';

export interface CommentSummary {
  id: string;
  authorId: string;
  content: string;
  createdAt: string;
}

export interface SpatialAnchor {
  position: [number, number, number];
  normal: [number, number, number];
}

export interface AnnotationDomainSnapshot {
  id: string;
  modelId: string;
  authorId: string;
  status: AnnotationStatus;
  version: number;
  position: [number, number, number];
  normal: [number, number, number];
  comments: CommentSummary[];
  updatedAt: string;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  reasonCode?:
    | 'ANNOTATION_ARCHIVED_IMMUTABLE'
    | 'INVALID_STATE_TRANSITION'
    | 'MISSING_RESOLUTION_COMMENT'
    | 'INVALID_UNIT_NORMAL_VECTOR'
    | 'SPATIAL_LOCKED_WHEN_RESOLVED';
  message?: string;
}

const ALLOWED_TRANSITIONS: Record<AnnotationStatus, AnnotationStatus[]> = {
  OPEN: ['IN_PROGRESS', 'RESOLVED'],
  IN_PROGRESS: ['OPEN', 'RESOLVED'],
  RESOLVED: ['IN_PROGRESS', 'ARCHIVED'],
  ARCHIVED: [],
};

export const MIN_RESOLUTION_COMMENT_LENGTH = 10;
export const NORMAL_VECTOR_TOLERANCE = 0.01;

/**
 * Pure Domain Policy (Single Source of Truth shared between 2D/3D UI and Backend API).
 * Eliminates duplicated business rules across UI and API while keeping 100% deterministic testability.
 */
export function validateUnitNormal(normal: [number, number, number]): boolean {
  const [nx, ny, nz] = normal;
  const magnitude = Math.sqrt(nx * nx + ny * ny + nz * nz);
  return Number.isFinite(magnitude) && Math.abs(magnitude - 1.0) <= NORMAL_VECTOR_TOLERANCE;
}

export function evaluateAnnotationMutation(
  current: Pick<AnnotationDomainSnapshot, 'status' | 'comments' | 'position' | 'normal'>,
  patch: {
    status?: AnnotationStatus;
    position?: [number, number, number];
    normal?: [number, number, number];
  },
): PolicyEvaluationResult {
  if (current.status === 'ARCHIVED') {
    return {
      allowed: false,
      reasonCode: 'ANNOTATION_ARCHIVED_IMMUTABLE',
      message: 'Archived annotations are immutable.',
    };
  }

  // Server/Domain Invariant: Spatial anchor cannot be moved once RESOLVED
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
      const latestComment = current.comments[current.comments.length - 1];
      const hasValidExplanation =
        Boolean(latestComment) && latestComment.content.trim().length >= MIN_RESOLUTION_COMMENT_LENGTH;

      if (!hasValidExplanation) {
        return {
          allowed: false,
          reasonCode: 'MISSING_RESOLUTION_COMMENT',
          message: `Resolving an annotation requires at least 1 comment with >= ${MIN_RESOLUTION_COMMENT_LENGTH} characters.`,
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
