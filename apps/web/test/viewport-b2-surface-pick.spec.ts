import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  BoxGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Raycaster,
  Vector3,
} from 'three';
import { validateSurfacePick, validateUnitNormal } from '@spriter/shared';
import { surfacePickFromIntersection } from '../src/viewport/surface-pick.ts';

type Vec3 = [number, number, number];

function close(actual: Vec3, expected: Vec3, eps = 1e-6) {
  for (let i = 0; i < 3; i++) {
    assert.ok(Math.abs(actual[i]! - expected[i]!) <= eps, `got ${actual} expected ${expected}`);
  }
}

function firstHit(root: Group, origin: Vec3, direction: Vec3) {
  root.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(...origin), new Vector3(...direction).normalize());
  const hit = ray.intersectObject(root, true)[0];
  assert.ok(hit, 'ray should hit the model');
  return hit;
}

describe('[B2] Raycast -> SurfacePick in model-local space', () => {
  it('B2-1 converts a hit on a translated/rotated/scaled model back to model-local coordinates', () => {
    // root: placed at x=100, rotated 90° about Y, uniformly scaled x2. Child mesh offset by z=3 inside the model.
    const root = new Group();
    root.position.set(100, 0, 0);
    root.rotation.y = Math.PI / 2;
    root.scale.setScalar(2);
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
    mesh.name = 'Body';
    mesh.position.set(0, 0, 3);
    root.add(mesh);

    // Model-local point (0.5, 0.2, 3) on the +X face maps to world (106, 0.4, -1).
    const hit = firstHit(root, [106, 0.4, -10], [0, 0, 1]);
    close(hit.point.toArray(), [106, 0.4, -1]); // sanity: world hit

    const pick = surfacePickFromIntersection(hit, root, { position: [106, 0.4, -10], target: [106, 0.4, -1] });

    assert.ok(pick);
    close(pick.position, [0.5, 0.2, 3]);
    close(pick.normal, [1, 0, 0]);
    assert.equal(pick.meshName, 'Body');
    assert.deepEqual(validateSurfacePick(pick), { valid: true });
  });

  it('B2-2 uses the normal matrix, so normals stay perpendicular under non-uniform scale', () => {
    const root = new Group();
    const stretched = new Group();
    stretched.scale.set(2, 1, 1);
    const plane = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ side: DoubleSide }));
    plane.rotation.y = Math.PI / 4;
    stretched.add(plane);
    root.add(stretched);

    const expectedNormal: Vec3 = [1 / Math.sqrt(5), 0, 2 / Math.sqrt(5)]; // (0.447, 0, 0.894)
    const hit = firstHit(root, [expectedNormal[0] * 10, 0, expectedNormal[2] * 10], [-expectedNormal[0], 0, -expectedNormal[2]]);
    const pick = surfacePickFromIntersection(hit, root, { position: [4, 0, 9], target: [0, 0, 0] });

    assert.ok(pick);
    close(pick.normal, expectedNormal, 1e-6);
    assert.ok(validateUnitNormal(pick.normal));
    // Surface tangent in model space after the x2 stretch is (sqrt2, 0, -1/sqrt2): normal must be perpendicular to it.
    const tangent: Vec3 = [Math.SQRT2, 0, -Math.SQRT1_2];
    const dot = pick.normal[0] * tangent[0] + pick.normal[2] * tangent[2];
    assert.ok(Math.abs(dot) < 1e-9, `normal not perpendicular to surface: dot=${dot}`);
  });

  it('B2-3 flips the normal toward the viewer when a double-sided face is hit from behind', () => {
    const root = new Group();
    root.add(new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ side: DoubleSide })));
    const hit = firstHit(root, [0, 0, -5], [0, 0, 1]);
    const pick = surfacePickFromIntersection(hit, root, { position: [0, 0, -5], target: [0, 0, 0] });
    assert.ok(pick);
    close(pick.normal, [0, 0, -1]);
  });

  it('B2-4 stores cameraState in the same model-local space as the pick', () => {
    const root = new Group();
    root.position.set(100, 0, 0);
    root.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
    const hit = firstHit(root, [100, 0, 10], [0, 0, -1]);
    const pick = surfacePickFromIntersection(hit, root, { position: [100, 0, 10], target: [100, 0, 0] });
    assert.ok(pick);
    close(pick.position, [0, 0, 0.5]);
    close(pick.cameraState.position, [0, 0, 10]);
    close(pick.cameraState.target, [0, 0, 0]);
  });

  it('B2-5 returns null instead of an invalid pick when the hit has no face (e.g. points/lines)', () => {
    const root = new Group();
    const pick = surfacePickFromIntersection(
      { point: new Vector3(), face: null, object: root, distance: 1 } as never,
      root,
      { position: [0, 0, 1], target: [0, 0, 0] },
    );
    assert.equal(pick, null);
  });
});
