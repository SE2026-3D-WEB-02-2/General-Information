import {
  type PolicyReasonCode,
  type ViewportPinMarker,
} from '@spriter/shared';
import {
  handlePinDrag,
  type PinDragDecision,
} from './pin-drag-guard.ts';
import {
  type CameraState,
  type SurfacePick,
  type ViewportBridge,
  validateSurfacePick,
} from './bridge.ts';

/**
 * In-memory FakeViewportBridge so Stream C (UI) and automated tests can simulate 3D raycast picks,
 * pin selection, and camera focus transitions without initializing WebGL / Three.js.
 */
export class FakeViewportBridge implements ViewportBridge {
  private readonly pickHandlers = new Set<(pick: SurfacePick) => void>();
  private readonly pinSelectHandlers = new Set<(annotationId: string) => void>();
  private renderedPins: ReadonlyArray<ViewportPinMarker> = [];
  private lastFocusedCamera: { cameraState: CameraState; annotationId?: string } | null = null;
  private placementMode = false;
  private pinDragCursor: PinDragDecision['cursor'] = 'grab';
  private lastPinDragRejection: { annotationId: string; reasonCode: PolicyReasonCode } | null = null;

  public onSurfacePicked(handler: (pick: SurfacePick) => void): () => void {
    this.pickHandlers.add(handler);
    return () => this.pickHandlers.delete(handler);
  }

  public onPinSelected(handler: (annotationId: string) => void): () => void {
    this.pinSelectHandlers.add(handler);
    return () => this.pinSelectHandlers.delete(handler);
  }

  public setPins(pins: ReadonlyArray<ViewportPinMarker>): void {
    this.renderedPins = [...pins];
  }

  public focusCamera(cameraState: CameraState, annotationId?: string): void {
    this.lastFocusedCamera = { cameraState, annotationId };
  }

  public setPlacementMode(enabled: boolean): void {
    this.placementMode = enabled;
  }

  // --- Test & Simulation Helpers ---

  /** Simulate the viewport result after a pointer drag resolves a candidate anchor. */
  public simulatePinDrag(
    annotationId: string,
    candidate: Pick<ViewportPinMarker, 'position' | 'normal'>,
  ): PinDragDecision {
    const pin = this.renderedPins.find((marker) => marker.id === annotationId);
    if (!pin) {
      throw new Error(`PIN_NOT_FOUND:${annotationId}`);
    }

    this.lastPinDragRejection = null;
    return handlePinDrag(pin, candidate, {
      setCursor: (cursor) => {
        this.pinDragCursor = cursor;
      },
      applyAnchor: (id, position, normal) => {
        this.renderedPins = this.renderedPins.map((marker) =>
          marker.id === id ? { ...marker, position, normal } : marker,
        );
      },
      onBlocked: (id, reasonCode) => {
        this.lastPinDragRejection = { annotationId: id, reasonCode };
      },
    });
  }

  public getPinDragCursor(): PinDragDecision['cursor'] {
    return this.pinDragCursor;
  }

  public getLastPinDragRejection(): { annotationId: string; reasonCode: PolicyReasonCode } | null {
    return this.lastPinDragRejection;
  }

  public emitSurfacePick(pick: SurfacePick): void {
    const check = validateSurfacePick(pick);
    if (!check.valid) {
      throw new Error(`INVALID_SURFACE_PICK:${check.error}`);
    }
    for (const h of this.pickHandlers) {
      h(pick);
    }
  }

  public emitPinClick(annotationId: string): void {
    for (const h of this.pinSelectHandlers) {
      h(annotationId);
    }
  }

  public getRenderedPins(): ReadonlyArray<ViewportPinMarker> {
    return this.renderedPins;
  }

  public getLastFocusedCamera(): { cameraState: CameraState; annotationId?: string } | null {
    return this.lastFocusedCamera;
  }

  public isPlacementMode(): boolean {
    return this.placementMode;
  }
}
