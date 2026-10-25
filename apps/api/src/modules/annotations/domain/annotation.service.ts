import {
  ADR_001_CONFLICT_RATE_THRESHOLD,
  type AnnotationDomainSnapshot,
  type AnnotationStatus,
  type CameraState,
  type CreateAnnotationRequestDto,
  type CreateCommentRequestDto,
  type ExportFileV1,
  type ImportAnnotationsRequestDto,
  type ImportItemError,
  type ListAnnotationsQueryDto,
  type OperationalTelemetryDto,
  type PaginatedAnnotationsResponseDto,
  type UserRole,
  type Vec3,
  canActorModifyAnnotation,
  evaluateAnnotationMutation,
  validateExportPayload,
  validateSurfacePick,
} from '@spriter/shared';
import { InMemoryAnnotationRepository } from '../adapters/in-memory.repository.ts';
import {
  type AnnotationRepositoryPort,
  type ClockPort,
  type InternalDbAnnotationRecord,
  OPERATIONAL_LOG_TTL_DAYS,
  type OperationalAuditLogEntry,
  type RealtimePublisherPort,
} from './ports.ts';

export { OPERATIONAL_LOG_TTL_DAYS, type InternalDbAnnotationRecord, type OperationalAuditLogEntry };

export type UpdateAnnotationOutcome =
  | { status: 'OK'; snapshot: AnnotationDomainSnapshot }
  | { status: 'NOT_FOUND' }
  | { status: 'FORBIDDEN'; message: string }
  | { status: 'INVARIANT_VIOLATED'; reasonCode: string; message: string }
  | {
      status: 'CONCURRENCY_CONFLICT';
      currentVersion: number;
      serverSnapshot: AnnotationDomainSnapshot;
    };

export type DeleteAnnotationOutcome =
  | { status: 'OK'; deletedId: string }
  | { status: 'NOT_FOUND' }
  | { status: 'FORBIDDEN'; message: string };

export type ImportAnnotationsOutcome =
  | { status: 'OK'; importedCount: number; annotations: AnnotationDomainSnapshot[] }
  | { status: 'MODEL_NOT_FOUND' }
  | {
      status: 'HASH_MISMATCH';
      expectedFileHash: string;
      actualFileHash: string;
    }
  | {
      status: 'VALIDATION_FAILED';
      itemErrors: ImportItemError[];
    };

export class AnnotationService {
  private readonly repo: AnnotationRepositoryPort;
  private readonly clock: ClockPort;
  private readonly realtime: RealtimePublisherPort;

  constructor(
    repo?: AnnotationRepositoryPort,
    clock?: ClockPort,
    realtime?: RealtimePublisherPort,
  ) {
    this.repo = repo ?? new InMemoryAnnotationRepository();
    this.clock = clock ?? { now: () => new Date() };
    this.realtime = realtime ?? { publishToModelRoom: () => {} };
  }

  public seedRecord(record: InternalDbAnnotationRecord): void {
    if (this.repo instanceof InMemoryAnnotationRepository) {
      this.repo.seedRecord(record);
    }
  }

  public getOperationalLogs(): ReadonlyArray<OperationalAuditLogEntry> {
    return this.repo.getAuditLogs();
  }

  public async purgeExpiredOperationalLogs(): Promise<number> {
    return this.repo.purgeExpiredAuditLogs(this.clock.now());
  }

  /**
   * [A10] Computes operational telemetry and evaluates ADR-001 architecture review threshold (> 8% conflict rate).
   */
  public getOperationalTelemetry(): OperationalTelemetryDto {
    const nowMs = this.clock.now().getTime();
    const activeLogs = this.repo
      .getAuditLogs()
      .filter((entry) => Date.parse(entry.expiresAt) > nowMs);

    let updatedCount = 0;
    let conflictCount = 0;
    let invariantViolationCount = 0;

    for (const log of activeLogs) {
      if (log.outcome === 'UPDATED') updatedCount++;
      else if (log.outcome === 'CONCURRENCY_CONFLICT') conflictCount++;
      else if (log.outcome === 'INVARIANT_VIOLATION') invariantViolationCount++;
    }

    const totalPatchAttempts = updatedCount + conflictCount + invariantViolationCount;
    const conflictRate = totalPatchAttempts > 0 ? conflictCount / totalPatchAttempts : 0;
    const conflictRatePercent = Math.round(conflictRate * 10_000) / 100;

    return {
      windowDays: OPERATIONAL_LOG_TTL_DAYS,
      totalAuditEvents: activeLogs.length,
      totalPatchAttempts,
      updatedCount,
      conflictCount,
      invariantViolationCount,
      conflictRate,
      conflictRatePercent,
      adr001Threshold: ADR_001_CONFLICT_RATE_THRESHOLD,
      adr001ReviewTriggered: conflictRate > ADR_001_CONFLICT_RATE_THRESHOLD,
      generatedAt: this.clock.now().toISOString(),
    };
  }

