import {
  type ConfirmModelUploadDto,
  MAX_API_JSON_BODY_BYTES,
  type ModelSummaryDto,
  type PresignedUploadResponseDto,
  type RequestModelUploadUrlDto,
} from '@spriter/shared';
import {
  InMemoryModelRepository,
  S3CompatiblePresignerAdapter,
} from '../adapters/s3-presigned-storage.adapter.ts';
import {
  type InternalDbModelRecord,
  type ModelRepositoryPort,
  type ObjectStoragePresignerPort,
} from './ports.ts';

export const PRESIGNED_URL_TTL_SECONDS = 900; // 15 minutes
const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/i;

export class ModelService {
  private readonly repo: ModelRepositoryPort;
  private readonly storage: ObjectStoragePresignerPort;
  private readonly nowFn: () => Date;

  constructor(
    repo?: ModelRepositoryPort,
    storage?: ObjectStoragePresignerPort,
    nowFn: () => Date = () => new Date(),
  ) {
    this.repo = repo ?? new InMemoryModelRepository();
    this.storage = storage ?? new S3CompatiblePresignerAdapter();
    this.nowFn = nowFn;
  }

  private async toModelSummary(record: InternalDbModelRecord): Promise<ModelSummaryDto> {
    const downloadUrl =
      record.status === 'READY'
        ? await this.storage.createPresignedGetUrl({
            storageKey: record.storage_key,
            expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
          })
        : undefined;

    return {
      id: record.id,
      name: record.name,
      storageKey: record.storage_key,
      fileSize: record.file_size,
      fileHash: record.file_hash,
      status: record.status,
      uploadedBy: record.uploaded_by,
      ...(downloadUrl ? { downloadUrl } : {}),
      createdAt: record.created_at,
    };
  }

  public async requestPresignedUpload(
    actorId: string,
    dto: RequestModelUploadUrlDto,
  ): Promise<
    | { status: 'OK'; data: PresignedUploadResponseDto }
    | { status: 'INVALID_INPUT'; message: string }
  > {
    const fileName = dto.fileName?.trim();
    if (!fileName || !/\.(glb|gltf)$/i.test(fileName)) {
      return {
        status: 'INVALID_INPUT',
        message: 'fileName must have a .glb or .gltf extension.',
      };
    }
    if (!Number.isInteger(dto.fileSize) || dto.fileSize <= 0) {
      return {
        status: 'INVALID_INPUT',
        message: 'fileSize must be a positive integer (bytes).',
      };
    }
    if (!dto.fileHash || !SHA256_HEX_REGEX.test(dto.fileHash)) {
      return {
        status: 'INVALID_INPUT',
        message: 'fileHash must be a valid 64-character SHA-256 hex digest.',
      };
    }

    const modelId = `model-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storageKey = `models/${modelId}/${safeName}`;
    const fileHashLower = dto.fileHash.toLowerCase();

    const record: InternalDbModelRecord = {
      id: modelId,
      name: fileName,
      storage_key: storageKey,
      file_size: dto.fileSize,
      file_hash: fileHashLower,
      status: 'UPLOAD_PENDING',
      uploaded_by: actorId,
      created_at: this.nowFn().toISOString(),
    };

    await this.repo.save(record);

    const uploadUrl = await this.storage.createPresignedPutUrl({
      storageKey,
      fileSize: dto.fileSize,
      fileHash: fileHashLower,
      expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
    });

    return {
      status: 'OK',
      data: {
        modelId,
        uploadUrl,
        storageKey,
        expiresInSeconds: PRESIGNED_URL_TTL_SECONDS,
        maxApiJsonBodyBytes: MAX_API_JSON_BODY_BYTES,
      },
    };
  }

  public async confirmModelUpload(
    modelId: string,
    dto: ConfirmModelUploadDto,
  ): Promise<
    | { status: 'OK'; model: ModelSummaryDto }
    | { status: 'NOT_FOUND' }
    | { status: 'HASH_OR_SIZE_MISMATCH'; message: string }
  > {
    const existing = await this.repo.findById(modelId);
    if (!existing) {
      return { status: 'NOT_FOUND' };
    }

    const normalizedHash = dto.fileHash?.toLowerCase();
    if (normalizedHash !== existing.file_hash || dto.fileSize !== existing.file_size) {
      return {
        status: 'HASH_OR_SIZE_MISMATCH',
        message:
          'Confirmed fileHash or fileSize does not match the presigned upload reservation.',
      };
    }

    const updated: InternalDbModelRecord = {
      ...existing,
      status: 'READY',
    };
    await this.repo.save(updated);

    return {
      status: 'OK',
      model: await this.toModelSummary(updated),
    };
  }

  public async getModelById(
    modelId: string,
  ): Promise<{ status: 'OK'; model: ModelSummaryDto } | { status: 'NOT_FOUND' }> {
    const record = await this.repo.findById(modelId);
    if (!record) {
      return { status: 'NOT_FOUND' };
    }
    return {
      status: 'OK',
      model: await this.toModelSummary(record),
    };
  }
}
