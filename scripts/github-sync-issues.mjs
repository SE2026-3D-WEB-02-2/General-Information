#!/usr/bin/env node
/**
 * Automated GitHub Project Provisioner (Milestones, Labels, and 27 Task Issues across Streams A, B, C)
 *
 * Usage:
 *   1. Dry run locally:
 *      npm run github:dry-run
 *   2. Sync to GitHub (via GitHub Actions or local token):
 *      GITHUB_TOKEN=ghp_xxx GITHUB_REPOSITORY=owner/repo npm run github:sync
 */

const MILESTONES = [
  {
    key: 'M1',
    title: 'M1: Single-Player 3D, Domain Contracts & OCC Core',
    description:
      'Gate G1: glTF loader, raycast pick in Model-Local Space, 3D pins, camera focus, shared domain policy, Export/Import JSON v1, and PostgreSQL OCC schema.',
  },
  {
    key: 'M2',
    title: 'M2: Auth, Presigned 3D Upload & Persistent REST API',
    description:
      'Gate G2: Email/Password JWT auth, RBAC, cursor-paginated CRUD endpoints, Presigned S3/MinIO direct .glb upload, and server-side Import with fileHash & per-item validation.',
  },
  {
    key: 'M3',
    title: 'M3: Realtime Socket.io Sync & 409 Conflict Resolution',
    description:
      'Gate G3: Socket.io room broadcast after commit, monotonic version guard, gap detection catch-up sync, and 409 Conflict UI (Accept Server vs Retry on Latest).',
  },
  {
    key: 'M4',
    title: 'M4: 984-Task Load Verification, 7-Day Log Purge & Polish',
    description:
      'Gate G4 (MVP Release): 984 concurrent tasks load test (p95 <= 2.5s, 0 Lost Updates), 7-day operational log TTL purge worker, ADR-001 conflict_rate metric, and 3D pin instancing.',
  },
];

const LABELS = [
  { name: 'stream:A-backend', color: '1d76db', description: 'Stream A — Tech Lead / Backend, Realtime & Infra' },
  { name: 'stream:B-viewport', color: '0e8a16', description: 'Stream B — 3D glTF Viewport & Raycast' },
  { name: 'stream:C-collab-ui', color: 'd93f0b', description: 'Stream C — 2D Collaboration UI, Store & Adapters' },
  { name: 'boundary:occ-invariant', color: '5319e7', description: 'Optimistic Concurrency Control & Domain Invariants' },
];