  private toDomainSnapshot(row: InternalDbAnnotationRecord): AnnotationDomainSnapshot {
    // Information Hiding: strips `internal_storage_bucket_token` and maps DB snake_case to domain contract
    return {
      id: row.id,
      modelId: row.model_id,
      authorId: row.author_id,
      authorName: row.author_name,
      status: row.status,
      version: row.version,
      position: [...row.position] as Vec3,
      normal: [...row.normal] as Vec3,
      cameraState: row.camera_state
        ? {
            position: [...row.camera_state.position] as Vec3,
            target: [...row.camera_state.target] as Vec3,
          }
        : {
            position: [0, 0, 5],
            target: [...row.position] as Vec3,
          },
      meshName: row.mesh_name,
      comments: row.comments.map((c) => ({ ...c })),
      createdAt: row.created_at ?? row.updated_at,
      updatedAt: row.updated_at,
    };
  }

  private buildOperationalLog(
    annotationId: string,
    actorId: string,
    outcome: OperationalAuditLogEntry['outcome'],
    expectedVersion: number,
    actualVersion: number,
  ): OperationalAuditLogEntry {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + OPERATIONAL_LOG_TTL_DAYS * 24 * 60 * 60 * 1000);
    return {
      eventId: `${annotationId}-${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`,
      annotationId,
      actorId,
      outcome,
      expectedVersion,
      actualVersion,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };
  }

  public async listAnnotations(
    modelId: string,
    query: ListAnnotationsQueryDto = {},
  ): Promise<PaginatedAnnotationsResponseDto> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const { rows, nextCursor, totalCount } = await this.repo.listByModel(modelId, {
      status: query.status,
      cursor: query.cursor,
      limit,
      updatedAfter: query.updatedAfter,
    });
    return {
      items: rows.map((r) => this.toDomainSnapshot(r)),
      nextCursor,
      totalCount,
      serverTime: this.clock.now().toISOString(),
    };
  }

  public async createAnnotation(
    modelId: string,
    actorId: string,
    dto: CreateAnnotationRequestDto,
  ): Promise<
    | { status: 'OK'; snapshot: AnnotationDomainSnapshot }
    | { status: 'INVALID_INPUT'; errorCode: string; message: string }
  > {
    const pickCheck = validateSurfacePick({
      position: dto.position,
      normal: dto.normal,
      cameraState: dto.cameraState,
      meshName: dto.meshName,
    });
    if (!pickCheck.valid) {
      return {
        status: 'INVALID_INPUT',
        errorCode: 'INVALID_UNIT_NORMAL_VECTOR',
        message: pickCheck.error ?? 'Invalid spatial anchor',
      };
    }
    if (!dto.initialComment || dto.initialComment.trim().length === 0) {
      return {
        status: 'INVALID_INPUT',
        errorCode: 'VALIDATION_FAILED',
        message: 'initialComment is required when creating an annotation.',
      };
    }

    const nowIso = this.clock.now().toISOString();
    const id = `ann-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const record: InternalDbAnnotationRecord = {
      id,
      model_id: modelId,
      author_id: actorId,
      status: 'OPEN',
      version: 1,
      position: [...dto.position] as Vec3,
      normal: [...dto.normal] as Vec3,
      camera_state: {
        position: [...dto.cameraState.position] as Vec3,
        target: [...dto.cameraState.target] as Vec3,
      },
      mesh_name: dto.meshName,
      comments: [
        {
          id: `cmt-${Date.now()}-1`,
          authorId: actorId,
          content: dto.initialComment.trim(),
          createdAt: nowIso,
        },
      ],
      created_at: nowIso,
      updated_at: nowIso,
    };

    const audit = this.buildOperationalLog(id, actorId, 'CREATED', 0, 1);
    await this.repo.insert(record, audit);
    const snapshot = this.toDomainSnapshot(record);

    this.realtime.publishToModelRoom(modelId, {
      type: 'annotation:created',
      eventId: audit.eventId,
      modelId,
      emittedAt: nowIso,
      annotation: snapshot,
    });

    return { status: 'OK', snapshot };
  }

  public async addComment(
    annotationId: string,
    actorId: string,
    dto: CreateCommentRequestDto,
  ): Promise<
    | { status: 'OK'; snapshot: AnnotationDomainSnapshot }
    | { status: 'NOT_FOUND' }
    | { status: 'INVALID_INPUT'; errorCode: string; message: string }
  > {
    const current = await this.repo.findById(annotationId);
    if (!current) {
      return { status: 'NOT_FOUND' };
    }
    if (current.status === 'ARCHIVED') {
      return {
        status: 'INVALID_INPUT',
        errorCode: 'ANNOTATION_ARCHIVED_IMMUTABLE',
        message: 'Cannot comment on an archived annotation.',
      };
    }
    if (!dto.content || dto.content.trim().length === 0) {
      return {
        status: 'INVALID_INPUT',
        errorCode: 'VALIDATION_FAILED',
        message: 'Comment content cannot be empty.',
      };
    }

    const nowIso = this.clock.now().toISOString();
    const newComment = {
      id: `cmt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      authorId: actorId,
      content: dto.content.trim(),
      createdAt: nowIso,
    };
    const nextVersion = current.version + 1;
    const updatedRow: InternalDbAnnotationRecord = {
      ...current,
      version: nextVersion,
      comments: [...current.comments, newComment],
      updated_at: nowIso,
    };
    const audit = this.buildOperationalLog(annotationId, actorId, 'COMMENTED', current.version, nextVersion);
    await this.repo.updateIfVersion(annotationId, current.version, updatedRow, audit);
    const snapshot = this.toDomainSnapshot(updatedRow);

    this.realtime.publishToModelRoom(current.model_id, {
      type: 'comment:created',
      eventId: audit.eventId,
      modelId: current.model_id,
      emittedAt: nowIso,
      annotationId,
      previousVersion: current.version,
      annotationVersion: nextVersion,
      comment: newComment,
    });

    return { status: 'OK', snapshot };
  }

  public async updateWithConcurrencyControl(
    id: string,
    actorId: string,
    command: {
      expectedVersion: number;
      status?: AnnotationStatus;
      position?: Vec3;
      normal?: Vec3;
      cameraState?: CameraState;
    },
    actorRole: UserRole = 'REVIEWER',
  ): Promise<UpdateAnnotationOutcome> {
    const current = await this.repo.findById(id);
    if (!current) {
      return { status: 'NOT_FOUND' };
    }

    // 0. RBAC Permission Gate (from @spriter/shared)
    if (command.status === 'ARCHIVED') {
      const canArchive = canActorModifyAnnotation(
        { id: actorId, role: actorRole },
        { authorId: current.author_id },
        'ARCHIVE',
      );
      if (!canArchive) {
        return {
          status: 'FORBIDDEN',
          message: 'Only the annotation author or a PROJECT_LEAD can archive an annotation.',
        };
      }
    }

    // 1. Optimistic Concurrency Pre-Check
    if (current.version !== command.expectedVersion) {
      const serverSnapshot = this.toDomainSnapshot(current);
      const conflictAudit = this.buildOperationalLog(
        id,
        actorId,
        'CONCURRENCY_CONFLICT',
        command.expectedVersion,
        current.version,
      );
      await this.repo.appendAuditLog(conflictAudit);
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
      const violationAudit = this.buildOperationalLog(
        id,
        actorId,
        'INVARIANT_VIOLATION',
        command.expectedVersion,
        current.version,
      );
      await this.repo.appendAuditLog(violationAudit);
      return {
        status: 'INVARIANT_VIOLATED',
        reasonCode: policyResult.reasonCode ?? 'INVARIANT_VIOLATION',
        message: policyResult.message ?? 'Domain invariant check failed.',
      };
    }

    // 3. Atomic Version Increment & State Commit
    const nowIso = this.clock.now().toISOString();
    const nextVersion = current.version + 1;
    const updatedRow: InternalDbAnnotationRecord = {
      ...current,
      status: command.status ?? current.status,
      position: command.position ?? current.position,
      normal: command.normal ?? current.normal,
      camera_state: command.cameraState ?? current.camera_state,
      version: nextVersion,
      updated_at: nowIso,
    };

    const updateAudit = this.buildOperationalLog(
      id,
      actorId,
      'UPDATED',
      command.expectedVersion,
      nextVersion,
    );

    const committed = await this.repo.updateIfVersion(
      id,
      command.expectedVersion,
      updatedRow,
      updateAudit,
    );

    if (!committed) {
      const latest = (await this.repo.findById(id)) ?? current;
      const raceConflictAudit = this.buildOperationalLog(
        id,
        actorId,
        'CONCURRENCY_CONFLICT',
        command.expectedVersion,
        latest.version,
      );
      await this.repo.appendAuditLog(raceConflictAudit);
      return {
        status: 'CONCURRENCY_CONFLICT',
        currentVersion: latest.version,
        serverSnapshot: this.toDomainSnapshot(latest),
      };
    }

    const snapshot = this.toDomainSnapshot(updatedRow);
    // 4. Emit Realtime Event ONLY AFTER transaction committed
    this.realtime.publishToModelRoom(current.model_id, {
      type: 'annotation:updated',
      eventId: updateAudit.eventId,
      modelId: current.model_id,
      emittedAt: nowIso,
      previousVersion: command.expectedVersion,
      annotation: snapshot,
    });

    return {
      status: 'OK',
      snapshot,
    };
  }

  public async deleteAnnotation(
    id: string,
    actorId: string,
    actorRole: UserRole = 'REVIEWER',
  ): Promise<DeleteAnnotationOutcome> {
    const current = await this.repo.findById(id);
    if (!current) {
      return { status: 'NOT_FOUND' };
    }

    const canDelete = canActorModifyAnnotation(
      { id: actorId, role: actorRole },
      { authorId: current.author_id },
      'DELETE',
    );
    if (!canDelete) {
      return {
        status: 'FORBIDDEN',
        message: 'Only the annotation author or a PROJECT_LEAD can delete an annotation.',
      };
    }

    const nowIso = this.clock.now().toISOString();
    const deleteAudit = this.buildOperationalLog(
      id,
      actorId,
      'UPDATED',
      current.version,
      current.version + 1,
    );
    const deleted = await this.repo.deleteById(id, deleteAudit);
    if (!deleted) {
      return { status: 'NOT_FOUND' };
    }

    this.realtime.publishToModelRoom(current.model_id, {
      type: 'annotation:deleted',
      eventId: deleteAudit.eventId,
      modelId: current.model_id,
      emittedAt: nowIso,
      annotationId: id,
    });

    return { status: 'OK', deletedId: id };
  }

  public async exportModelAnnotations(
    modelId: string,
  ): Promise<{ status: 'OK'; data: ExportFileV1 } | { status: 'MODEL_NOT_FOUND' }> {
    const model = await this.repo.findModelById(modelId);
    if (!model) {
      return { status: 'MODEL_NOT_FOUND' };
    }
    const { rows } = await this.repo.listByModel(modelId, { limit: 1000 });
    return {
      status: 'OK',
      data: {
        schemaVersion: '1.0',
        exportedAt: this.clock.now().toISOString(),
        modelMeta: {
          name: model.name,
          fileHash: model.fileHash,
        },
        annotations: rows.map((r) => this.toDomainSnapshot(r)),
      },
    };
  }

  public async importModelAnnotations(
    modelId: string,
    actorId: string,
    dto: ImportAnnotationsRequestDto,
  ): Promise<ImportAnnotationsOutcome> {
    const model = await this.repo.findModelById(modelId);
    if (!model) {
      return { status: 'MODEL_NOT_FOUND' };
    }

    const mode = dto.mode ?? 'STRICT';
    if (
      mode === 'STRICT' &&
      dto.payload.modelMeta?.fileHash &&
      dto.payload.modelMeta.fileHash !== model.fileHash
    ) {
      return {
        status: 'HASH_MISMATCH',
        expectedFileHash: model.fileHash,
        actualFileHash: dto.payload.modelMeta.fileHash,
      };
    }

    const validation = validateExportPayload(dto.payload);
    if (!validation.valid) {
      return {
        status: 'VALIDATION_FAILED',
        itemErrors: validation.itemErrors,
      };
    }

    const nowIso = this.clock.now().toISOString();
    const records: InternalDbAnnotationRecord[] = [];
    const audits: OperationalAuditLogEntry[] = [];

    for (const item of dto.payload.annotations) {
      const version = Number.isInteger(item.version) && item.version >= 1 ? item.version : 1;
      records.push({
        id: item.id,
        model_id: modelId,
        author_id: item.authorId,
        author_name: item.authorName,
        status: item.status,
        version,
        position: [...item.position] as Vec3,
        normal: [...item.normal] as Vec3,
        camera_state: item.cameraState,
        mesh_name: item.meshName,
        comments: item.comments ?? [],
        created_at: item.createdAt ?? nowIso,
        updated_at: nowIso,
      });
      audits.push(this.buildOperationalLog(item.id, actorId, 'CREATED', 0, version));
    }

    await this.repo.bulkReplaceOrInsert(modelId, records, audits);
    const snapshots = records.map((r) => this.toDomainSnapshot(r));

    return {
      status: 'OK',
      importedCount: snapshots.length,
      annotations: snapshots,
    };
  }
}
