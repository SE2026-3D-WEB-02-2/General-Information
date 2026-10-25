import {
  type AnnotationDomainSnapshot,
  type AnnotationStatus,
  evaluateAnnotationMutation,
} from '@spriter/shared';
import { type AnnotationApiPort } from '../features/annotations/AnnotationThreadController.ts';

/**
 * In-Memory FakeAnnotationApi implementing AnnotationApiPort with full OCC version checking
 * and shared domain policy enforcement so Stream C (UI) can develop offline.
 */
export class FakeAnnotationApi implements AnnotationApiPort {
  private readonly store = new Map<string, AnnotationDomainSnapshot>();

  public seed(snapshot: AnnotationDomainSnapshot): void {
    this.store.set(snapshot.id, structuredClone(snapshot));
  }

  public async patchAnnotation(
    id: string,
    payload: {
      expectedVersion: number;
      status?: AnnotationStatus;
      position?: [number, number, number];
      normal?: [number, number, number];
    },
  ) {
    const current = this.store.get(id);
    if (!current) {
      return {
        ok: false as const,
        statusCode: 422 as const,
        errorCode: 'ANNOTATION_NOT_FOUND',
      };
    }

    if (current.version !== payload.expectedVersion) {
      return {
        ok: false as const,
        statusCode: 409 as const,
        errorCode: 'CONCURRENCY_CONFLICT',
        serverSnapshot: structuredClone(current),
      };
    }

    const check = evaluateAnnotationMutation(current, {
      status: payload.status,
      position: payload.position,
      normal: payload.normal,
    });

    if (!check.allowed) {
      return {
        ok: false as const,
        statusCode: 422 as const,
        errorCode: check.reasonCode ?? 'INVARIANT_VIOLATION',
      };
    }

    const updated: AnnotationDomainSnapshot = {
      ...current,
      status: payload.status ?? current.status,
      position: payload.position ?? current.position,
      normal: payload.normal ?? current.normal,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    };
    this.store.set(id, updated);

    return {
      ok: true as const,
      data: structuredClone(updated),
    };
  }
}
