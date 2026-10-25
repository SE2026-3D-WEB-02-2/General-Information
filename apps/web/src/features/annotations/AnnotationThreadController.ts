import {
  type AnnotationDomainSnapshot,
  type AnnotationStatus,
  evaluateAnnotationMutation,
  type PolicyEvaluationResult,
  shouldApplyIncomingSnapshot,
} from '@spriter/shared';

// [AFTER REFACTORING]
// - Extracted headless controller (.ts) from React/Three.js view (.tsx) for 100% Node unit testability
// - Delegates all business rule checks to shared Pure Domain Policy (@spriter/shared)
// - Sends expectedVersion (If-Match / OCC) and guards against stale out-of-order WebSocket events
// - Supports both inspecting 409 serverSnapshot and retrying pending change on top of latest version

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
  private pendingStatusAttempt: AnnotationStatus | null = null;
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

  public getPendingStatusAttempt(): AnnotationStatus | null {
    return this.pendingStatusAttempt;
  }

  public canTransitionStatus(targetStatus: AnnotationStatus): PolicyEvaluationResult {
    return evaluateAnnotationMutation(this.currentAnnotation, { status: targetStatus });
  }

  public async updateStatus(targetStatus: AnnotationStatus): Promise<void> {
    const check = this.canTransitionStatus(targetStatus);
    if (!check.allowed) {
      throw new Error(`DOMAIN_PRECHECK_REJECTED:${check.reasonCode}`);
    }

    this.pendingStatusAttempt = targetStatus;
    const result = await this.apiPort.patchAnnotation(this.currentAnnotation.id, {
      expectedVersion: this.currentAnnotation.version,
      status: targetStatus,
    });

    if (result.ok) {
      this.currentAnnotation = result.data;
      this.conflictSnapshot = null;
      this.pendingStatusAttempt = null;
      return;
    }

    if (result.statusCode === 409 && result.serverSnapshot) {
      this.conflictSnapshot = result.serverSnapshot;
      throw new Error(`CONCURRENCY_CONFLICT:v${result.serverSnapshot.version}`);
    }

    throw new Error(`API_REJECTED:${result.errorCode}`);
  }

  /**
   * Resolves a 409 Conflict by accepting the server's latest snapshot and re-applying
   * the user's pending status change on top of `conflictSnapshot.version` (if still allowed by policy).
   */
  public async retryPendingStatusOnLatestVersion(): Promise<void> {
    if (!this.conflictSnapshot || !this.pendingStatusAttempt) {
      throw new Error('NO_ACTIVE_CONFLICT_TO_RETRY');
    }
    this.currentAnnotation = this.conflictSnapshot;
    this.conflictSnapshot = null;
    await this.updateStatus(this.pendingStatusAttempt);
  }
}
