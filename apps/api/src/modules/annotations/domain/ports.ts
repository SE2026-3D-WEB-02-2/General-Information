import {
  type AnnotationDomainSnapshot,
  type AnnotationStatus,
  type CameraState,
  type CommentSummary,
  type ServerRealtimeEvent,
  type Vec3,
} from '@spriter/shared';

export const OPERATIONAL_LOG_TTL_DAYS = 7;

export interface OperationalAuditLogEntry {
  eventId: string;
  annotationId: string;
  actorId: string;
  outcome: 'CREATED' | 'UPDATED' | 'COMMENTED' | 'CONCURRENCY_CONFLICT' | 'INVARIANT_VIOLATION';
  expectedVersion: number;
  actualVersion: number;
  createdAt: string;
  expiresAt: string;
}

export interface InternalDbAnnotationRecord {
  id: string;
  model_id: string;
  author_id: string;
  author_name?: string;
  status: AnnotationStatus;
  version: number;
  position: Vec3;
  normal: Vec3;
  camera_state?: CameraState;
  mesh_name?: string;
  comments: CommentSummary[];
  internal_storage_bucket_token?: string;
  created_at?: string;
  updated_at: string;
}

export interface ModelMetadataRecord {
  id: string;
  name: string;
  fileHash: string;
}

export interface ClockPort {
  now(): Date;
}

export interface RealtimePublisherPort {
  publishToModelRoom(modelId: string, event: ServerRealtimeEvent): void;
}

export interface AnnotationRepositoryPort {
  findModelById(modelId: string): Promise<ModelMetadataRecord | undefined>;
  findById(id: string): Promise<InternalDbAnnotationRecord | undefined>;
  listByModel(
    modelId: string,
    options: { status?: AnnotationStatus; cursor?: string; limit: number; updatedAfter?: string },
  ): Promise<{ rows: InternalDbAnnotationRecord[]; nextCursor: string | null; totalCount: number }>;
  insert(record: InternalDbAnnotationRecord, audit: OperationalAuditLogEntry): Promise<void>;
  /**
   * Atomic Compare-And-Swap (equivalent to SQL: UPDATE annotations SET ..., version = version + 1 WHERE id = $1 AND version = $2).
   * Returns true if 1 row was updated, or false if version did not match.
   */
  updateIfVersion(
    id: string,
    expectedVersion: number,
    updatedRow: InternalDbAnnotationRecord,
    audit: OperationalAuditLogEntry,
  ): Promise<boolean>;
  deleteById(id: string, audit: OperationalAuditLogEntry): Promise<boolean>;
  bulkReplaceOrInsert(
    modelId: string,
    records: InternalDbAnnotationRecord[],
    audits: OperationalAuditLogEntry[],
  ): Promise<void>;
  appendAuditLog(audit: OperationalAuditLogEntry): Promise<void>;
  getAuditLogs(): ReadonlyArray<OperationalAuditLogEntry>;
  purgeExpiredAuditLogs(now: Date): Promise<number>;
}
