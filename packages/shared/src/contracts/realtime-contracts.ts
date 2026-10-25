import { type AnnotationDomainSnapshot, type CommentSummary } from '../domain/annotation-policy.ts';

// ============================================================================
// SOCKET.IO REALTIME SYNC CONTRACTS (ROOM AUTH, EVENTS & GAP RECOVERY)
// ============================================================================

export interface SocketHandshakeAuth {
  token: string;
}

export interface RoomJoinPayload {
  modelId: string;
  /** Optional map of { [annotationId]: localVersion } to detect missed updates upon reconnect */
  knownVersions?: Record<string, number>;
}

export interface RoomJoinAck {
  ok: boolean;
  room: string;
  serverTime: string;
  errorCode?: 'UNAUTHORIZED' | 'MODEL_NOT_FOUND';
}

export interface AnnotationCreatedEvent {
  type: 'annotation:created';
  eventId: string;
  modelId: string;
  emittedAt: string;
  annotation: AnnotationDomainSnapshot;
}

export interface AnnotationUpdatedEvent {
  type: 'annotation:updated';
  eventId: string;
  modelId: string;
  emittedAt: string;
  previousVersion: number;
  annotation: AnnotationDomainSnapshot;
}

export interface AnnotationDeletedEvent {
  type: 'annotation:deleted';
  eventId: string;
  modelId: string;
  emittedAt: string;
  annotationId: string;
}

export interface CommentCreatedEvent {
  type: 'comment:created';
  eventId: string;
  modelId: string;
  emittedAt: string;
  annotationId: string;
  previousVersion: number;
  annotationVersion: number;
  comment: CommentSummary;
}

export type ServerRealtimeEvent =
  | AnnotationCreatedEvent
  | AnnotationUpdatedEvent
  | AnnotationDeletedEvent
  | CommentCreatedEvent;

/**
 * Determines how a client should handle an incoming versioned event:
 * - 'APPLY': incoming event is newer; apply directly.
 * - 'IGNORE_STALE': incomingVersion <= localVersion; ignore out-of-order/duplicate packet.
 * - 'APPLY_AND_FETCH_GAP': incomingVersion > localVersion, but previousVersion > localVersion
 *   (meaning at least one intermediate event was missed while offline; apply snapshot and trigger background catch-up).
 */
export function classifyRealtimeVersionStep(
  localVersion: number | undefined,
  previousVersion: number,
  incomingVersion: number,
): 'APPLY' | 'IGNORE_STALE' | 'APPLY_AND_FETCH_GAP' {
  if (localVersion !== undefined && incomingVersion <= localVersion) {
    return 'IGNORE_STALE';
  }
  if (localVersion !== undefined && previousVersion > localVersion) {
    return 'APPLY_AND_FETCH_GAP';
  }
  return 'APPLY';
}