const ISSUES = [
  // --- STREAM A (TECH LEAD / BACKEND & REALTIME) ---
  {
    id: 'A1',
    milestone: 'M1',
    labels: ['stream:A-backend', 'boundary:occ-invariant'],
    title: '[A1] Database Schema & Migration (users, models, annotations[version], comments, 7d audit logs)',
    body: `### Stream & Scope
- **Owner:** Stream A (Tech Lead / Backend)
- **Agent Spec:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A1\`)
- **Write Scope:** \`apps/api/src/db/migrations/0000_init.sql\`

### Requirements
- Define DDL for \`users\`, \`models\`, \`annotations\`, \`comments\`, and \`operational_audit_logs\`.
- Enforce \`version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)\` on \`annotations\`.
- Enforce \`expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')\` + index on \`operational_audit_logs\`.

### Verification Gate
\`\`\`bash
npm run verify
\`\`\``,
  },
  {
    id: 'A2',
    milestone: 'M1',
    labels: ['stream:A-backend', 'boundary:occ-invariant'],
    title: '[A2] Transactional OCC Repository (Atomic updateIfVersion CAS + 7-Day Audit Trail)',
    body: `### Stream & Scope
- **Owner:** Stream A (Tech Lead / Backend)
- **Agent Spec:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A2\`)
- **Write Scope:** \`apps/api/src/modules/annotations/**\`

### Requirements
- Implement \`AnnotationRepositoryPort.updateIfVersion(id, expectedVersion, updatedRow, audit)\`.
- Ensure atomic Compare-And-Swap (\`WHERE id = $1 AND version = $2\`) and strip internal DB fields via \`toDomainSnapshot()\`.

### Verification Gate
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },
  {
    id: 'A3',
    milestone: 'M2',
    labels: ['stream:A-backend'],
    title: '[A3] Authentication (Login/Register/Me) & RBAC Permission Gate (canActorModifyAnnotation)',
    body: `### Stream & Scope
- **Owner:** Stream A (Tech Lead / Backend)
- **Agent Spec:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A3\`)
- **Contract Reference:** \`docs/contracts/DATA_AND_EVENTS.md\` (Section 2)

### Requirements
- Implement \`POST /api/v1/auth/login\`, \`POST /api/v1/auth/register\`, \`GET /api/v1/auth/me\`.
- Enforce \`canActorModifyAnnotation\` from \`@spriter/shared\` (only author or \`PROJECT_LEAD\` can transition to \`ARCHIVED\` or delete).

### Verification Gate
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },
  {
    id: 'A4',
    milestone: 'M2',
    labels: ['stream:A-backend', 'boundary:occ-invariant'],
    title: '[A4] REST CRUD & Cursor Pagination for Annotations and Comment Threads',
    body: `### Stream & Scope
- **Owner:** Stream A (Tech Lead / Backend)
- **Agent Spec:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A4\`)
- **Write Scope:** \`apps/api/src/modules/annotations/http/annotation.controller.ts\`

### Requirements
- \`GET /api/v1/models/:modelId/annotations\` with \`status\`, \`cursor\`, \`limit\`, and \`updatedAfter\` (for reconnect catch-up).
- \`POST /api/v1/models/:modelId/annotations\` (\`version = 1\` + \`initialComment\`).
- \`POST /api/v1/annotations/:id/comments\` (increments \`annotation.version + 1\`).
- \`PATCH /api/v1/annotations/:id\` returning \`200\`, \`409 CONCURRENCY_CONFLICT\`, or \`422\`.

### Verification Gate
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },
  {
    id: 'A5',
    milestone: 'M2',
    labels: ['stream:A-backend'],
    title: '[A5] Presigned S3/MinIO Upload & Download URLs for Arbitrary-Size .glb Models',
    body: `### Stream & Scope
- **Owner:** Stream A (Tech Lead / Backend)
- **Agent Spec:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A5\`)

### Requirements
- Provide \`POST /api/v1/models/upload-url\` and \`POST /api/v1/models/:id/confirm\` (recording \`file_size\` and SHA-256 \`file_hash\`).
- Enforce 1MB API body limit so heavy \`.glb\` binaries never stream through API memory.

### Verification Gate
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },
  {
    id: 'A6',
    milestone: 'M2',
    labels: ['stream:A-backend', 'boundary:occ-invariant'],
    title: '[A6] Server-Side Export/Import JSON with fileHash Verification (409) & Per-Item Error Reporting (422)',
    body: `### Stream & Scope
- **Owner:** Stream A (Tech Lead / Backend)
- **Agent Spec:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A6\`)
- **Contract Reference:** \`docs/contracts/DATA_AND_EVENTS.md\` (Section 5.2)

### Requirements
- Return \`409 IMPORT_MODEL_HASH_MISMATCH\` when \`mode === 'STRICT'\` and \`fileHash\` differs.
- Validate all items with \`validateExportPayload(payload)\`; abort transaction and return \`422 IMPORT_VALIDATION_FAILED\` with \`itemErrors[]\` if any item fails.

### Verification Gate
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },
  {
    id: 'A7',
    milestone: 'M3',
    labels: ['stream:A-backend'],
    title: '[A7] Socket.io Realtime Gateway (room = model:{id}, Post-Commit Event Emission)',
    body: `### Stream & Scope
- **Owner:** Stream A (Tech Lead / Backend)
- **Agent Spec:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A7\`)
- **Contract Reference:** \`docs/contracts/DATA_AND_EVENTS.md\` (Section 4)

### Requirements
- Authenticate Socket.io handshake and handle \`room:join\`.
- Emit \`annotation:created\`, \`annotation:updated\`, \`annotation:deleted\`, \`comment:created\` ONLY after DB transaction commits.

### Verification Gate
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },
  {
    id: 'A8',
    milestone: 'M4',
    labels: ['stream:A-backend', 'boundary:occ-invariant'],
    title: '[A8] 984 Concurrent Tasks Load Test (p95 <= 2.5s, 0 Lost Updates Verification)',
    body: `### Stream & Scope
- **Owner:** Stream A (Tech Lead / Backend)
- **Agent Spec:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A8\`)

### Requirements
- Execute 984 concurrent tasks benchmark against the API & PostgreSQL.
- Assert \`p95 <= 2500ms\` and \`0 Lost Updates\` (audit log \`UPDATED\` count matches \`finalVersion - 1\`).

### Verification Gate
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },
  {
    id: 'A9',
    milestone: 'M4',
    labels: ['stream:A-backend'],
    title: '[A9] Automated 7-Day Operational Audit Log Purge Worker (expires_at < NOW())',
    body: `### Stream & Scope
- **Owner:** Stream A (Tech Lead / Backend)
- **Agent Spec:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A9\`)

### Requirements
- Purge operational audit logs older than \`OPERATIONAL_LOG_TTL_DAYS = 7\` days via \`purgeExpiredOperationalLogs()\`.

### Verification Gate
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },
  {
    id: 'A10',
    milestone: 'M4',
    labels: ['stream:A-backend'],
    title: '[A10] Operational Telemetry Endpoint (/metrics) & ADR-001 Conflict Rate Monitor (> 8% Trigger)',
    body: `### Stream & Scope
- **Owner:** Stream A (Tech Lead / Backend)
- **Agent Spec:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A10\`)

### Requirements
- Compute and expose \`conflict_rate\` and \`p95\` metrics from 7-day operational logs to monitor ADR-001 re-evaluation triggers.

### Verification Gate
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },

  // --- STREAM B (3D VIEWPORT & RAYCAST) ---
  {
    id: 'B1',
    milestone: 'M1',
    labels: ['stream:B-viewport'],
    title: '[B1] Load .glb Model & Normalize Camera Framing by BoundingBox (Preserve Original Mesh Vertices)',
    body: `### Stream & Scope
- **Owner:** Stream B (3D Viewport Owner)
- **Agent Spec:** \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B1\`)
- **Write Scope:** \`apps/web/src/viewport/**\`

### Requirements
- Load \`.glb\` into R3F Canvas and compute \`camera.near\`, \`camera.far\`, and \`CameraControls\` target from \`BoundingBox\`.
- Never mutate mesh vertex coordinates so Export/Import coordinates remain identical.

### Verification Gate
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'B2',
    milestone: 'M1',
    labels: ['stream:B-viewport', 'boundary:occ-invariant'],
    title: '[B2] 3D Mesh Raycaster -> Emit SurfacePick in Model-Local Space with Unit Normal Vector',
    body: `### Stream & Scope
- **Owner:** Stream B (3D Viewport Owner)
- **Agent Spec:** \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B2\`)

### Requirements
- On surface click in placement mode, emit \`SurfacePick { position, normal, cameraState, meshName }\` via \`ViewportBridge\`.
- Ensure \`validateSurfacePick(pick).valid === true\` and \`validateUnitNormal(pick.normal) === true\`.

### Verification Gate
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'B3',
    milestone: 'M1',
    labels: ['stream:B-viewport'],
    title: '[B3] Render 3D Pin Markers from ViewportBridge.setPins() with Normal Offset & Occlusion Fading',
    body: `### Stream & Scope
- **Owner:** Stream B (3D Viewport Owner)
- **Agent Spec:** \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B3\`)

### Requirements
- Render pins at \`P + normal * epsilon\`, style by \`status\` and \`selected\`, fade when occluded by mesh, and emit \`onPinSelected(id)\` on click.

### Verification Gate
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'B4',
    milestone: 'M1',
    labels: ['stream:B-viewport'],
    title: '[B4] Smooth Camera Transition (CameraControls.setLookAt) on ViewportBridge.focusCamera()',
    body: `### Stream & Scope
- **Owner:** Stream B (3D Viewport Owner)
- **Agent Spec:** \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B4\`)

### Requirements
- Implement \`focusCamera(cameraState, annotationId)\` calling \`CameraControls.setLookAt(cx, cy, cz, tx, ty, tz, true)\`.

### Verification Gate
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'B5',
    milestone: 'M2',
    labels: ['stream:B-viewport'],
    title: '[B5] Load Large .glb from Presigned URL with Progress, Draco/Meshopt Decoder & Expiry Handling',
    body: `### Stream & Scope
- **Owner:** Stream B (3D Viewport Owner)
- **Agent Spec:** \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B5\`)

### Verification Gate
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'B6',
    milestone: 'M3',
    labels: ['stream:B-viewport'],
    title: '[B6] Live 3D Pin Marker Diffing on Realtime Store Updates Without Resetting Camera Rig',
    body: `### Stream & Scope
- **Owner:** Stream B (3D Viewport Owner)
- **Agent Spec:** \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B6\`)

### Verification Gate
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'B7',
    milestone: 'M3',
    labels: ['stream:B-viewport', 'boundary:occ-invariant'],
    title: '[B7] Spatial Drag Lock Guard when Annotation is RESOLVED or ARCHIVED',
    body: `### Stream & Scope
- **Owner:** Stream B (3D Viewport Owner)
- **Agent Spec:** \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B7\`)

### Requirements
- Check \`evaluateAnnotationMutation\` from \`@spriter/shared\` before allowing 3D pin drag; block with \`SPATIAL_LOCKED_WHEN_RESOLVED\` when status is \`RESOLVED\`.

### Verification Gate
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'B8',
    milestone: 'M4',
    labels: ['stream:B-viewport'],
    title: '[B8] 3D Pin Instancing & Occlusion Raycast Throttling (200-500 Pins >= 30 FPS)',
    body: `### Stream & Scope
- **Owner:** Stream B (3D Viewport Owner)
- **Agent Spec:** \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B8\`)

### Verification Gate
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },

  // --- STREAM C (2D COLLABORATION UI, STORE & ADAPTERS) ---
  {
    id: 'C1',
    milestone: 'M1',
    labels: ['stream:C-collab-ui'],
    title: '[C1] Annotation Sidebar List, Status Filter & Camera Focus Selection Sync',
    body: `### Stream & Scope
- **Owner:** Stream C (Collaboration UI & State Owner)
- **Agent Spec:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C1\`)
- **Write Scope:** \`apps/web/src/features/**\`

### Requirements
- Connect Sidebar to \`AnnotationWorkspaceStore\`, filter by \`status\`, and call \`store.selectAnnotation(id, true)\` on click.

### Verification Gate
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C2',
    milestone: 'M1',
    labels: ['stream:C-collab-ui'],
    title: '[C2] New Pin Creation Flow: Placement Mode -> Receive SurfacePick -> Submit Initial Comment',
    body: `### Stream & Scope
- **Owner:** Stream C (Collaboration UI & State Owner)
- **Agent Spec:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C2\`)

### Verification Gate
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C3',
    milestone: 'M1',
    labels: ['stream:C-collab-ui', 'boundary:occ-invariant'],
    title: '[C3] Comment Thread Panel & Status Transition Controls Delegating to Shared Domain Policy',
    body: `### Stream & Scope
- **Owner:** Stream C (Collaboration UI & State Owner)
- **Agent Spec:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C3\`)

### Requirements
- Use \`AnnotationThreadPanelController.canTransitionStatus()\` (\`evaluateAnnotationMutation\` from \`@spriter/shared\`) with zero duplicated business rules.

### Verification Gate
\`\`\`bash
npm run arch:check && npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C4',
    milestone: 'M1',
    labels: ['stream:C-collab-ui'],
    title: '[C4] Export/Import JSON v1 UI with fileHash Mismatch Warning Dialog & Per-Item Error Display',
    body: `### Stream & Scope
- **Owner:** Stream C (Collaboration UI & State Owner)
- **Agent Spec:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C4\`)
- **Contract Reference:** \`docs/contracts/DATA_AND_EVENTS.md\` (Section 5.2)

### Verification Gate
\`\`\`bash
npm run test:shared && npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C5',
    milestone: 'M2',
    labels: ['stream:C-collab-ui'],
    title: '[C5] Login/Register Views & HttpAnnotationApi Adapter with expectedVersion Contract',
    body: `### Stream & Scope
- **Owner:** Stream C (Collaboration UI & State Owner)
- **Agent Spec:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C5\`)
- **Write Scope:** \`apps/web/src/features/**\`, \`apps/web/src/adapters/**\`

### Verification Gate
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C6',
    milestone: 'M2',
    labels: ['stream:C-collab-ui'],
    title: '[C6] Presigned .glb Upload Modal with SHA-256 Hash Calculation & Progress Bar',
    body: `### Stream & Scope
- **Owner:** Stream C (Collaboration UI & State Owner)
- **Agent Spec:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C6\`)

### Verification Gate
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C7',
    milestone: 'M3',
    labels: ['stream:C-collab-ui', 'boundary:occ-invariant'],
    title: '[C7] SocketRealtimeAdapter with Monotonic Version Guard & Gap Recovery Catch-Up Sync',
    body: `### Stream & Scope
- **Owner:** Stream C (Collaboration UI & State Owner)
- **Agent Spec:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C7\`)
- **Contract Reference:** \`docs/contracts/DATA_AND_EVENTS.md\` (Section 4.3)

### Verification Gate
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C8',
    milestone: 'M3',
    labels: ['stream:C-collab-ui', 'boundary:occ-invariant'],
    title: '[C8] 409 Conflict Resolution Dialog (Inspect serverSnapshot, Accept Server vs Retry on Latest)',
    body: `### Stream & Scope
- **Owner:** Stream C (Collaboration UI & State Owner)
- **Agent Spec:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C8\`)
- **Contract Reference:** \`docs/contracts/DATA_AND_EVENTS.md\` (Section 5.1)

### Verification Gate
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C9',
    milestone: 'M4',
    labels: ['stream:C-collab-ui'],
    title: '[C9] Keyboard Accessibility (a11y) & Loading/Empty/Error States for Review Workspace',
    body: `### Stream & Scope
- **Owner:** Stream C (Collaboration UI & State Owner)
- **Agent Spec:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C9\`)

### Verification Gate
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
];

const isDryRun = process.argv.includes('--dry-run');
const token = process.env.GITHUB_TOKEN;
const repo =
  process.env.GITHUB_REPOSITORY ||
  process.env.GITHUB_REPO ||
  'SE2026-3D-WEB-02-2/General-Information';

async function ghRequest(endpoint, method = 'GET', body = undefined) {
  const res = await fetch(`https://api.github.com/repos/${repo}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub API ${method} ${endpoint} failed (${res.status}): ${text}`);
  }
  return res.status === 204 ? null : res.json();
}

