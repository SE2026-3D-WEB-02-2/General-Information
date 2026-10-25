import {
  type AnnotationStatus,
  type CameraState,
  type Vec3,
  validateUnitNormal,
  validateVec3,
} from '../domain/annotation-policy.ts';

// ============================================================================
// 3D VIEWPORT <-> 2D COLLABORATION UI BRIDGE CONTRACT (STREAM B <-> STREAM C)
// ============================================================================

/**
 * Emitted by Stream B (3D Viewport Raycaster) when a user clicks on the 3D mesh while in placement mode.
 * Coordinates MUST be in Model-Local Space (not transformed world space).
 */
export interface SurfacePick {
  position: Vec3;
  normal: Vec3;
  cameraState: CameraState;
  meshName?: string;
}

/**
 * Lightweight Pin Marker projection pushed from Store/UI (Stream C) into 3D Viewport (Stream B).
 */
export interface ViewportPinMarker {
  id: string;
  position: Vec3;
  normal: Vec3;
  status: AnnotationStatus;
  selected: boolean;
}

/**
 * Strict boundary contract connecting Stream B (3D Viewport) and Stream C (Collaboration UI & Store).
 * Stream B implements this bridge; Stream C and Store consume it (or use FakeViewportBridge in tests).
 */
export interface ViewportBridge {
  /** Stream B -> Stream C: Fired when user raycast-clicks a valid point on the 3D mesh */
  onSurfacePicked(handler: (pick: SurfacePick) => void): () => void;
  /** Stream B -> Stream C: Fired when user clicks an existing 3D pin marker in the canvas */
  onPinSelected(handler: (annotationId: string) => void): () => void;
  /** Stream C -> Stream B: Updates the list of 3D pin markers rendered on the model */
  setPins(pins: ReadonlyArray<ViewportPinMarker>): void;
  /** Stream C -> Stream B: Smoothly transitions camera (CameraControls.setLookAt) to saved view */
  focusCamera(cameraState: CameraState, annotationId?: string): void;
  /** Stream C -> Stream B: Enables or disables raycast pin placement cursor */
  setPlacementMode(enabled: boolean): void;
}

export function validateSurfacePick(pick: SurfacePick): { valid: boolean; error?: string } {
  if (!validateVec3(pick.position)) {
    return { valid: false, error: 'Invalid 3D position tuple' };
  }
  if (!validateUnitNormal(pick.normal)) {
    return { valid: false, error: 'Surface normal must be a unit vector (~1.0)' };
  }
  if (!validateVec3(pick.cameraState?.position) || !validateVec3(pick.cameraState?.target)) {
    return { valid: false, error: 'Invalid cameraState position or target' };
  }
  return { valid: true };
}
