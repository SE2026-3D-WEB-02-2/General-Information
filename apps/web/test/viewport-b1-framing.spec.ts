import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { computeCameraFraming } from '../src/viewport/camera-framing.ts';
import { boundsFromObject } from '../src/viewport/three-model.ts';

type Vec3 = [number, number, number];

function corners(min: Vec3, max: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) out.push([x, y, z]);
  return out;
}

/** Projects every bounding-box corner through a real three.js camera and checks it is inside the view frustum. */
function assertBoxVisible(min: Vec3, max: Vec3, aspect: number) {
  const framing = computeCameraFraming({ min, max }, { fovDeg: 50, aspect });
  const camera = new PerspectiveCamera(50, aspect, framing.near, framing.far);
  camera.position.set(...framing.position);
  camera.lookAt(new Vector3(...framing.target));
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  for (const c of corners(min, max)) {
    const ndc = new Vector3(...c).project(camera);
    assert.ok(Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1, `corner ${c} outside x/y: ${ndc.x}, ${ndc.y}`);
    assert.ok(ndc.z >= -1 && ndc.z <= 1, `corner ${c} clipped by near/far: z=${ndc.z}`);
  }
  return framing;
}

describe('[B1] computeCameraFraming(boundingBox)', () => {
  it('B1-1 frames a 0.01 m model: whole box visible, near < minDistance', () => {
    const f = assertBoxVisible([-0.005, -0.005, -0.005], [0.005, 0.005, 0.005], 16 / 9);
    assert.deepEqual(f.target, [0, 0, 0]);
    assert.ok(f.near > 0 && f.near < f.minDistance, `near ${f.near} minDistance ${f.minDistance}`);
    assert.ok(f.distance < 0.1, `distance ${f.distance} should be centimetre scale`);
  });

  it('B1-2 frames a 1000 m model with the same depth ratio as the small one', () => {
    const big = assertBoxVisible([-500, -500, -500], [500, 500, 500], 16 / 9);
    const small = computeCameraFraming({ min: [-0.005, -0.005, -0.005], max: [0.005, 0.005, 0.005] }, { fovDeg: 50, aspect: 16 / 9 });
    assert.ok(big.distance > 1000);
    assert.ok(Math.abs(big.far / big.near - small.far / small.near) < 1e-6, 'far/near ratio must be scale-invariant');
    assert.ok(big.maxDistance < big.far, 'controls must not dolly beyond the far plane');
  });

  it('B1-3 frames an off-centre model around its own centre, also in a portrait viewport', () => {
    const min: Vec3 = [480, -230, 10];
    const max: Vec3 = [520, -170, 50];
    const f = assertBoxVisible(min, max, 0.5);
    assert.deepEqual(f.target, [500, -200, 30]);
  });

  it('B1-4 rejects an empty bounding box instead of producing NaN camera values', () => {
    assert.throws(() => computeCameraFraming({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }), /EMPTY_BOUNDING_BOX/);
  });

  it('B1-5 does not mutate the input box', () => {
    const box = { min: [1, 2, 3] as Vec3, max: [4, 5, 6] as Vec3 };
    computeCameraFraming(box);
    assert.deepEqual(box, { min: [1, 2, 3], max: [4, 5, 6] });
  });

  it('B1-6 boundsFromObject keeps original mesh vertices and node transforms untouched', () => {
    const geometry = new BoxGeometry(2, 1, 1);
    geometry.translate(10, 0, 0); // asset authored off-centre
    const before = Array.from(geometry.getAttribute('position').array);
    const root = new Group();
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    mesh.position.set(0, 3, 0);
    root.add(mesh);

    const bounds = boundsFromObject(root);

    assert.deepEqual(Array.from(geometry.getAttribute('position').array), before, 'vertex buffer changed');
    assert.deepEqual(mesh.position.toArray(), [0, 3, 0]);
    assert.deepEqual(root.position.toArray(), [0, 0, 0]);
    assert.deepEqual(bounds.min, [9, 2.5, -0.5]);
    assert.deepEqual(bounds.max, [11, 3.5, 0.5]);
  });
});
