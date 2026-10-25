import {
  type CameraState,
  type SurfacePick,
  type ViewportBridge,
  type ViewportPinMarker,
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
