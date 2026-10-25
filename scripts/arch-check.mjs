#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

const REQUIRED_AGENT_DOCS = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursorrules',
  '.agents/rules/architecture-and-tasks.md',
  'packages/shared/AGENTS.md',
  'apps/api/AGENTS.md',
  'apps/web/src/viewport/AGENTS.md',
  'apps/web/src/features/AGENTS.md',
  'docs/TEAM_PLAN.md',
  'docs/contracts/DATA_AND_EVENTS.md',
  'docs/tasks/STREAM_A_BACKEND.md',
  'docs/tasks/STREAM_B_3D_VIEWPORT.md',
  'docs/tasks/STREAM_C_COLLAB_UI.md',
];

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function extractImports(sourceText) {
  const imports = [];
  const regex = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = regex.exec(sourceText)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

const violations = [];

// 1. Verify all AI-Agent-First documentation & hierarchical rules exist
for (const relDoc of REQUIRED_AGENT_DOCS) {
  const absDoc = path.join(ROOT, relDoc);
  if (!fs.existsSync(absDoc) || fs.statSync(absDoc).size < 50) {
    violations.push(
      `[AGENT-DOC-MISSING] Required AI Agent context file "${relDoc}" is missing or empty.`,
    );
  }
}

// 2. Scan source files for Architectural Rules R1-R6
const sourceFiles = [
  ...walkFiles(path.join(ROOT, 'packages')),
  ...walkFiles(path.join(ROOT, 'apps')),
];

for (const absFile of sourceFiles) {
  const relFile = path.relative(ROOT, absFile).replaceAll('\\', '/');
  const content = fs.readFileSync(absFile, 'utf8');
  const imports = extractImports(content);

  // R1: shared-is-pure
  if (relFile.startsWith('packages/shared/src/')) {
    for (const imp of imports) {
      if (!imp.startsWith('.')) {
        violations.push(
          `[R1:shared-is-pure] "${relFile}" imports external module "${imp}". @spriter/shared must be pure TypeScript.`,
        );
      }
    }
  }

  // R2: no-cross-app & no-deep-relative into packages/shared
  if (relFile.startsWith('apps/web/') || relFile.startsWith('apps/api/')) {
    for (const imp of imports) {
      if (imp.includes('packages/shared')) {
        violations.push(
          `[R2:no-deep-relative] "${relFile}" uses relative path "${imp}" into packages/shared. Import from "@spriter/shared" instead.`,
        );
      }
      if (relFile.startsWith('apps/web/') && (imp.includes('apps/api') || imp.startsWith('@spriter/api'))) {
        violations.push(
          `[R2:no-cross-app] "${relFile}" imports backend module "${imp}". Share contracts via "@spriter/shared".`,
        );
      }
      if (relFile.startsWith('apps/api/') && (imp.includes('apps/web') || imp.startsWith('@spriter/web'))) {
        violations.push(
          `[R2:no-cross-app] "${relFile}" imports frontend module "${imp}". Share contracts via "@spriter/shared".`,
        );
      }
    }
  }

  // R3: domain-is-pure (in apps/api/src/modules/*/domain/)
  if (/^apps\/api\/src\/modules\/[^/]+\/domain\//.test(relFile)) {
    for (const imp of imports) {
      if (imp.includes('/http/') || imp === 'fastify' || imp === 'pg' || imp === 'socket.io') {
        violations.push(
          `[R3:domain-is-pure] "${relFile}" imports transport/infra module "${imp}". Use ports.ts interfaces instead.`,
        );
      }
    }
  }

  // R4 & R5: viewport-features-isolated & no-three-in-features
  if (relFile.startsWith('apps/web/src/features/') || relFile.startsWith('apps/web/src/adapters/')) {
    for (const imp of imports) {
      if (imp === 'three' || imp.startsWith('three/') || imp.startsWith('@react-three/')) {
        violations.push(
          `[R5:no-three-in-features] "${relFile}" imports "${imp}". 3D libraries are only allowed inside apps/web/src/viewport/.`,
        );
      }
      if (imp.includes('/viewport/') && !imp.endsWith('/viewport/bridge.ts')) {
        violations.push(
          `[R4:viewport-features-isolated] "${relFile}" imports "${imp}". Features may only communicate with Viewport via "viewport/bridge.ts".`,
        );
      }
    }
  }

  if (relFile.startsWith('apps/web/src/viewport/')) {
    for (const imp of imports) {
      if (imp.includes('/features/') || imp.includes('/adapters/')) {
        violations.push(
          `[R4:viewport-features-isolated] "${relFile}" imports "${imp}". Viewport must not depend on 2D UI features or API adapters.`,
        );
      }
    }
  }

  // R6: single-source-business-rules (prevent re-declaring policy constants outside packages/shared)
  if (!relFile.startsWith('packages/shared/')) {
    if (/const\s+(MIN_RESOLUTION_COMMENT_LENGTH|NORMAL_VECTOR_TOLERANCE|ALLOWED_TRANSITIONS)\s*=/.test(content)) {
      violations.push(
        `[R6:single-source-business-rules] "${relFile}" re-declares domain policy constants outside @spriter/shared.`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error('❌ Architecture & Agent Guardrail Check FAILED:');
  for (const v of violations) {
    console.error(`  - ${v}`);
  }
  process.exit(1);
} else {
  console.log(
    `✔ Architecture & Agent Guardrail Check PASSED (${sourceFiles.length} source files & ${REQUIRED_AGENT_DOCS.length} AI Agent docs verified).`,
  );
}