async function main() {
  if (isDryRun || !token || !repo) {
    console.log('================================================================================');
    console.log('📋 GitHub Project Provisioner Plan (4 Milestones, 4 Labels, 27 Task Issues)');
    console.log('================================================================================');
    for (const m of MILESTONES) {
      const mIssues = ISSUES.filter((i) => i.milestone === m.key);
      console.log(`\n🎯 ${m.title} (${mIssues.length} issues)`);
      for (const issue of mIssues) {
        console.log(`   - ${issue.title} [${issue.labels.join(', ')}]`);
      }
    }
    if (!isDryRun && (!token || !repo)) {
      console.log(
        '\nℹ️  To create these directly on GitHub, either:\n' +
          '   1. Push to GitHub and click "Run workflow" on "Bootstrap GitHub Milestones & Issues" in the Actions tab, OR\n' +
          '   2. Run locally: GITHUB_TOKEN=ghp_xxx GITHUB_REPOSITORY=owner/repo npm run github:sync',
      );
    }
    return;
  }

  console.log(`🚀 Syncing Milestones, Labels, and Issues to GitHub repository: ${repo}...`);

  // 1. Sync Labels
  const existingLabels = await ghRequest('/labels?per_page=100');
  const existingLabelNames = new Set(existingLabels.map((l) => l.name));
  for (const label of LABELS) {
    if (!existingLabelNames.has(label.name)) {
      await ghRequest('/labels', 'POST', label);
      console.log(`  ✔ Created label: ${label.name}`);
    }
  }

  // 2. Sync Milestones
  const existingMilestones = await ghRequest('/milestones?state=all&per_page=100');
  const milestoneNumberByKey = new Map();
  for (const m of MILESTONES) {
    const found = existingMilestones.find((em) => em.title.startsWith(`${m.key}:`));
    if (found) {
      milestoneNumberByKey.set(m.key, found.number);
      console.log(`  • Found existing milestone: ${found.title} (#${found.number})`);
    } else {
      const created = await ghRequest('/milestones', 'POST', {
        title: m.title,
        description: m.description,
      });
      milestoneNumberByKey.set(m.key, created.number);
      console.log(`  ✔ Created milestone: ${created.title} (#${created.number})`);
    }
  }

  // 3. Sync 27 Task Issues (Idempotent by [A1] / [B1] / [C1] prefix)
  const existingIssues = await ghRequest('/issues?state=all&per_page=100');
  for (const issue of ISSUES) {
    const prefix = `[${issue.id}]`;
    const alreadyExists = existingIssues.find((ei) => ei.title.startsWith(prefix));
    if (alreadyExists) {
      console.log(`  • Skipping existing issue: ${alreadyExists.title} (#${alreadyExists.number})`);
      continue;
    }
    const created = await ghRequest('/issues', 'POST', {
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      milestone: milestoneNumberByKey.get(issue.milestone),
    });
    console.log(`  ✔ Created issue #${created.number}: ${created.title}`);
  }

  console.log('✅ GitHub Milestones, Labels, and all 27 Issues are synced!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
