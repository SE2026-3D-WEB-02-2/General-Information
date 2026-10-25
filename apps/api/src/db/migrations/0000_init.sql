-- ============================================================================
-- Spriter 3D Design Review — Initial PostgreSQL Schema & OCC Boundary
-- Migration: 0000_init.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    role VARCHAR(32) NOT NULL DEFAULT 'REVIEWER' CHECK (role IN ('REVIEWER', 'PROJECT_LEAD')),
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS models (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    storage_key TEXT NOT NULL,
    file_size BIGINT NOT NULL CHECK (file_size >= 0),
    file_hash VARCHAR(64) NOT NULL,
    uploaded_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS annotations (
    id UUID PRIMARY KEY,
    model_id UUID NOT NULL REFERENCES models(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id),
    status VARCHAR(32) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'ARCHIVED')),
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    position JSONB NOT NULL,
    normal JSONB NOT NULL,
    camera_state JSONB NOT NULL,
    mesh_name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annotations_model_status ON annotations(model_id, status);
CREATE INDEX IF NOT EXISTS idx_annotations_model_updated ON annotations(model_id, updated_at);

CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY,
    annotation_id UUID NOT NULL REFERENCES annotations(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_annotation_created ON comments(annotation_id, created_at);

-- Operational & Concurrency Audit Logs (Strict 7-Day Retention Policy)
CREATE TABLE IF NOT EXISTS operational_audit_logs (
    event_id VARCHAR(128) PRIMARY KEY,
    annotation_id UUID NOT NULL,
    actor_id VARCHAR(128) NOT NULL,
    outcome VARCHAR(32) NOT NULL
        CHECK (outcome IN ('CREATED', 'UPDATED', 'COMMENTED', 'CONCURRENCY_CONFLICT', 'INVARIANT_VIOLATION')),
    expected_version INTEGER NOT NULL,
    actual_version INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')
);

CREATE INDEX IF NOT EXISTS idx_operational_audit_logs_expires_at
    ON operational_audit_logs(expires_at);
