import {
  type AnnotationDomainSnapshot,
  type AnnotationStatus,
  evaluateAnnotationMutation,
  type PolicyEvaluationResult,
  shouldApplyIncomingSnapshot,
} from '../../../../../packages/shared/src/domain/annotation-policy.ts';

// [AFTER REFACTORING]
// - Delegates all business rule checks to shared Pure Domain Policy (packages/shared)
// - Decoupled from THREE.Vector3 and raw fetch/socket via injected port interfaces
// - Sends expectedVersion (If-Match / OCC) and guards against stale out-of-order WebSocket events

export interface AnnotationApiPort {
  patchAnnotation(
    id: string,
    payload: {
      expectedVersion: number;
      status?: AnnotationStatus;
      position?: [number, number, number];
      normal?: [number, number, number];
    },
  ): Promise<
    | { ok: true; data: AnnotationDomainSnapshot }
    | {
        ok: false;
        statusCode: 409 | 422;
        errorCode: string;
        serverSnapshot?: AnnotationDomainSnapshot;
      }
  >;
}

export interface RealtimeSubscriptionPort {
  onAnnotationUpdated(handler: (snapshot: AnnotationDomainSnapshot) => void): void;
}

export class AnnotationThreadPanelController {
  private currentAnnotation: AnnotationDomainSnapshot;
  private conflictSnapshot: AnnotationDomainSnapshot | null = null;
  private readonly apiPort: AnnotationApiPort;
  private readonly realtimePort: RealtimeSubscriptionPort;

  constructor(
    initial: AnnotationDomainSnapshot,
    apiPort: AnnotationApiPort,
    realtimePort: RealtimeSubscriptionPort,
  ) {
    this.currentAnnotation = initial;
    this.apiPort = apiPort;
    this.realtimePort = realtimePort;

    this.realtimePort.onAnnotationUpdated((incoming) => {
      if (
        incoming.id === this.currentAnnotation.id &&
        shouldApplyIncomingSnapshot(this.currentAnnotation.version, incoming.version)
      ) {
        this.currentAnnotation = incoming;
      }
    });
  }

  public getSnapshot(): AnnotationDomainSnapshot {
    return this.currentAnnotation;
  }

  public getConflictState(): AnnotationDomainSnapshot | null {
    return this.conflictSnapshot;
  }

  public canTransitionStatus(targetStatus: AnnotationStatus): PolicyEvaluationResult {
    return evaluateAnnotationMutation(this.currentAnnotation, { status: targetStatus });
  }

  public async updateStatus(targetStatus: AnnotationStatus): Promise<void> {
    const check = this.canTransitionStatus(targetStatus);
    if (!check.allowed) {
      throw new Error(`DOMAIN_PRECHECK_REJECTED:${check.reasonCode}`);
    }

    const result = await this.apiPort.patchAnnotation(this.currentAnnotation.id, {
      expectedVersion: this.currentAnnotation.version,
      status: targetStatus,
    });

    if (result.ok) {
      this.currentAnnotation = result.data;
      this.conflictSnapshot = null;
      return;
    }

    if (result.statusCode === 409 && result.serverSnapshot) {
      // Preserve user's context and surface server snapshot for conflict resolution instead of silent overwrite
      this.conflictSnapshot = result.serverSnapshot;
      throw new Error(`CONCURRENCY_CONFLICT:v${result.serverSnapshot.version}`);
    }

    throw new Error(`API_REJECTED:${result.errorCode}`);
  }
}
