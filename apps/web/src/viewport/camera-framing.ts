import type { Vec3 } from '@spriter/shared';

export interface BoundsLike {
  min: Vec3;
  max: Vec3;
}

export interface CameraFramingOptions {
  /** Vertical field of view in degrees (PerspectiveCamera.fov). */
  fovDeg?: number;
  /** Viewport width / height. */
  aspect?: number;
  /** Direction from target to camera; does not need to be unit length. */
  viewDirection?: Vec3;
  /** Extra margin around the bounding sphere (1 = touching the frustum edge). */
  padding?: number;
}

export interface CameraFraming {
  target: Vec3;
  position: Vec3;
  distance: number;
  radius: number;
  near: number;
  far: number;
  minDistance: number;
  maxDistance: number;
}

const DEFAULT_VIEW_DIRECTION: Vec3 = [1, 0.75, 1];
// All clip/zoom limits are proportional to the model radius, so far/near is identical for
// a 1 cm part and a 1 km site and depth precision does not collapse at either extreme.
const MIN_DISTANCE_PER_RADIUS = 0.05;
const NEAR_PER_MIN_DISTANCE = 0.1;
const MAX_DISTANCE_PER_FIT = 10;
const FAR_MARGIN_PER_RADIUS = 2;

/**
 * Computes camera placement and clip planes that fit a model's bounding box in view.
 * Pure function: the camera moves to the model; the model (and its vertices) never moves.
 */
export function computeCameraFraming(box: BoundsLike, options: CameraFramingOptions = {}): CameraFraming {
  const { min, max } = box;
  const values: number[] = [...min, ...max];
  if (values.some((v) => !Number.isFinite(v)) || min.some((v: number, i: number) => v > max[i]!)) {
    throw new Error('EMPTY_BOUNDING_BOX: model has no finite geometry to frame');
  }

  const fovDeg = options.fovDeg ?? 50;
  const aspect = options.aspect ?? 1;
  const padding = options.padding ?? 1.15;

  const target: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const halfDiagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
  const radius = Math.max(halfDiagonal, 1e-6);

  const vertical = (fovDeg * Math.PI) / 180;
  const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  const limitingFov = Math.min(vertical, horizontal);
  const distance = (radius / Math.sin(limitingFov / 2)) * padding;

  const dir = options.viewDirection ?? DEFAULT_VIEW_DIRECTION;
  const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const position: Vec3 = [
    target[0] + (dir[0] / len) * distance,
    target[1] + (dir[1] / len) * distance,
    target[2] + (dir[2] / len) * distance,
  ];

  const minDistance = radius * MIN_DISTANCE_PER_RADIUS;
  const maxDistance = distance * MAX_DISTANCE_PER_FIT;
  return {
    target,
    position,
    distance,
    radius,
    near: minDistance * NEAR_PER_MIN_DISTANCE,
    far: maxDistance + radius * FAR_MARGIN_PER_RADIUS,
    minDistance,
    maxDistance,
  };
}
