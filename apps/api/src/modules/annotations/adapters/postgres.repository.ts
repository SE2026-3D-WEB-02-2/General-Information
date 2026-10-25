import {
  type AnnotationRepositoryPort,
  type AnnotationStatus,
  type InternalDbAnnotationRecord,
  type ModelMetadataRecord,
  type OperationalAuditLogEntry,
} from '../domain/ports.ts';

/**
 * Minimal SQL Executor port so PostgresAnnotationRepository remains decoupled from a specific driver
 * (compatible with `pg.Pool`, `postgres`, or a transactional test spy).
 */
export interface SqlExecutorPort {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: Row[]; rowCount: number }>;
  transaction<T>(fn: (tx: SqlExecutorPort) => Promise<T>): Promise<T>;
}

export class PostgresAnnotationRepository implements AnnotationRepositoryPort {
  private readonly db: SqlExecutorPort;
  private cachedLogs: OperationalAuditLogEntry[] = [];

  constructor(db: SqlExecutorPort) {
    this.db = db;
  }

  public async findModelById(modelId: string): Promise<ModelMetadataRecord | undefined> {
    const res = await this.db.query<{
      id: string;
      name: string;
      file_hash: string;
    }>(
      `SELECT id, name, file_hash
       FROM models
       WHERE id = $1 AND status = 'READY'
       LIMIT 1`,
      [modelId],
    );
    const row = res.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      fileHash: row.file_hash,
    };
  }

  public async findById(id: string): Promise<InternalDbAnnotationRecord | undefined> {
    const res = await this.db.query<InternalDbAnnotationRecord>(
      `SELECT
         a.id,
         a.model_id,
         a.author_id,
         u.name AS author_name,
         a.status,
         a.version,
         a.position,
         a.normal,
         a.camera_state,
         a.mesh_name,
         a.created_at,
         a.updated_at,
         COALESCE(
           (
             SELECT json_agg(
               json_build_object(
                 'id', c.id,
                 'annotationId', c.annotation_id,
                 'authorId', c.author_id,
                 'content', c.content,
                 'createdAt', c.created_at
               ) ORDER BY c.created_at ASC
             )
             FROM comments c
             WHERE c.annotation_id = a.id
           ),
           '[]'::json
         ) AS comments
       FROM annotations a
       LEFT JOIN users u ON u.id = a.author_id
       WHERE a.id = $1
       LIMIT 1`,
      [id],
    );
    return res.rows[0];
  }

  public async listByModel(
    modelId: string,
    options: { status?: AnnotationStatus; cursor?: string; limit: number; updatedAfter?: string },
  ): Promise<{ rows: InternalDbAnnotationRecord[]; nextCursor: string | null; totalCount: number }> {
    const countRes = await this.db.query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM annotations
       WHERE model_id = $1
         AND ($2::varchar IS NULL OR status = $2)
         AND ($3::timestamptz IS NULL OR updated_at > $3::timestamptz)`,
      [modelId, options.status ?? null, options.updatedAfter ?? null],
    );
    const totalCount = countRes.rows[0]?.total ?? 0;

    const listRes = await this.db.query<InternalDbAnnotationRecord>(
      `SELECT
         a.id,
         a.model_id,
         a.author_id,
         a.status,
         a.version,
         a.position,
         a.normal,
         a.camera_state,
         a.mesh_name,
         a.created_at,
         a.updated_at,
         COALESCE(
           (
             SELECT json_agg(
               json_build_object(
                 'id', c.id,
                 'annotationId', c.annotation_id,
                 'authorId', c.author_id,
                 'content', c.content,
                 'createdAt', c.created_at
               ) ORDER BY c.created_at ASC
             )
             FROM comments c
             WHERE c.annotation_id = a.id
           ),
           '[]'::json
         ) AS comments
       FROM annotations a
       WHERE a.model_id = $1
         AND ($2::varchar IS NULL OR a.status = $2)
         AND ($3::timestamptz IS NULL OR a.updated_at > $3::timestamptz)
         AND ($4::varchar IS NULL OR a.id > $4)
       ORDER BY a.id ASC
       LIMIT $5`,
      [modelId, options.status ?? null, options.updatedAfter ?? null, options.cursor ?? null, options.limit + 1],
    );

    const hasMore = listRes.rows.length > options.limit;
    const rows = hasMore ? listRes.rows.slice(0, options.limit) : listRes.rows;
    const nextCursor = hasMore ? (rows[rows.length - 1]?.id ?? null) : null;

    return { rows, nextCursor, totalCount };
  }

  public async insert(
    record: InternalDbAnnotationRecord,
    audit: OperationalAuditLogEntry,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO annotations (
           id, model_id, author_id, status, version, position, normal, camera_state, mesh_name, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11)`,
        [
          record.id,
          record.model_id,
          record.author_id,
          record.status,
          record.version,
          JSON.stringify(record.position),
          JSON.stringify(record.normal),
          JSON.stringify(record.camera_state ?? null),
          record.mesh_name ?? null,
          record.created_at ?? record.updated_at,
          record.updated_at,
        ],
      );

      for (const c of record.comments) {
        await tx.query(
          `INSERT INTO comments (id, annotation_id, author_id, content, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [c.id, record.id, c.authorId, c.content, c.createdAt],
        );
      }

      await this.insertAuditWithTx(tx, audit);
    });
  }

  /**
   * Atomic Compare-And-Swap (`WHERE id = $1 AND version = $2`) inside a transaction
   * alongside the 7-day operational audit log insert.
   */
  public async updateIfVersion(
    id: string,
    expectedVersion: number,
    updatedRow: InternalDbAnnotationRecord,
    audit: OperationalAuditLogEntry,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const updateRes = await tx.query(
        `UPDATE annotations
         SET status = $3,
             position = $4::jsonb,
             normal = $5::jsonb,
             camera_state = $6::jsonb,
             version = version + 1,
             updated_at = $7
         WHERE id = $1 AND version = $2`,
        [
          id,
          expectedVersion,
          updatedRow.status,
          JSON.stringify(updatedRow.position),
          JSON.stringify(updatedRow.normal),
          JSON.stringify(updatedRow.camera_state ?? null),
          updatedRow.updated_at,
        ],
      );

      if (updateRes.rowCount !== 1) {
        return false;
      }

      if (audit.outcome === 'COMMENTED') {
        const latestComment = updatedRow.comments[updatedRow.comments.length - 1];
        if (latestComment) {
          await tx.query(
            `INSERT INTO comments (id, annotation_id, author_id, content, created_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO NOTHING`,
            [latestComment.id, id, latestComment.authorId, latestComment.content, latestComment.createdAt],
          );
        }
      }

      await this.insertAuditWithTx(tx, audit);
      return true;
    });
  }

  public async deleteById(id: string, audit: OperationalAuditLogEntry): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const delRes = await tx.query(`DELETE FROM annotations WHERE id = $1`, [id]);
      if (delRes.rowCount !== 1) {
        return false;
      }
      await this.insertAuditWithTx(tx, audit);
      return true;
    });
  }

  public async bulkReplaceOrInsert(
    _modelId: string,
    records: InternalDbAnnotationRecord[],
    audits: OperationalAuditLogEntry[],
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const r of records) {
        await tx.query(
          `INSERT INTO annotations (
             id, model_id, author_id, status, version, position, normal, camera_state, mesh_name, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9, $10, $11)
           ON CONFLICT (id) DO UPDATE SET
             status = EXCLUDED.status,
             version = EXCLUDED.version,
             position = EXCLUDED.position,
             normal = EXCLUDED.normal,
             camera_state = EXCLUDED.camera_state,
             mesh_name = EXCLUDED.mesh_name,
             updated_at = EXCLUDED.updated_at`,
          [
            r.id,
            r.model_id,
            r.author_id,
            r.status,
            r.version,
            JSON.stringify(r.position),
            JSON.stringify(r.normal),
            JSON.stringify(r.camera_state ?? null),
            r.mesh_name ?? null,
            r.created_at ?? r.updated_at,
            r.updated_at,
          ],
        );

        for (const c of r.comments) {
          await tx.query(
            `INSERT INTO comments (id, annotation_id, author_id, content, created_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO NOTHING`,
            [c.id, r.id, c.authorId, c.content, c.createdAt],
          );
        }
      }

      for (const audit of audits) {
        await this.insertAuditWithTx(tx, audit);
      }
    });
  }

  public async appendAuditLog(audit: OperationalAuditLogEntry): Promise<void> {
    await this.insertAuditWithTx(this.db, audit);
  }

  public getAuditLogs(): ReadonlyArray<OperationalAuditLogEntry> {
    return this.cachedLogs;
  }

  public async purgeExpiredAuditLogs(now: Date): Promise<number> {
    const res = await this.db.query(
      `DELETE FROM operational_audit_logs WHERE expires_at <= $1::timestamptz`,
      [now.toISOString()],
    );
    const nowMs = now.getTime();
    this.cachedLogs = this.cachedLogs.filter((entry) => Date.parse(entry.expiresAt) > nowMs);
    return res.rowCount;
  }

  private async insertAuditWithTx(
    executor: Pick<SqlExecutorPort, 'query'>,
    audit: OperationalAuditLogEntry,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO operational_audit_logs (
         event_id, annotation_id, actor_id, outcome, expected_version, actual_version, created_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)`,
      [
        audit.eventId,
        audit.annotationId,
        audit.actorId,
        audit.outcome,
        audit.expectedVersion,
        audit.actualVersion,
        audit.createdAt,
        audit.expiresAt,
      ],
    );
    this.cachedLogs.push(audit);
  }
}
