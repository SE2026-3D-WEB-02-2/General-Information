// VT-087 assumption probes (P1-P7): run with `node scripts/vt087-assumption-probe.mjs`. Each line prints observed behaviour.
import { createHmac } from 'node:crypto';
import { SpriterApiApplication } from '../apps/api/src/http/app-router.ts';

const ts = new Date().toISOString();
function mk(extra = {}) {
  const app = new SpriterApiApplication();
  app.annotationRepo.seedModel({ id: 'model-gltf-01', name: 'x.glb', fileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' });
  app.annotationRepo.seedRecord({ id: 'a', model_id: 'model-gltf-01', author_id: 'someone-else', status: 'OPEN', version: 1,
    position: [1, 0.9, -0.4], normal: [0, 1, 0], camera_state: { position: [3.5, 2.1, 4], target: [1, 0.9, -0.4] },
    mesh_name: 'M', comments: [{ id: 'c', authorId: 'u', content: 'Check opening gap here.', createdAt: ts, annotationId: 'a' }],
    created_at: ts, updated_at: ts, ...extra });
  return app;
}
const call = (app, method, path, auth, body, key) => app.handleRequest({ method, path, headers: { authorization: auth, idempotencyKey: key }, body });
async function login(app, email, password) {
  const r = await call(app, 'POST', '/api/v1/auth/login', undefined, { email, password });
  return 'Bearer ' + r.body.accessToken;
}

// P1: self-registration chooses its own role
{
  const app = mk();
  const r = await call(app, 'POST', '/api/v1/auth/register', undefined, { email: 'evil@x.test', name: 'Evil', password: 'Evil#Password2026', role: 'PROJECT_LEAD' });
  console.log('P1 register with role=PROJECT_LEAD ->', r.statusCode, 'role in response:', r.body?.user?.role);
  const tok = r.body?.accessToken ? 'Bearer ' + r.body.accessToken : await login(app, 'evil@x.test', 'Evil#Password2026');
  const del = await call(app, 'DELETE', '/api/v1/annotations/a', tok);
  console.log('   ...then DELETE someone else\'s annotation ->', del.statusCode, (await app.annotationRepo.findById('a')) ? 'still exists' : 'DELETED');
}

// P2: test-style token uses "id" but verifyToken reads "sub"
{
  const app = mk();
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const b = Buffer.from(JSON.stringify({ id: 'user-3d-huy', email: 'huy@spriter.local', name: 'Huy', role: 'REVIEWER', iat: now, exp: now + 600 })).toString('base64url');
  const sig = createHmac('sha256', 'spriter-dev-hmac-secret-2026').update(`${h}.${b}`).digest('base64url');
  const r = await call(app, 'POST', '/api/v1/annotations/a/approve', `Bearer ${h}.${b}.${sig}`, { expectedVersion: 1 }, 'p2');
  const logs = app.annotationRepo.getAuditLogs ? app.annotationRepo.getAuditLogs() : [];
  console.log('P2 test-style token (id, no sub) approve ->', r.statusCode, 'audit actorIds:', JSON.stringify(logs.map((l) => l.actorId)));
  const real = await login(app, 'huy@spriter.local', 'Spriter3D#2026');
  const payload = JSON.parse(Buffer.from(real.split('.')[1], 'base64url').toString());
  console.log('   real login token payload keys:', Object.keys(payload).join(','));
}

// P3: role outside UserRole (MEMBER, as in TC05) and token without role
{
  const app = mk();
  const now = Math.floor(Date.now() / 1000);
  for (const role of ['MEMBER', undefined]) {
    const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const b = Buffer.from(JSON.stringify({ sub: 'u-x', email: 'x@x', name: 'X', ...(role ? { role } : {}), iat: now, exp: now + 600 })).toString('base64url');
    const sig = createHmac('sha256', 'spriter-dev-hmac-secret-2026').update(`${h}.${b}`).digest('base64url');
    const r = await call(app, 'POST', '/api/v1/annotations/a/approve', `Bearer ${h}.${b}.${sig}`, { expectedVersion: (await app.annotationRepo.findById('a')).version }, 'p3-' + role);
    console.log(`P3 token role=${role} approve ->`, r.statusCode, r.body?.errorCode ?? '');
  }
}

// P4: approve without any qualifying comment
{
  const app = mk({ comments: [] });
  const tok = await login(app, 'huy@spriter.local', 'Spriter3D#2026');
  const r = await call(app, 'POST', '/api/v1/annotations/a/approve', tok, { expectedVersion: 1 }, 'p4');
  console.log('P4 approve with no comment ->', r.statusCode, r.body?.errorCode);
}

// P5: same key, two DIFFERENT reviewers, same annotation
{
  const app = mk();
  const huy = await login(app, 'huy@spriter.local', 'Spriter3D#2026');
  const hieu = await login(app, 'hieu@spriter.local', 'SpriterUI#2026');
  const r1 = await call(app, 'POST', '/api/v1/annotations/a/approve', huy, { expectedVersion: 1 }, 'shared-key');
  const r2 = await call(app, 'POST', '/api/v1/annotations/a/approve', hieu, { expectedVersion: 1 }, 'shared-key');
  const approvals = app.annotationRepo.getAuditLogs().filter((l) => l.outcome === 'UPDATED');
  console.log('P5 same key, different reviewer ->', r1.statusCode, r2.statusCode, 'approvals in audit:', approvals.map((l) => l.actorId).join(','));
}

// P6: concurrent same key, same annotation (in-process)
{
  let mixed = 0;
  for (let i = 0; i < 200; i++) {
    const app = mk();
    const tok = await login(app, 'huy@spriter.local', 'Spriter3D#2026');
    const rs = await Promise.all([1, 2].map(() => call(app, 'POST', '/api/v1/annotations/a/approve', tok, { expectedVersion: 1 }, 'same')));
    if (rs.some((r) => r.statusCode !== 200)) mixed++;
  }
  console.log('P6 concurrent same-key pairs with a non-200 reply:', mixed, '/ 200');
}

// P7: approve publishes a realtime event like PATCH does
{
  const app = mk();
  const tok = await login(app, 'huy@spriter.local', 'Spriter3D#2026');
  const svc = app.annotationService ?? app.annotationController?.annotationService;
  let events = 0;
  if (svc?.realtime) { const orig = svc.realtime.publishToModelRoom; svc.realtime.publishToModelRoom = (...a) => { events++; return orig?.(...a); }; }
  await call(app, 'POST', '/api/v1/annotations/a/approve', tok, { expectedVersion: 1 }, 'p7');
  console.log('P7 realtime events on approve:', svc?.realtime ? events : 'could not hook service');
}
