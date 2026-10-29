import {
  type AnnotationDomainSnapshot,
  type AnnotationStatus,
  type SurfacePick,
  type ViewportBridge,
  type ViewportPinMarker,
  classifyRealtimeVersionStep,
  shouldApplyIncomingSnapshot,
} from '@spriter/shared';

export interface ConflictContext {
  annotationId: string;
  attemptedPatch: {
    status?: AnnotationStatus;
    position?: [number, number, number];
    normal?: [number, number, number];
  };
  serverSnapshot: AnnotationDomainSnapshot;
}

/**
 * Authoritative Client-Side Annotation Store (owned by src/app/ composition root).
 * Coordinates state between Stream B (ViewportBridge) and Stream C (Collaboration UI).
 */
export class AnnotationWorkspaceStore {
  private readonly byId = new Map<string, AnnotationDomainSnapshot>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;
  private selectedId: string | null = null;
  private pendingPick: SurfacePick | null = null;
  private activeConflict: ConflictContext | null = null;
  private needsCatchUpFetch = false;
  private readonly bridge: ViewportBridge;

  constructor(bridge: ViewportBridge) {
    this.bridge = bridge;

    this.bridge.onSurfacePicked((pick) => {
      this.pendingPick = pick;
      this.bridge.setPlacementMode(false);
      this.notify();
    });

    this.bridge.onPinSelected((annotationId) => {
      this.selectAnnotation(annotationId, false);
    });
  }

  public upsertSnapshot(incoming: AnnotationDomainSnapshot): boolean {
    const current = this.byId.get(incoming.id);
    if (current && !shouldApplyIncomingSnapshot(current.version, incoming.version)) {
      return false;
    }
    this.byId.set(incoming.id, structuredClone(incoming));
    this.syncPinsToBridge();
    this.notify();
    return true;
  }

  public handleRealtimeUpdate(previousVersion: number, incoming: AnnotationDomainSnapshot): 'APPLY' | 'IGNORE_STALE' | 'APPLY_AND_FETCH_GAP' {
    const current = this.byId.get(incoming.id);
    const decision = classifyRealtimeVersionStep(
      current?.version,
      previousVersion,
      incoming.version,
    );
    if (decision === 'IGNORE_STALE') {
      return decision;
    }
    if (decision === 'APPLY_AND_FETCH_GAP') {
      this.needsCatchUpFetch = true;
    }
    this.byId.set(incoming.id, structuredClone(incoming));
    this.syncPinsToBridge();
    this.notify();
    return decision;
  }

  public selectAnnotation(annotationId: string | null, focusCamera = true): void {
    this.selectedId = annotationId;
    this.syncPinsToBridge();
    this.notify();
    if (annotationId && focusCamera) {
      const target = this.byId.get(annotationId);
      if (target) {
        this.bridge.focusCamera(target.cameraState, target.id);
      }
    }
  }

  public recordConflict(conflict: ConflictContext): void {
    this.activeConflict = conflict;
    this.notify();
  }

  /**
   * User chooses "Accept Server Version" in 409 Conflict modal:
   * Discards local pending patch and updates store to serverSnapshot.
   */
  public acceptServerConflictSnapshot(): AnnotationDomainSnapshot | null {
    if (!this.activeConflict) {
      return null;
    }
    const { serverSnapshot } = this.activeConflict;
    this.upsertSnapshot(serverSnapshot);
    this.activeConflict = null;
    this.notify();
    return serverSnapshot;
  }

  public removeAnnotation(annotationId: string): void {
    if (!this.byId.delete(annotationId)) return;
    if (this.selectedId === annotationId) this.selectedId = null;
    this.syncPinsToBridge();
    this.notify();
  }

  public clearAll(): void {
    this.byId.clear();
    this.selectedId = null;
    this.pendingPick = null;
    this.activeConflict = null;
    this.needsCatchUpFetch = false;
    this.syncPinsToBridge();
    this.notify();
  }

  public getAnnotations(): AnnotationDomainSnapshot[] {
    return Array.from(this.byId.values()).map((item) => structuredClone(item));
  }

  public getSelectedId(): string | null {
    return this.selectedId;
  }

  public clearPendingPick(): void {
    this.pendingPick = null;
    this.notify();
  }

  public clearMissedVersionGap(): void {
    this.needsCatchUpFetch = false;
    this.notify();
  }

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  public getRevision = (): number => this.revision;

  public getSelectedAnnotation(): AnnotationDomainSnapshot | undefined {
    return this.selectedId ? this.byId.get(this.selectedId) : undefined;
  }

  public getPendingPick(): SurfacePick | null {
    return this.pendingPick;
  }

  public getActiveConflict(): ConflictContext | null {
    return this.activeConflict;
  }

  public hasMissedVersionGap(): boolean {
    return this.needsCatchUpFetch;
  }

  private syncPinsToBridge(): void {
    const pins: ViewportPinMarker[] = Array.from(this.byId.values()).map((ann) => ({
      id: ann.id,
      position: ann.position,
      normal: ann.normal,
      status: ann.status,
      selected: ann.id === this.selectedId,
    }));
    this.bridge.setPins(pins);
  }

  private notify(): void {
    this.revision += 1;
    for (const listener of this.listeners) listener();
  }
}
