import { type AnnotationStatus } from '../../../../packages/shared/src/domain/annotation-policy.ts';
import { AnnotationService } from './annotation.service.ts';

// [AFTER REFACTORING]
// - Thin transport adapter: no duplicated business rules in controller
// - Enforces expectedVersion contract and maps domain outcomes to HTTP 200 / 409 / 422

export class AnnotationController {
  private readonly annotationService: AnnotationService;

  constructor(annotationService: AnnotationService) {
    this.annotationService = annotationService;
  }

  public async patchAnnotation(req: {
    params: { id: string };
    actorId: string;
    body: {
      expectedVersion: number;
      status?: AnnotationStatus;
      position?: [number, number, number];
      normal?: [number, number, number];
    };
  }) {
    if (!Number.isInteger(req.body.expectedVersion) || req.body.expectedVersion < 1) {
      return {
        statusCode: 400,
        body: { errorCode: 'MISSING_EXPECTED_VERSION', message: 'expectedVersion (int >= 1) is required' },
      };
    }

    const result = await this.annotationService.updateWithConcurrencyControl(
      req.params.id,
      req.actorId,
      req.body,
    );

    switch (result.status) {
      case 'NOT_FOUND':
        return { statusCode: 404, body: { errorCode: 'ANNOTATION_NOT_FOUND' } };
      case 'CONCURRENCY_CONFLICT':
        return {
          statusCode: 409,
          body: {
            errorCode: 'CONCURRENCY_CONFLICT',
            currentVersion: result.currentVersion,
            serverSnapshot: result.serverSnapshot,
          },
        };
      case 'INVARIANT_VIOLATED':
        return {
          statusCode: 422,
          body: {
            errorCode: result.reasonCode,
            message: result.message,
          },
        };
      case 'OK':
        return {
          statusCode: 200,
          body: result.snapshot,
        };
    }
  }
}
