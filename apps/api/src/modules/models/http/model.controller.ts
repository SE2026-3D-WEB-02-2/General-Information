import {
  type ConfirmModelUploadDto,
  MAX_API_JSON_BODY_BYTES,
  type RequestModelUploadUrlDto,
} from '@spriter/shared';
import { ModelService } from '../domain/model.service.ts';

export class ModelController {
  private readonly modelService: ModelService;

  constructor(modelService?: ModelService) {
    this.modelService = modelService ?? new ModelService();
  }

  /**
   * Enforces the 1MB API body limit (`[A5]`).
   * Rejects direct binary .glb uploads or oversized bodies with 413 PAYLOAD_TOO_LARGE.
   */
  public checkDirectUploadGuard(headers?: {
    contentType?: string;
    contentLength?: number;
  }): { allowed: true } | { allowed: false; statusCode: 413; body: { errorCode: 'PAYLOAD_TOO_LARGE'; message: string } } {
    const contentType = headers?.contentType?.toLowerCase() ?? '';
    const contentLength = headers?.contentLength ?? 0;

    if (
      contentType.includes('model/gltf-binary') ||
      contentType.includes('application/octet-stream') ||
      contentLength > MAX_API_JSON_BODY_BYTES
    ) {
      return {
        allowed: false,
        statusCode: 413,
        body: {
          errorCode: 'PAYLOAD_TOO_LARGE',
          message: `API Server only accepts JSON metadata (<= ${MAX_API_JSON_BODY_BYTES} bytes). Upload .glb binaries directly to S3/MinIO using POST /api/v1/models/upload-url.`,
        },
      };
    }

    return { allowed: true };
  }

  public async requestUploadUrl(req: {
    actorId: string;
    headers?: { contentType?: string; contentLength?: number };
    body: RequestModelUploadUrlDto;
  }) {
    const guard = this.checkDirectUploadGuard(req.headers);
    if (!guard.allowed) {
      return { statusCode: guard.statusCode, body: guard.body };
    }

    const result = await this.modelService.requestPresignedUpload(req.actorId, req.body);
    if (result.status === 'INVALID_INPUT') {
      return {
        statusCode: 422 as const,
        body: { errorCode: 'VALIDATION_FAILED' as const, message: result.message },
      };
    }

    return {
      statusCode: 201 as const,
      body: result.data,
    };
  }

  public async confirmUpload(req: {
    params: { id: string };
    body: ConfirmModelUploadDto;
  }) {
    const result = await this.modelService.confirmModelUpload(req.params.id, req.body);
    switch (result.status) {
      case 'NOT_FOUND':
        return {
          statusCode: 404 as const,
          body: { errorCode: 'MODEL_NOT_FOUND' as const, message: 'Model upload record not found.' },
        };
      case 'HASH_OR_SIZE_MISMATCH':
        return {
          statusCode: 422 as const,
          body: { errorCode: 'VALIDATION_FAILED' as const, message: result.message },
        };
      case 'OK':
        return {
          statusCode: 200 as const,
          body: result.model,
        };
    }
  }

  public async getModel(req: { params: { id: string } }) {
    const result = await this.modelService.getModelById(req.params.id);
    if (result.status === 'NOT_FOUND') {
      return {
        statusCode: 404 as const,
        body: { errorCode: 'MODEL_NOT_FOUND' as const, message: '3D model not found.' },
      };
    }
    return {
      statusCode: 200 as const,
      body: result.model,
    };
  }
}
