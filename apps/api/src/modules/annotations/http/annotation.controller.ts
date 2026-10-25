import {
  type AnnotationStatus,
  type CameraState,
  type CreateAnnotationRequestDto,
  type CreateCommentRequestDto,
  type ImportAnnotationsRequestDto,
  type ListAnnotationsQueryDto,
  type Vec3,
} from '@spriter/shared';
import { AnnotationService } from '../domain/annotation.service.ts';

export class AnnotationController {
  private readonly annotationService: AnnotationService;

  constructor(annotationService: AnnotationService) {
    this.annotationService = annotationService;
  }

  public async listAnnotations(req: {
    params: { modelId: string };
    query?: ListAnnotationsQueryDto;
  }) {
    const page = await this.annotationService.listAnnotations(req.params.modelId, req.query);
    return { statusCode: 200 as const, body: page };
  }

  public async createAnnotation(req: {
    params: { modelId: string };
    actorId: string;
    body: CreateAnnotationRequestDto;
  }) {
    const result = await this.annotationService.createAnnotation(
      req.params.modelId,
      req.actorId,
      req.body,
    );
    if (result.status === 'INVALID_INPUT') {
      return {
        statusCode: 422 as const,
        body: { errorCode: result.errorCode, message: result.message },
      };
    }
    return { statusCode: 201 as const, body: result.snapshot };
  }

  public async addComment(req: {
    params: { id: string };
    actorId: string;
    body: CreateCommentRequestDto;
  }) {
    const result = await this.annotationService.addComment(
      req.params.id,
      req.actorId,
      req.body,
    );
    switch (result.status) {
      case 'NOT_FOUND':
        return {
          statusCode: 404 as const,
          body: { errorCode: 'ANNOTATION_NOT_FOUND', message: 'Annotation not found' },
        };
      case 'INVALID_INPUT':
        return {
          statusCode: 422 as const,
          body: { errorCode: result.errorCode, message: result.message },
        };
      case 'OK':
        return { statusCode: 201 as const, body: result.snapshot };
    }
  }

  public async patchAnnotation(req: {
    params: { id: string };
    actorId: string;
    body: {
      expectedVersion: number;
      status?: AnnotationStatus;
      position?: Vec3;
      normal?: Vec3;
      cameraState?: CameraState;
    };
  }) {
    if (!Number.isInteger(req.body.expectedVersion) || req.body.expectedVersion < 1) {
      return {
        statusCode: 400 as const,
        body: {
          errorCode: 'MISSING_EXPECTED_VERSION',
          message: 'expectedVersion (int >= 1) is required',
        },
      };
    }

    const result = await this.annotationService.updateWithConcurrencyControl(
      req.params.id,
      req.actorId,
      req.body,
    );

    switch (result.status) {
      case 'NOT_FOUND':
        return {
          statusCode: 404 as const,
          body: { errorCode: 'ANNOTATION_NOT_FOUND', message: 'Annotation not found' },
        };
      case 'CONCURRENCY_CONFLICT':
        return {
          statusCode: 409 as const,
          body: {
            errorCode: 'CONCURRENCY_CONFLICT',
            message: 'Annotation was modified by another user. Inspect serverSnapshot before retrying.',
            currentVersion: result.currentVersion,
            serverSnapshot: result.serverSnapshot,
          },
        };
      case 'INVARIANT_VIOLATED':
        return {
          statusCode: 422 as const,
          body: {
            errorCode: result.reasonCode,
            message: result.message,
          },
        };
      case 'OK':
        return {
          statusCode: 200 as const,
          body: result.snapshot,
        };
    }
  }

  public async importAnnotations(req: {
    params: { modelId: string };
    actorId: string;
    body: ImportAnnotationsRequestDto;
  }) {
    const result = await this.annotationService.importModelAnnotations(
      req.params.modelId,
      req.actorId,
      req.body,
    );

    switch (result.status) {
      case 'MODEL_NOT_FOUND':
        return {
          statusCode: 404 as const,
          body: { errorCode: 'MODEL_NOT_FOUND', message: 'Target 3D model not found' },
        };
      case 'HASH_MISMATCH':
        return {
          statusCode: 409 as const,
          body: {
            errorCode: 'IMPORT_MODEL_HASH_MISMATCH',
            message: 'Export fileHash does not match target 3D model fileHash.',
            expectedFileHash: result.expectedFileHash,
            actualFileHash: result.actualFileHash,
          },
        };
      case 'VALIDATION_FAILED':
        return {
          statusCode: 422 as const,
          body: {
            errorCode: 'IMPORT_VALIDATION_FAILED',
            message: `${result.itemErrors.length} annotation(s) failed domain invariant checks. Import rolled back.`,
            itemErrors: result.itemErrors,
          },
        };
      case 'OK':
        return {
          statusCode: 201 as const,
          body: {
            importedCount: result.importedCount,
            annotations: result.annotations,
          },
        };
    }
  }
}
