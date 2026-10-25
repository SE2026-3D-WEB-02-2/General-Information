import { type ModelUploadStatus } from '@spriter/shared';

export interface InternalDbModelRecord {
  id: string;
  name: string;
  storage_key: string;
  file_size: number;
  file_hash: string;
  status: ModelUploadStatus;
  uploaded_by: string;
  created_at: string;
}

export interface ObjectStoragePresignerPort {
  createPresignedPutUrl(params: {
    storageKey: string;
    fileSize: number;
    fileHash: string;
    expiresInSeconds: number;
  }): Promise<string>;

  createPresignedGetUrl(params: {
    storageKey: string;
    expiresInSeconds: number;
  }): Promise<string>;
}

export interface ModelRepositoryPort {
  findById(id: string): Promise<InternalDbModelRecord | undefined>;
  listAll(): Promise<InternalDbModelRecord[]>;
  save(record: InternalDbModelRecord): Promise<void>;
}
