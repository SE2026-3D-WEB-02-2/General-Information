import type { ModelSummaryDto } from '@spriter/shared';
import type { WorkspaceApiPort } from '../features/annotations/workspace-ports.ts';

export type BinaryUploader = (url: string, file: File, onProgress: (percent: number) => void) => Promise<void>;
export type FileHasher = (file: File) => Promise<string>;

export async function sha256File(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const uploadBinaryWithProgress: BinaryUploader = (url, file, onProgress) => new Promise((resolve, reject) => {
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', url);
  xhr.setRequestHeader('Content-Type', 'model/gltf-binary');
  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
  };
  xhr.onerror = () => reject(new Error('Không thể tải file lên kho lưu trữ.'));
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      onProgress(100);
      resolve();
    } else {
      reject(new Error(`Tải file thất bại (HTTP ${xhr.status}).`));
    }
  };
  xhr.send(file);
});

/** Request a URL, PUT the binary directly to object storage, then confirm metadata with the API. */
export class ModelUploadService {
  private readonly api: WorkspaceApiPort;
  private readonly uploadBinary: BinaryUploader;
  private readonly hashFile: FileHasher;
  constructor(
    api: WorkspaceApiPort,
    uploadBinary: BinaryUploader = uploadBinaryWithProgress,
    hashFile: FileHasher = sha256File,
  ) {
    this.api = api;
    this.uploadBinary = uploadBinary;
    this.hashFile = hashFile;
  }

  async upload(file: File, onProgress: (percent: number) => void): Promise<ModelSummaryDto> {
    if (!file.name.toLowerCase().endsWith('.glb')) throw new Error('Chỉ hỗ trợ file .glb.');
    const fileHash = await this.hashFile(file);
    const request = { fileName: file.name, fileSize: file.size, fileHash, contentType: 'model/gltf-binary' };
    const presigned = await this.api.requestUploadUrl(request);
    await this.uploadBinary(presigned.uploadUrl, file, onProgress);
    return this.api.confirmUpload(presigned.modelId, { fileSize: file.size, fileHash });
  }
}
