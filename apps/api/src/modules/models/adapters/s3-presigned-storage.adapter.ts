import { createHmac } from 'node:crypto';
import {
  type InternalDbModelRecord,
  type ModelRepositoryPort,
  type ObjectStoragePresignerPort,
} from '../domain/ports.ts';

export class S3CompatiblePresignerAdapter implements ObjectStoragePresignerPort {
  private readonly endpointBaseUrl: string;
  private readonly bucketName: string;
  private readonly signingSecret: string;

  constructor(
    endpointBaseUrl = process.env.S3_ENDPOINT ?? 'http://localhost:9000',
    bucketName = process.env.S3_BUCKET ?? 'spriter-models',
    signingSecret = process.env.S3_SECRET_KEY ?? 'spriter-minio-secret-key',
  ) {
    this.endpointBaseUrl = endpointBaseUrl.replace(/\/$/, '');
    this.bucketName = bucketName;
    this.signingSecret = signingSecret;
  }

  public async createPresignedPutUrl(params: {
    storageKey: string;
    fileSize: number;
    fileHash: string;
    expiresInSeconds: number;
  }): Promise<string> {
    const signature = createHmac('sha256', this.signingSecret)
      .update(`PUT:${this.bucketName}/${params.storageKey}:${params.fileSize}:${params.fileHash}:${params.expiresInSeconds}`)
      .digest('hex');

    return (
      `${this.endpointBaseUrl}/${this.bucketName}/${params.storageKey}` +
      `?X-Amz-Algorithm=AWS4-HMAC-SHA256` +
      `&X-Amz-Expires=${params.expiresInSeconds}` +
      `&X-Spriter-Content-Length=${params.fileSize}` +
      `&X-Spriter-Sha256=${params.fileHash}` +
      `&X-Amz-Signature=${signature}`
    );
  }

  public async createPresignedGetUrl(params: {
    storageKey: string;
    expiresInSeconds: number;
  }): Promise<string> {
    const signature = createHmac('sha256', this.signingSecret)
      .update(`GET:${this.bucketName}/${params.storageKey}:${params.expiresInSeconds}`)
      .digest('hex');

    return (
      `${this.endpointBaseUrl}/${this.bucketName}/${params.storageKey}` +
      `?X-Amz-Algorithm=AWS4-HMAC-SHA256` +
      `&X-Amz-Expires=${params.expiresInSeconds}` +
      `&X-Amz-Signature=${signature}`
    );
  }
}

export class InMemoryModelRepository implements ModelRepositoryPort {
  private readonly store = new Map<string, InternalDbModelRecord>([
    [
      'model-gltf-01',
      {
        id: 'model-gltf-01',
        name: 'turbine_housing_v1.glb',
        storage_key: 'models/model-gltf-01/turbine_housing_v1.glb',
        file_size: 14_520_832,
        file_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        status: 'READY',
        uploaded_by: 'user-lead-nekover2',
        created_at: '2026-10-25T00:00:00.000Z',
      },
    ],
  ]);

  private readonly onModelReadyCallback?: (model: {
    id: string;
    name: string;
    fileHash: string;
  }) => void;

  constructor(
    onModelReadyCallback?: (model: { id: string; name: string; fileHash: string }) => void,
  ) {
    this.onModelReadyCallback = onModelReadyCallback;
  }

  public async findById(id: string): Promise<InternalDbModelRecord | undefined> {
    return this.store.get(id);
  }

  public async listAll(): Promise<InternalDbModelRecord[]> {
    return Array.from(this.store.values());
  }

  public async save(record: InternalDbModelRecord): Promise<void> {
    this.store.set(record.id, structuredClone(record));
    if (record.status === 'READY' && this.onModelReadyCallback) {
      this.onModelReadyCallback({
        id: record.id,
        name: record.name,
        fileHash: record.file_hash,
      });
    }
  }
}
