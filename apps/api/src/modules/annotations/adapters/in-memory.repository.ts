import {
  type AnnotationStatus,
  type OperationalAuditLogEntry,
  type AnnotationRepositoryPort,
  type InternalDbAnnotationRecord,
  type ModelMetadataRecord,
} from '../domain/ports.ts';

export class InMemoryAnnotationRepository implements AnnotationRepositoryPort {
  private readonly dbStore = new Map<string, InternalDbAnnotationRecord>();
  private readonly models = new Map<string, ModelMetadataRecord>([
    [
      'model-gltf-01',
      {
        id: 'model-gltf-01',
        name: 'turbine_housing_v1.glb',
        fileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      },
    ],
  ]);
  private readonly operationalLogs: OperationalAuditLogEntry[] = [];

  public seedModel(model: ModelMetadataRecord): void {
    this.models.set(model.id, structuredClone(model));
  }

  public seedRecord(record: InternalDbAnnotationRecord): void {
    this.dbStore.set(record.id, structuredClone(record));
  }

  public async findModelById(modelId: string): Promise<ModelMetadataRecord | undefined> {
    return this.models.get(modelId);
  }

  public async findById(id: string): Promise<InternalDbAnnotationRecord | undefined> {
    return this.dbStore.get(id);
  }

  public async listByModel(
    modelId: string,
    options: { status?: AnnotationStatus; cursor?: string; limit: number; updatedAfter?: string },
  ): Promise<{ rows: InternalDbAnnotationRecord[]; nextCursor: string | null; totalCount: number }> {
    let all = Array.from(this.dbStore.values()).filter((r) => r.model_id === modelId);
    if (options.status) {
      all = all.filter((r) => r.status === options.status);
    }
    if (options.updatedAfter) {
      const threshold = Date.parse(options.updatedAfter);
      all = all.filter((r) => Date.parse(r.updated_at) > threshold);
    }
    all.sort((a, b) => a.id.localeCompare(b.id));
    const totalCount = all.length;

    let startIdx = 0;
    if (options.cursor) {
      const foundIdx = all.findIndex((r) => r.id === options.cursor);
      if (foundIdx >= 0) {
        startIdx = foundIdx + 1;
      }
    }

    const slice = all.slice(startIdx, startIdx + options.limit);
    const nextCursor =
      startIdx + options.limit < all.length ? (slice[slice.length - 1]?.id ?? null) : null;

    return { rows: slice, nextCursor, totalCount };
  }

  public async insert(
    record: InternalDbAnnotationRecord,
    audit: OperationalAuditLogEntry,
  ): Promise<void> {
    this.dbStore.set(record.id, structuredClone(record));
    this.operationalLogs.push(audit);
  }

  public async updateIfVersion(
    id: string,
    expectedVersion: number,
    updatedRow: InternalDbAnnotationRecord,
    audit: OperationalAuditLogEntry,
  ): Promise<boolean> {
    const current = this.dbStore.get(id);
    if (!current || current.version !== expectedVersion) {
      return false;
    }
    this.dbStore.set(id, structuredClone(updatedRow));
    this.operationalLogs.push(audit);
    return true;
  }

  public async deleteById(id: string, audit: OperationalAuditLogEntry): Promise<boolean> {
    if (!this.dbStore.has(id)) {
      return false;
    }
    this.dbStore.delete(id);
    this.operationalLogs.push(audit);
    return true;
  }

  public async bulkReplaceOrInsert(
    _modelId: string,
    records: InternalDbAnnotationRecord[],
    audits: OperationalAuditLogEntry[],
  ): Promise<void> {
    for (const r of records) {
      this.dbStore.set(r.id, structuredClone(r));
    }
    this.operationalLogs.push(...audits);
  }

  public async appendAuditLog(audit: OperationalAuditLogEntry): Promise<void> {
    this.operationalLogs.push(audit);
  }

  public getAuditLogs(): ReadonlyArray<OperationalAuditLogEntry> {
    return this.operationalLogs;
  }

  public async purgeExpiredAuditLogs(now: Date): Promise<number> {
    const nowMs = now.getTime();
    const beforeCount = this.operationalLogs.length;
    const kept = this.operationalLogs.filter((entry) => Date.parse(entry.expiresAt) > nowMs);
    this.operationalLogs.length = 0;
    this.operationalLogs.push(...kept);
    return beforeCount - kept.length;
  }
}
