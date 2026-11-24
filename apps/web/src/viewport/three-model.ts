import { Box3, type Object3D } from 'three';
import type { BoundsLike } from './camera-framing.ts';

/**
 * World-space bounds of a loaded model. Box3.setFromObject only reads vertices;
 * the geometry is never re-centred (no geometry.center()) and no node transform is changed,
 * so annotation positions stay identical to the original file.
 */
export function boundsFromObject(root: Object3D): BoundsLike {
  root.updateWorldMatrix(true, true);
  const box = new Box3().setFromObject(root, true);
  return { min: box.min.toArray(), max: box.max.toArray() };
}
