import {
  type AnnotationDomainSnapshot,
  type AnnotationStatus,
  evaluateAnnotationMutation,
} from '../../../../packages/shared/src/domain/annotation-policy.ts';

// [AFTER REFACTORING]
// - Enforces Optimistic Concurrency Control (OCC) via monotonic integer `version`
// - Protects domain invariants at the authoritative server boundary
// - Hides internal DB fields (Information Hiding) via toDomainSnapshot()
// - Records operational & conflict audit logs with strict 7-day retention TTL

export const OPERATIONAL_LOG_TTL_DAYS = 7;

export interface OperationalAuditLogEntry {
  eventId: string;
  annotationId: string;
  actorId: string;
  outcome: 'UPDATED' | 'CONCURRENCY_CONFLICT' | 'INVARIANT_VIOLATION';
  expectedVersion: number;
  actualVersion: number;
  createdAt: string;
  expiresAt: string; // Automatically purged after 7 days
}

export interface InternalDbAnnotationRecord {
  id: string;
  model_id: string;
  author_id: string;
  status: AnnotationStatus;
  version: number;
  position: [number, number, number];
  normal: [number, number, number];
  comments: Array<{ id: string; authorId: string; content: string; createdAt: string }>;
  internal_storage_bucket_token?: string;
  updated_at: string;
}

export type UpdateAnnotationOutcome =
  | { status: 'OK'; snapshot: AnnotationDomainSnapshot }
  | { status: 'NOT_FOUND' }
  | { status: 'INVARIANT_VIOLATED'; reasonCode: string; message: string }
  | {
      status: 'CONCURRENCY_CONFLICT';
      currentVersion: number;
      serverSnapshot: AnnotationDomainSnapshot;
    };

export class AnnotationService {
  private readonly dbStore = new Map<string, InternalDbAnnotationRecord>();
  private readonly operationalLogs: OperationalAuditLogEntry[] = [];

  public seedRecord(record: InternalDbAnnotationRecord): void {
    this.dbStore.set(record.id, structuredClone(record));
  }

  public getOperationalLogs(): ReadonlyArray<OperationalAuditLogEntry> {
    return this.operationalLogs;
  }

  private toDomainSnapshot(row: InternalDbAnnotationRecord): AnnotationDomainSnapshot {
    // Information Hiding: strips `internal_storage_bucket_token` and maps DB snake_case to domain contract
    return {
      id: row.id,
      modelId: row.model_id,
      authorId: row.author_id,
      status: row.status,
      version: row.version,
      position: [...row.position] as [number, number, number],
      normal: [...row.normal] as [number, number, number],
      comments: row.comments.map((c) => ({ ...c })),
      updatedAt: row.updated_at,
    };
  }

  private appendOperationalLog(
    annotationId: string,
    actorId: string,
    outcome: OperationalAuditLogEntry['outcome'],
    expectedVersion: number,
    actualVersion: number,
  ): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + OPERATIONAL_LOG_TTL_DAYS * 24 * 60 * 60 * 1000);
    this.operationalLogs.push({
      eventId: `${annotationId}-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      annotationId,
      actorId,
      outcome,
      expectedVersion,
      actualVersion,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  }

  public async updateWithConcurrencyControl(
    id: string,
    actorId: string,
    command: {
      expectedVersion: number;
      status?: AnnotationStatus;
      position?: [number, number, number];
      normal?: [number, number, number];
    },
  ): Promise<UpdateAnnotationOutcome> {
    const current = this.dbStore.get(id);
    if (!current) {
      return { status: 'NOT_FOUND' };
    }

    // 1. Atomic Optimistic Concurrency Check (equivalent to SQL: WHERE id = $1 AND version = $2)
    if (current.version !== command.expectedVersion) {
      const serverSnapshot = this.toDomainSnapshot(current);
      this.appendOperationalLog(id, actorId, 'CONCURRENCY_CONFLICT', command.expectedVersion, current.version);
      return {
        status: 'CONCURRENCY_CONFLICT',
        currentVersion: current.version,
        serverSnapshot,
      };
    }

    // 2. Authoritative Domain Invariant Check (uses shared pure policy)
    const policyResult = evaluateAnnotationMutation(this.toDomainSnapshot(current), {
      status: command.status,
      position: command.position,
      normal: command.normal,
    });

    if (!policyResult.allowed) {
      this.appendOperationalLog(id, actorId, 'INVARIANT_VIOLATION', command.expectedVersion, current.version);
      return {
        status: 'INVARIANT_VIOLATED',
        reasonCode: policyResult.reasonCode ?? 'INVARIANT_VIOLATION',
        message: policyResult.message ?? 'Domain invariant check failed.',
      };
    }

    // 3. Atomic Version Increment & State Commit
    const nextVersion = current.version + 1;
    const updatedRow: InternalDbAnnotationRecord = {
      ...current,
      status: command.status ?? current.status,
      position: command.position ?? current.position,
      normal: command.normal ?? current.normal,
      version: nextVersion,
      updated_at: new Date().toISOString(),
    };

    this.dbStore.set(id, updatedRow);
    this.appendOperationalLog(id, actorId, 'UPDATED', command.expectedVersion, nextVersion);

    return {
      status: 'OK',
      snapshot: this.toDomainSnapshot(updatedRow),
    };
  }
}
