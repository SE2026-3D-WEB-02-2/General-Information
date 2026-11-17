import { type Intersection, Matrix3, Matrix4, type Object3D, Vector3 } from 'three';
import type { Vec3 } from '@spriter/shared';
import { type CameraState, type SurfacePick, validateSurfacePick } from './bridge.ts';

function toModel(world: Vec3, worldToModel: Matrix4): Vec3 {
  return new Vector3(...world).applyMatrix4(worldToModel).toArray();
}

/** World -> model-local transform of the loaded model root (inverse of its matrixWorld). */
export function worldToModelMatrix(modelRoot: Object3D): Matrix4 {
  modelRoot.updateWorldMatrix(true, false);
  return modelRoot.matrixWorld.clone().invert();
}

/** Converts a model-local CameraState (as stored on an annotation) back to world space. */
export function cameraStateToWorld(state: CameraState, modelRoot: Object3D): CameraState {
  modelRoot.updateWorldMatrix(true, false);
  const m = modelRoot.matrixWorld;
  return {
    position: new Vector3(...state.position).applyMatrix4(m).toArray(),
    target: new Vector3(...state.target).applyMatrix4(m).toArray(),
  };
}

/** Converts a model-local point (annotation position) to world space for rendering. */
export function modelPointToWorld(point: Vec3, modelRoot: Object3D): Vec3 {
  modelRoot.updateWorldMatrix(true, false);
  return new Vector3(...point).applyMatrix4(modelRoot.matrixWorld).toArray();
}

/**
 * Builds a SurfacePick from a three.js raycast hit.
 * - position and cameraState: world -> model-local via inverse(modelRoot.matrixWorld)
 * - normal: face normal (mesh-local) -> model-local via the normal matrix of
 *   inverse(root) * mesh.matrixWorld [* instanceMatrix], then normalized and turned toward the viewer
 * Returns null when no valid pick can be produced (no face, degenerate normal).
 */
export function surfacePickFromIntersection(
  hit: Intersection,
  modelRoot: Object3D,
  worldCamera: CameraState,
): SurfacePick | null {
  if (!hit.face) return null;

  const worldToModel = worldToModelMatrix(modelRoot);
  hit.object.updateWorldMatrix(true, false);
  const meshToModel = worldToModel.clone().multiply(hit.object.matrixWorld);
  const instanced = hit.object as Object3D & { isInstancedMesh?: boolean; getMatrixAt?: (i: number, m: Matrix4) => void };
  if (instanced.isInstancedMesh && hit.instanceId !== undefined && instanced.getMatrixAt) {
    const instanceMatrix = new Matrix4();
    instanced.getMatrixAt(hit.instanceId, instanceMatrix);
    meshToModel.multiply(instanceMatrix);
  }

  const normal = hit.face.normal.clone().applyMatrix3(new Matrix3().getNormalMatrix(meshToModel)).normalize();

  // Face the viewer: a double-sided surface hit from behind reports the back-face normal.
  const position = hit.point.clone().applyMatrix4(worldToModel);
  const cameraModel = new Vector3(...toModel(worldCamera.position, worldToModel));
  if (normal.dot(cameraModel.clone().sub(position)) < 0) normal.negate();

  const pick: SurfacePick = {
    position: position.toArray(),
    normal: normal.toArray(),
    cameraState: {
      position: cameraModel.toArray(),
      target: toModel(worldCamera.target, worldToModel),
    },
    ...(hit.object.name ? { meshName: hit.object.name } : {}),
  };
  return validateSurfacePick(pick).valid ? pick : null;
}
