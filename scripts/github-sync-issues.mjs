#!/usr/bin/env node
/**
 * Automated GitHub Project Provisioner & Synchronizer
 * - Creates or updates 4 Milestones (M1–M4), 4 Labels, and 27 Detailed Task Issues ([A1]–[A10], [B1]–[B8], [C1]–[C9])
 * - Assigns each issue to its exact stream owner:
 *   • Stream A (Tech Lead / Backend & Realtime): @Nekover2
 *   • Stream B (3D Viewport & Raycast): @NilsNielsen (Hoàng Đức Huy)
 *   • Stream C (2D Collaboration UI & Adapters): @soshyz27 (Hồ Trọng Hiếu)
 *
 * Usage:
 *   1. Dry run locally:
 *      npm run github:dry-run
 *   2. Sync/update to GitHub:
 *      GITHUB_TOKEN=ghp_xxx npm run github:sync
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
  {
    name: 'stream:A-backend',
    color: '1d76db',
    description: 'Stream A — Nekover2 (Tech Lead / Backend, Realtime & Infra)',
  },
  {
    name: 'stream:B-viewport',
    color: '0e8a16',
    description: 'Stream B — Hoàng Đức Huy (@NilsNielsen — 3D glTF Viewport & Raycast)',
  },
  {
    name: 'stream:C-collab-ui',
    color: 'd93f0b',
    description: 'Stream C — Hồ Trọng Hiếu (@soshyz27 — 2D Collaboration UI, Store & Adapters)',
  },
  {
    name: 'boundary:occ-invariant',
    color: '5319e7',
    description: 'Optimistic Concurrency Control & Domain Invariants',
  },
];

const ISSUES = [
  // ==========================================================================
  // STREAM A — NEKOVER2 (TECH LEAD / BACKEND, REALTIME & INFRA)
  // ==========================================================================
  {
    id: 'A1',
    milestone: 'M1',
    assignees: ['Nekover2'],
    labels: ['stream:A-backend', 'boundary:occ-invariant'],
    title: '[A1] Database Schema & Migration (users, models, annotations[version], comments, 7d audit logs)',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Nekover2 (\`@Nekover2\` — Tech Lead / Backend & Realtime)**
- **Tài liệu đặc tả cho AI Agent:** \`AGENTS.md\`, \`apps/api/AGENTS.md\`, \`docs/tasks/STREAM_A_BACKEND.md\` (\`A1\`)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/api/src/db/migrations/0000_init.sql\`

### 2. Mục tiêu nghiệp vụ (Objective)
Thiết lập lược đồ cơ sở dữ liệu PostgreSQL chuẩn cho toàn bộ hệ thống Review 3D, bảo vệ ràng buộc toàn vẹn dữ liệu ở tầng DB cho cơ chế Optimistic Concurrency Control (\`version\`) và chính sách lưu trữ dữ liệu vận hành đúng **7 ngày** (\`OPERATIONAL_LOG_TTL_DAYS = 7\`).

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Bảng \`users\`:**
   - \`id UUID PRIMARY KEY\`, \`email VARCHAR(255) NOT NULL UNIQUE\`, \`name VARCHAR(255) NOT NULL\`, \`avatar_url TEXT\`, \`password_hash TEXT NOT NULL\`.
   - Ràng buộc vai trò: \`role VARCHAR(32) NOT NULL DEFAULT 'REVIEWER' CHECK (role IN ('REVIEWER', 'PROJECT_LEAD'))\`.
2. **Bảng \`models\`:**
   - Lưu metadata của file \`.glb\`: \`id\`, \`name\`, \`storage_key\`, \`file_size BIGINT CHECK (file_size >= 0)\`, \`file_hash VARCHAR(64) NOT NULL\` (SHA-256), \`status CHECK (status IN ('UPLOAD_PENDING', 'READY'))\`, \`uploaded_by REFERENCES users(id)\`.
3. **Bảng \`annotations\` (Tâm điểm OCC & Invariant):**
   - \`version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)\` (tăng đơn điệu \`+1\` sau mỗi lần cập nhật trạng thái, tọa độ hoặc thêm comment).
   - \`status VARCHAR(32) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'ARCHIVED'))\`.
   - Tọa độ không gian 3D: \`position JSONB NOT NULL\`, \`normal JSONB NOT NULL\`, \`camera_state JSONB NOT NULL\`, \`mesh_name VARCHAR(255)\`.
   - Đánh index: \`idx_annotations_model_status(model_id, status)\` và \`idx_annotations_model_updated(model_id, updated_at)\` phục vụ phân trang và catch-up sync.
4. **Bảng \`comments\`:**
   - Liên kết khóa ngoại \`annotation_id UUID NOT NULL REFERENCES annotations(id) ON DELETE CASCADE\`, đánh index \`idx_comments_annotation_created(annotation_id, created_at)\`.
5. **Bảng \`operational_audit_logs\` (Retention 7 ngày):**
   - Lưu \`event_id\`, \`annotation_id\`, \`actor_id\`, \`outcome CHECK (outcome IN ('CREATED', 'UPDATED', 'COMMENTED', 'CONCURRENCY_CONFLICT', 'INVARIANT_VIOLATION'))\`, \`expected_version\`, \`actual_version\`.
   - Ràng buộc TTL 7 ngày: \`expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')\` kèm index \`idx_operational_audit_logs_expires_at\`.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [x] File \`0000_init.sql\` thực thi sạch trên PostgreSQL 16 (trong GitHub Actions CI service container).
- [x] Mọi ràng buộc \`CHECK\` cho \`version >= 1\`, \`status\`, \`role\`, và \`expires_at\` hoạt động đúng.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run verify
\`\`\``,
  },
  {
    id: 'A2',
    milestone: 'M1',
    assignees: ['Nekover2'],
    labels: ['stream:A-backend', 'boundary:occ-invariant'],
    title: '[A2] Transactional OCC Repository (Atomic updateIfVersion CAS + 7-Day Audit Trail)',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Nekover2 (\`@Nekover2\` — Tech Lead / Backend & Realtime)**
- **Tài liệu đặc tả cho AI Agent:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A2\`), \`docs/contracts/DATA_AND_EVENTS.md\`
- **Phạm vi file (Write Scope):**
  - \`apps/api/src/modules/annotations/domain/ports.ts\`
  - \`apps/api/src/modules/annotations/adapters/in-memory.repository.ts\`
  - \`apps/api/src/modules/annotations/adapters/postgres.repository.ts\`

### 2. Mục tiêu nghiệp vụ (Objective)
Đảm bảo khi 2 hoặc 984 người dùng cùng lúc cập nhật một \`Annotation\`, hệ thống thực thi giao dịch nguyên tử **Compare-And-Swap (CAS)** theo \`expectedVersion\`, tuyệt đối không để xảy ra **Lost Update** và luôn che giấu thông tin nội bộ của DB (Information Hiding).

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Cổng Hexagonal (\`AnnotationRepositoryPort\`):**
   - Tuân thủ luật kiến trúc \`R3 (domain-is-pure)\`: Tầng \`domain/\` chỉ gọi qua interface \`AnnotationRepositoryPort\`, không import trực tiếp driver \`pg\`.
2. **Thực thi Compare-And-Swap nguyên tử (\`updateIfVersion\`):**
   - Trong \`PostgresAnnotationRepository\`, câu lệnh \`UPDATE annotations SET status = $3, position = $4::jsonb, normal = $5::jsonb, camera_state = $6::jsonb, version = version + 1, updated_at = $7 WHERE id = $1 AND version = $2\` và câu lệnh \`INSERT INTO operational_audit_logs\` phải nằm trong **cùng một DB Transaction**.
   - Nếu \`rowCount === 0\` (do \`version\` đã bị người khác nâng lên trước), trả về \`false\` để \`AnnotationService\` bắt lỗi \`409 CONCURRENCY_CONFLICT\` kèm \`serverSnapshot\` mới nhất.
3. **Information Hiding (\`toDomainSnapshot\`):**
   - Tuyệt đối loại bỏ các trường nhạy cảm nội bộ (như \`internal_storage_bucket_token\`) trước khi trả dữ liệu ra HTTP/WebSocket.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [x] Khi 2 request gửi cùng \`expectedVersion: 2\`, đúng 1 request nhận \`200 OK (version: 3)\` và 1 request nhận \`409 CONCURRENCY_CONFLICT (currentVersion: 3, serverSnapshot)\`.
- [x] Không rò rỉ \`internal_storage_bucket_token\` ra payload trả về.
- [x] Unit test cho cả \`InMemoryAnnotationRepository\` và \`PostgresAnnotationRepository\` (Test #2 & Test #8 trong \`apps/api/test/annotation-api.spec.ts\`).

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },
  {
    id: 'A3',
    milestone: 'M2',
    assignees: ['Nekover2'],
    labels: ['stream:A-backend'],
    title: '[A3] Authentication (Login/Register/Me) & RBAC Permission Gate (canActorModifyAnnotation)',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Nekover2 (\`@Nekover2\` — Tech Lead / Backend & Realtime)**
- **Tài liệu đặc tả cho AI Agent:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A3\`), \`docs/contracts/DATA_AND_EVENTS.md\` (Mục 1 & 2)
- **Phạm vi file (Write Scope):** \`apps/api/src/modules/auth/**\`, \`apps/api/src/modules/annotations/domain/annotation.service.ts\`

### 2. Mục tiêu nghiệp vụ (Objective)
Xây dựng hệ thống xác thực JWT an toàn và cưỡng chế phân quyền RBAC thống nhất giữa UI và API thông qua hàm \`canActorModifyAnnotation\` trong \`@spriter/shared\`.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Endpoints Xác thực (\`AuthController\` & \`AuthService\`):**
   - \`POST /api/v1/auth/register\`: Nhận \`RegisterRequestDto { email, password, name, role? }\`, kiểm tra trùng email (\`409 EMAIL_ALREADY_EXISTS\`), băm mật khẩu bằng \`scrypt\` + salt ngẫu nhiên 16 bytes (\`scrypt$<salt>$<hash>\`), trả về \`201 Created\` kèm \`AuthSessionResponseDto { user, accessToken, expiresInSeconds }\`.
   - \`POST /api/v1/auth/login\`: Kiểm tra mật khẩu bằng \`timingSafeEqual\` chống timing attack, trả về \`200 OK\` hoặc \`401 UNAUTHORIZED\`.
   - \`GET /api/v1/auth/me\`: Xác thực header \`Authorization: Bearer <token>\`, trả về \`200 OK (UserSummary)\` (tuyệt đối không lộ \`password_hash\`).
2. **Tài khoản Seed mặc định cho 3 thành viên dev/test:**
   - Tech Lead (\`@Nekover2\`): \`lead@spriter.local\` / \`SpriterLead#2026\` (\`PROJECT_LEAD\`)
   - 3D Viewport (\`@NilsNielsen\`): \`huy@spriter.local\` / \`Spriter3D#2026\` (\`REVIEWER\`)
   - Collab UI (\`@soshyz27\`): \`hieu@spriter.local\` / \`SpriterUI#2026\` (\`REVIEWER\`)
3. **Cưỡng chế RBAC (\`canActorModifyAnnotation\`):**
   - Mọi user đã đăng nhập (\`REVIEWER\`, \`PROJECT_LEAD\`) đều được tạo annotation, thêm comment và chuyển trạng thái chuẩn (\`OPEN <-> IN_PROGRESS <-> RESOLVED\`).
   - Chỉ **tác giả của Annotation (\`authorId === actor.id\`)** hoặc **\`PROJECT_LEAD\`** mới được phép chuyển trạng thái sang \`ARCHIVED\` hoặc xóa (\`DELETE /api/v1/annotations/:id\`). Nếu \`REVIEWER\` khác cố thực hiện, trả về \`403 FORBIDDEN_OPERATION\`.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [x] Request thiếu/sai Bearer token bị chặn với \`401 UNAUTHORIZED\`.
- [x] \`REVIEWER\` không phải tác giả gọi \`PATCH status: 'ARCHIVED'\` hoặc \`DELETE\` bị chặn với \`403 FORBIDDEN_OPERATION\`.
- [x] \`PROJECT_LEAD\` hoặc chính tác giả thực hiện \`ARCHIVE\`/\`DELETE\` thành công (\`200 OK\`).

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },
  {
    id: 'A4',
    milestone: 'M2',
    assignees: ['Nekover2'],
    labels: ['stream:A-backend', 'boundary:occ-invariant'],
    title: '[A4] REST CRUD & Cursor Pagination for Annotations and Comment Threads',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Nekover2 (\`@Nekover2\` — Tech Lead / Backend & Realtime)**
- **Tài liệu đặc tả cho AI Agent:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A4\`), \`docs/contracts/DATA_AND_EVENTS.md\` (Mục 2)
- **Phạm vi file (Write Scope):** \`apps/api/src/modules/annotations/http/annotation.controller.ts\`, \`apps/api/src/http/app-router.ts\`

### 2. Mục tiêu nghiệp vụ (Objective)
Cung cấp đầy đủ bộ REST API CRUD, phân trang theo con trỏ (\`cursor\`), lọc theo trạng thái và mốc thời gian (\`updatedAfter\` phục vụ tải bù khi rớt mạng), đồng thời cưỡng chế toàn bộ bất biến miền (\`evaluateAnnotationMutation\`) ở phía Server.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. \`GET /api/v1/models/:modelId/annotations\`:
   - Hỗ trợ query \`status\`, \`cursor\`, \`limit\` (mặc định \`50\`, tối đa \`200\`), và \`updatedAfter\` (ISO timestamp).
   - Trả về \`200 OK\`: \`PaginatedAnnotationsResponseDto { items, nextCursor, totalCount, serverTime }\`.
2. \`POST /api/v1/models/:modelId/annotations\`:
   - Nhận \`CreateAnnotationRequestDto { position, normal, cameraState, meshName?, initialComment }\`.
   - Kiểm tra \`validateSurfacePick\` (vector pháp tuyến đơn vị $|\|\vec{n}\| - 1.0| \le 0.01$) và \`initialComment\` không rỗng.
   - Khởi tạo \`version = 1\`, \`status = 'OPEN'\`, đính kèm comment đầu tiên và trả về \`201 Created\`.
3. \`POST /api/v1/annotations/:id/comments\`:
   - Chặn nếu annotation đang ở trạng thái \`ARCHIVED\` (\`422 ANNOTATION_ARCHIVED_IMMUTABLE\`).
   - Thêm comment mới và **tự động tăng \`annotation.version\` lên \`+1\`** nguyên tử.
4. \`PATCH /api/v1/annotations/:id\`:
   - Bắt buộc có \`expectedVersion\` nguyên dương (\`400 MISSING_EXPECTED_VERSION\` nếu thiếu).
   - Kiểm tra OCC (\`409 CONCURRENCY_CONFLICT\`) và kiểm tra bất biến qua \`evaluateAnnotationMutation\` (\`422 SPATIAL_LOCKED_WHEN_RESOLVED\`, \`422 MISSING_RESOLUTION_COMMENT\`, \`422 INVALID_STATE_TRANSITION\`, \`422 ANNOTATION_ARCHIVED_IMMUTABLE\`).

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [x] Phân trang \`cursor\` + \`limit\` lấy đúng từng trang và trả \`nextCursor = null\` ở trang cuối.
- [x] Thêm comment mới làm tăng \`version\` của Annotation từ \`1 -> 2\`.
- [x] Cố tình đổi tọa độ \`position\` khi đang \`RESOLVED\` bị chặn với \`422 SPATIAL_LOCKED_WHEN_RESOLVED\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },
  {
    id: 'A5',
    milestone: 'M2',
    assignees: ['Nekover2'],
    labels: ['stream:A-backend'],
    title: '[A5] Presigned S3/MinIO Upload & Download URLs for Arbitrary-Size .glb Models',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Nekover2 (\`@Nekover2\` — Tech Lead / Backend & Realtime)**
- **Tài liệu đặc tả cho AI Agent:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A5\`)
- **Phạm vi file (Write Scope):** \`apps/api/src/modules/models/**\`, \`apps/api/src/server.ts\`

### 2. Mục tiêu nghiệp vụ (Objective)
Cho phép người dùng tải lên file mô hình 3D \`.glb\` dung lượng tùy ý (hàng trăm MB) trực tiếp lên S3/MinIO thông qua **Presigned URL**, bảo vệ tuyệt đối RAM và Event Loop của API Server để giữ vững cam kết độ trễ \`p95 <= 2.5s\`.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Chốt chặn bảo vệ RAM API Server (\`MAX_API_JSON_BODY_BYTES = 1_048_576\` — 1MB):**
   - Nếu client gửi request có \`Content-Length > 1MB\` hoặc \`Content-Type: model/gltf-binary\` / \`application/octet-stream\` thẳng vào API Server, lập tức từ chối với \`413 PAYLOAD_TOO_LARGE\`.
2. \`POST /api/v1/models/upload-url\`:
   - Nhận \`RequestModelUploadUrlDto { fileName, fileSize, fileHash }\`.
   - Kiểm tra đuôi \`.glb/.gltf\`, \`fileSize > 0\`, và \`fileHash\` đúng định dạng SHA-256 hex 64 ký tự.
   - Tạo bản ghi model ở trạng thái \`UPLOAD_PENDING\` và trả về \`201 Created: PresignedUploadResponseDto { modelId, uploadUrl, storageKey, expiresInSeconds, maxApiJsonBodyBytes }\`.
3. \`POST /api/v1/models/:id/confirm\` & \`GET /api/v1/models/:id\`:
   - Xác nhận \`fileSize\` và \`fileHash\`, chuyển trạng thái model sang \`READY\`, đồng bộ vào kho model để sẵn sàng nhận Annotation & Export/Import, và trả về \`ModelSummaryDto\` kèm \`downloadUrl\` (Presigned GET URL).

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [x] Gửi binary \`.glb\` hoặc body \`> 1MB\` vào API bị chặn ngay với \`413 PAYLOAD_TOO_LARGE\`.
- [x] Luồng \`upload-url\` $\\rightarrow$ \`confirm\` $\\rightarrow$ \`GET /models/:id\` sinh đúng chữ ký \`X-Amz-Signature\` và đồng bộ \`fileHash\` cho tính năng Export/Import.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },
  {
    id: 'A6',
    milestone: 'M2',
    assignees: ['Nekover2'],
    labels: ['stream:A-backend', 'boundary:occ-invariant'],
    title: '[A6] Server-Side Export/Import JSON with fileHash Verification (409) & Per-Item Error Reporting (422)',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Nekover2 (\`@Nekover2\` — Tech Lead / Backend & Realtime)**
- **Tài liệu đặc tả cho AI Agent:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A6\`), \`docs/contracts/DATA_AND_EVENTS.md\` (Mục 5.2)
- **Phạm vi file (Write Scope):** \`apps/api/src/modules/annotations/domain/annotation.service.ts\`, \`packages/shared/src/contracts/api-contracts.ts\`

### 2. Mục tiêu nghiệp vụ (Objective)
Đảm bảo tính năng Export/Import danh sách Annotation ra file JSON (\`ExportFileV1\`) dùng chung tên trường phẳng với REST API, phát hiện được việc Import nhầm vào phiên bản file 3D khác (\`fileHash\`), và kiểm tra toàn vẹn từng Annotation theo cơ chế **All-or-Nothing (Rollback 100% nếu có lỗi)**.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. \`GET /api/v1/models/:modelId/annotations/export\`:
   - Xuất dữ liệu theo đúng cấu trúc \`ExportFileV1 { schemaVersion: '1.0', exportedAt, modelMeta: { name, fileHash }, annotations: AnnotationDomainSnapshot[] }\`.
2. \`POST /api/v1/models/:modelId/annotations/import\`:
   - Nhận \`ImportAnnotationsRequestDto { mode?: 'STRICT' | 'FORCE_HASH_MISMATCH', payload: ExportFileV1 }\`.
   - **Bước 1 (Kiểm tra \`fileHash\`):** Nếu \`mode === 'STRICT'\` (mặc định) và \`payload.modelMeta.fileHash !== model.fileHash\`, trả về \`409 IMPORT_MODEL_HASH_MISMATCH\` kèm \`expectedFileHash\` và \`actualFileHash\`.
   - **Bước 2 (Kiểm tra từng phần tử):** Gọi \`validateExportPayload(payload)\` từ \`@spriter/shared\`. Nếu bất kỳ phần tử nào vi phạm (ví dụ: \`status === 'RESOLVED'\` nhưng không có comment nào $\\ge 10$ ký tự, hoặc vector \`normal\` chưa chuẩn hóa), hủy toàn bộ giao dịch (không lưu bất kỳ bản ghi nào) và trả về \`422 IMPORT_VALIDATION_FAILED\` kèm mảng \`itemErrors: [{ index, annotationId, reasonCode, message }]\`.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [x] Lệch \`fileHash\` ở chế độ \`STRICT\` trả về \`409 IMPORT_MODEL_HASH_MISMATCH\`.
- [x] Chế độ \`FORCE_HASH_MISMATCH\` cho phép bỏ qua cảnh báo hash nhưng vẫn chặn và báo lỗi chính xác từng dòng trong \`itemErrors[]\` (\`422\`) nếu dữ liệu vi phạm Invariant.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },
  {
    id: 'A7',
    milestone: 'M3',
    assignees: ['Nekover2'],
    labels: ['stream:A-backend'],
    title: '[A7] Socket.io Realtime Gateway (room = model:{id}, Post-Commit Event Emission)',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Nekover2 (\`@Nekover2\` — Tech Lead / Backend & Realtime)**
- **Tài liệu đặc tả cho AI Agent:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A7\`), \`docs/contracts/DATA_AND_EVENTS.md\` (Mục 4)
- **Phạm vi file (Write Scope):** \`apps/api/src/modules/annotations/adapters/socket-realtime.gateway.ts\`

### 2. Mục tiêu nghiệp vụ (Objective)
Phát tán các thay đổi hợp lệ theo thời gian thực tới mọi người dùng đang cùng xem một mô hình 3D (\`room = model:{modelId}\`), chỉ phát sự kiện **sau khi giao dịch DB đã commit thành công**, và hỗ trợ đồng bộ bù (\`missedAnnotations\`) ngay khi client kết nối lại.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Xác thực & Gia nhập Room (\`joinModelRoom\`):**
   - Kiểm tra JWT \`token\` trong \`SocketHandshakeAuth\`; trả \`errorCode: 'UNAUTHORIZED'\` nếu token không hợp lệ.
   - Kiểm tra sự tồn tại của \`modelId\`; nếu hợp lệ thì đưa kết nối vào room \`model:{modelId}\`.
   - Nếu client gửi kèm \`knownVersions: Record<string, number>\` lúc vào room (sau khi rớt mạng), lọc toàn bộ các Annotation trên server có \`serverAnn.version > (knownVersions[id] ?? 0)\` và trả về ngay trong \`RoomJoinAck.missedAnnotations\`.
2. **Chỉ phát sự kiện sau khi Commit (\`publishToModelRoom\`):**
   - Phát 4 sự kiện \`ServerRealtimeEvent\`: \`annotation:created\`, \`annotation:updated\` (kèm \`previousVersion\`), \`annotation:deleted\`, \`comment:created\` (kèm \`previousVersion\` & \`annotationVersion\`).
   - Nếu lệnh \`PATCH\` hoặc \`POST\` bị từ chối bởi \`409 CONCURRENCY_CONFLICT\` hoặc \`422 INVARIANT_VIOLATION\`, tuyệt đối không phát bất kỳ sự kiện WebSocket nào.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [x] Handshake không có token hợp lệ bị từ chối với \`UNAUTHORIZED\`.
- [x] Trong kịch bản 2 người cùng sửa 1 Annotation (1 thắng \`200\`, 1 thua \`409\`), đúng **1 sự kiện** \`annotation:updated\` được phát ra.
- [x] Client kết nối lại kèm \`knownVersions\` nhận đủ danh sách \`missedAnnotations\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },
  {
    id: 'A8',
    milestone: 'M4',
    assignees: ['Nekover2'],
    labels: ['stream:A-backend', 'boundary:occ-invariant'],
    title: '[A8] 984 Concurrent Tasks Load Test (p95 <= 2.5s, 0 Lost Updates Verification)',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Nekover2 (\`@Nekover2\` — Tech Lead / Backend & Realtime)**
- **Tài liệu đặc tả cho AI Agent:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A8\`)
- **Phạm vi file (Write Scope):** \`scripts/load-test-984.mjs\`, \`apps/api/test/annotation-api.spec.ts\`

### 2. Mục tiêu nghiệp vụ (Objective)
Kiểm chứng thực nghiệm tham số kiến trúc của dự án: **984 người dùng / tác vụ đồng thời**, thời gian phản hồi **\`p95 <= 2.5 giây\` (\`2500ms\`)**, và **\`0 Lost Updates\`** dưới tải tranh chấp cao.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. Xây dựng kịch bản kiểm thử tải \`scripts/load-test-984.mjs\` (\`npm run test:load\`) và bài test tự động trong \`annotation-api.spec.ts\`.
2. Bắn đồng thời **984 tác vụ \`PATCH\`** tranh chấp cập nhật trạng thái trên các Annotation.
3. Đo đạc phân vị độ trễ \`p50\`, \`p95\`, \`p99\` (ms) và kiểm chứng:
   - \`p95 <= 2500ms\`.
   - Số lượng phản hồi \`200 OK\` khớp tuyệt đối với số lần tăng \`version\` thực tế (\`0 Lost Updates\`).
   - Tổng số bản ghi trong \`operational_audit_logs\` (\`UPDATED + CONCURRENCY_CONFLICT\`) bằng đúng \`984\`.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [x] \`npm run test:load\` và Test #3 / Test #10 trong \`annotation-api.spec.ts\` chạy xanh với \`p95 < 100ms\` (thấp hơn rất nhiều so với trần \`2500ms\`) và \`0 Lost Updates\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:load && npm run verify
\`\`\``,
  },
  {
    id: 'A9',
    milestone: 'M4',
    assignees: ['Nekover2'],
    labels: ['stream:A-backend'],
    title: '[A9] Automated 7-Day Operational Audit Log Purge Worker (expires_at < NOW())',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Nekover2 (\`@Nekover2\` — Tech Lead / Backend & Realtime)**
- **Tài liệu đặc tả cho AI Agent:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A9\`)
- **Phạm vi file (Write Scope):** \`apps/api/src/modules/annotations/adapters/log-purge.worker.ts\`, \`apps/api/src/http/app-router.ts\`

### 2. Mục tiêu nghiệp vụ (Objective)
Thực thi ràng buộc vận hành: **Dữ liệu log vận hành chỉ lưu trữ đúng 7 ngày (\`OPERATIONAL_LOG_TTL_DAYS = 7\`)**, tự động dọn dẹp các bản ghi đã quá hạn (\`expires_at <= NOW()\`) mà không cần can thiệp thủ công.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. Cài đặt \`OperationalLogPurgeWorker\` hỗ trợ chạy định kỳ (\`start(intervalMs)\` / \`stop()\`) và chạy tức thời (\`runOnce()\`).
2. Expose endpoint nội bộ \`POST /api/v1/internal/audit-logs/purge\` trả về \`PurgeRunSummary { purgedCount, totalPurgedLifetime, executedAt }\`.
3. Kiểm thử bằng \`ClockPort\` giả lập (\`FakeClock\`): tạo 984 bản ghi log ở ngày 0, dịch đồng hồ sang ngày thứ 8 và xác nhận 100% bản ghi quá hạn bị xóa sạch.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [x] Mọi bản ghi \`operational_audit_logs\` có \`expiresAt = createdAt + 7 days\`.
- [x] Khi dịch đồng hồ qua mốc 7 ngày, \`purgeWorker.runOnce()\` xóa sạch toàn bộ log hết hạn.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },
  {
    id: 'A10',
    milestone: 'M4',
    assignees: ['Nekover2'],
    labels: ['stream:A-backend'],
    title: '[A10] Operational Telemetry Endpoint (/metrics) & ADR-001 Conflict Rate Monitor (> 8% Trigger)',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Nekover2 (\`@Nekover2\` — Tech Lead / Backend & Realtime)**
- **Tài liệu đặc tả cho AI Agent:** \`docs/tasks/STREAM_A_BACKEND.md\` (\`A10\`), \`TECHNICAL_DESIGN.md\` (Mục 3 — ADR-001)
- **Phạm vi file (Write Scope):** \`apps/api/src/modules/annotations/domain/annotation.service.ts\`, \`apps/api/src/http/app-router.ts\`

### 2. Mục tiêu nghiệp vụ (Objective)
Cung cấp số liệu đo lường thực tế từ bảng log vận hành 7 ngày để giám sát điều kiện xem xét lại kiến trúc trong **ADR-001**: nếu tỷ lệ xung đột OCC \`conflict_rate > 8%\` (\`0.08\`), hệ thống tự động bật cờ cảnh báo kiến trúc (\`adr001ReviewTriggered = true\`).

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. Cài đặt \`AnnotationService.getOperationalTelemetry()\` trả về \`OperationalTelemetryDto\`:
   - \`windowDays: 7\`, \`totalAuditEvents\`, \`totalPatchAttempts\`, \`updatedCount\`, \`conflictCount\`, \`invariantViolationCount\`.
   - \`conflictRate = conflictCount / totalPatchAttempts\`, \`conflictRatePercent\`.
   - \`adr001Threshold = 0.08\`, \`adr001ReviewTriggered = conflictRate > 0.08\`.
2. Expose qua endpoint \`GET /api/v1/metrics\` (và \`GET /metrics\`).

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [x] Endpoint \`GET /api/v1/metrics\` tính chính xác \`conflictRate\` và bật \`adr001ReviewTriggered: true\` khi tỷ lệ xung đột vượt quá \`8%\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:api && npm run verify
\`\`\``,
  },

  // ==========================================================================
  // STREAM B — HOÀNG ĐỨC HUY (@NilsNielsen — 3D VIEWPORT & RAYCAST)
  // ==========================================================================
  {
    id: 'B1',
    milestone: 'M1',
    assignees: ['NilsNielsen'],
    labels: ['stream:B-viewport'],
    title: '[B1] Load .glb Model & Normalize Camera Framing by BoundingBox (Preserve Original Mesh Vertices)',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hoàng Đức Huy (\`@NilsNielsen\` — 3D Viewport & Raycast)**
- **Tài liệu bắt buộc cho AI Agent:** \`AGENTS.md\`, \`apps/web/src/viewport/AGENTS.md\`, \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B1\`)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/viewport/**\`
- **Quy tắc kiến trúc bắt buộc (\`R4\`):** Tuyệt đối KHÔNG import từ \`apps/api/**\` hoặc \`apps/web/src/features/**\`. Mọi giao tiếp với UI 2D và Store chỉ đi qua \`apps/web/src/viewport/bridge.ts\`.

### 2. Mục tiêu nghiệp vụ (Objective)
Tải file mô hình 3D \`.glb\` / \`.gltf\` vào React Three Fiber (R3F) / Three.js Canvas và tự động căn chỉnh thông số Camera (\`near\`, \`far\`, vị trí đứng ban đầu, tâm xoay \`target\`) dựa trên \`THREE.Box3\` (\`BoundingBox\`) của mô hình mà **không làm biến dạng hay dịch chuyển tọa độ đỉnh (vertices) gốc của Mesh**.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Giữ nguyên Hệ tọa độ Gốc (Model-Local Space Invariant):**
   - **CẤM TUYỆT ĐỐI** việc gọi \`geometry.center()\`, \`geometry.scale()\`, hoặc tự ý dịch chuyển \`scene.position\` làm thay đổi hệ quy chiếu của mô hình.
   - *Lý do:* Để tọa độ \`position: [x, y, z]\` của các Pin khi xuất ra file JSON (\`ExportFileV1\`) và nạp lại (\`Import\`) luôn trùng khớp 100% trên mọi máy khách.
2. **Hàm tính Khung nhìn Camera thuần túy (\`computeCameraFraming\`):**
   - Viết hàm pure/testable nhận vào \`min: Vec3\`, \`max: Vec3\` của \`BoundingBox\` và trả về:
     - \`center: Vec3\` (tâm của hộp bao).
     - \`radius: number\` (bán kính đường chéo hộp bao, tối thiểu \`> 0.001\` để tránh chia cho 0).
     - \`near: number\` (\`Math.max(radius / 1000, 0.001)\`) và \`far: number\` (\`Math.max(radius * 100, 100)\`) để không bị cắt mặt gần/xa (clipping) với cả model siêu nhỏ (\`0.01m\`) lẫn siêu lớn (\`1000m\`).
     - \`defaultCameraState: CameraState { position: Vec3, target: Vec3 }\` đặt camera ở góc nhìn chéo chuẩn nhìn thẳng vào \`center\`.
3. **Áp dụng vào \`CameraControls\` / R3F Canvas:**
   - Khi model load xong, đưa camera về \`defaultCameraState\` nếu chưa có Pin nào đang được focus.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] Tải được file \`.glb\` và hiển thị đúng tỷ lệ với cả model kích thước nhỏ (\`0.01m\`), trung bình (\`1m\`), lớn (\`1000m\`) và model bị lệch tâm gốc tọa độ.
- [ ] Tọa độ các đỉnh Mesh không bị thay đổi sau khi load.
- [ ] Có unit test kiểm chứng hàm \`computeCameraFraming\` trong \`apps/web/test/\` và chạy pass \`npm run verify\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'B2',
    milestone: 'M1',
    assignees: ['NilsNielsen'],
    labels: ['stream:B-viewport', 'boundary:occ-invariant'],
    title: '[B2] 3D Mesh Raycaster -> Emit SurfacePick in Model-Local Space with Unit Normal Vector',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hoàng Đức Huy (\`@NilsNielsen\` — 3D Viewport & Raycast)**
- **Tài liệu bắt buộc cho AI Agent:** \`AGENTS.md\`, \`apps/web/src/viewport/AGENTS.md\`, \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B2\`), \`docs/contracts/DATA_AND_EVENTS.md\` (Mục 3)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/viewport/**\`

### 2. Mục tiêu nghiệp vụ (Objective)
Khi chế độ đặt Pin đang bật (\`placementMode === true\`) và người dùng click lên bề mặt mô hình 3D, thực hiện Raycast để lấy chính xác tọa độ điểm chạm \`position\`, vector pháp tuyến đơn vị \`normal\` trong **Model-Local Space**, góc nhìn \`cameraState\` hiện tại và tên bộ phận \`meshName\`, sau đó phát sự kiện \`SurfacePick\` qua \`ViewportBridge\`.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Chỉ Raycast khi \`placementMode === true\` (và phân biệt giữa Drag xoay camera với Click đặt Pin):**
   - Nếu người dùng nhấn giữ chuột và kéo để xoay camera (\`pointerDown\` $\\rightarrow$ \`pointerUp\` lệch quá \`5px\`), KHÔNG tính là click đặt Pin.
2. **Chuyển đổi sang Model-Local Space & Chuẩn hóa Vector Pháp tuyến Đơn vị (\`validateUnitNormal\`):**
   - Điểm va chạm \`intersection.point\` phải được chuyển về hệ tọa độ cục bộ của Model gốc (\`modelRoot.worldToLocal(point.clone())\`).
   - Vector pháp tuyến bề mặt \`intersection.face.normal\` phải được biến đổi qua \`normalMatrix\` của mesh về không gian Model-Local và **bắt buộc gọi \`.normalize()\`** để độ dài bằng \`1.0\` (thỏa mãn \`validateUnitNormal(normal) === true\`, sai số $\\le 0.01$ từ \`@spriter/shared\`).
3. **Đóng gói và phát \`SurfacePick\` qua \`ViewportBridge\`:**
   - Gói dữ liệu theo đúng kiểu \`SurfacePick\` trong \`packages/shared/src/contracts/viewport-bridge.ts\`:
     \`\`\`ts
     const pick: SurfacePick = {
       position: [px, py, pz],
       normal: [nx, ny, nz],
       cameraState: {
         position: [camX, camY, camZ],
         target: [targetX, targetY, targetZ],
       },
       meshName: intersection.object.name || undefined,
     };
     \`\`\`
   - Kiểm tra bằng \`validateSurfacePick(pick)\` từ \`@spriter/shared\` trước khi phát cho các listener của \`bridge.onSurfacePicked\`.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] Click lên bề mặt Mesh khi \`placementMode = true\` phát ra \`SurfacePick\` thỏa mãn \`validateSurfacePick(pick).valid === true\`.
- [ ] Vector \`normal\` luôn có độ dài đơn vị ($|\\|\\vec{n}\\| - 1.0| \\le 0.01$), không bao giờ phát vector \`[0, 0, 0]\` hay \`NaN\`.
- [ ] Click ra ngoài khoảng không (không trúng mesh) hoặc kéo chuột xoay camera không kích hoạt \`onSurfacePicked\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'B3',
    milestone: 'M1',
    assignees: ['NilsNielsen'],
    labels: ['stream:B-viewport'],
    title: '[B3] Render 3D Pin Markers from ViewportBridge.setPins() with Normal Offset & Occlusion Fading',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hoàng Đức Huy (\`@NilsNielsen\` — 3D Viewport & Raycast)**
- **Tài liệu bắt buộc cho AI Agent:** \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B3\`), \`packages/shared/src/contracts/viewport-bridge.ts\`
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/viewport/**\`

### 2. Mục tiêu nghiệp vụ (Objective)
Hiển thị trực quan danh sách các Pin 3D (\`ViewportPinMarker[]\`) nhận từ hàm \`ViewportBridge.setPins(pins)\` lên bề mặt mô hình, tự động đổi màu theo trạng thái nghiệp vụ, làm nổi bật Pin đang chọn, làm mờ khi Pin bị khuất sau mô hình (occlusion), và phát sự kiện \`onPinSelected(id)\` khi người dùng click vào Pin.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Đẩy vị trí Pin dọc theo Vector Pháp tuyến chống Z-Fighting:**
   - Vị trí hiển thị của tâm Pin được tính bằng công thức:
     $$\\vec{P}_{\\text{display}} = \\vec{P} + \\vec{n} \\cdot \\epsilon$$
     (với $\\epsilon > 0$, ví dụ tỉ lệ nhỏ theo bán kính model hoặc hằng số \`0.015\`) để Pin nổi hẳn lên trên bề mặt Mesh, không bị nhấp nháy (z-fighting).
2. **Phân biệt Trạng thái (\`status\`) & Trạng thái Chọn (\`selected\`):**
   - Ánh xạ màu sắc chuẩn cho 4 trạng thái:
     - \`OPEN\`: Đỏ/Cam cảnh báo (\`#ef4444\`)
     - \`IN_PROGRESS\`: Vàng/Hổ phách đang xử lý (\`#f59e0b\`)
     - \`RESOLVED\`: Xanh lá hoàn thành (\`#10b981\`)
     - \`ARCHIVED\`: Xám khóa sổ (\`#6b7280\`)
   - Khi \`pin.selected === true\`, phóng to kích thước Pin (ví dụ \`scale = 1.35\`) hoặc hiển thị vòng sáng bao quanh.
3. **Xử lý Che khuất (Occlusion Fading) & Tương tác Click:**
   - Khi Pin bị một phần khác của mô hình 3D che khuất giữa Camera và Pin, giảm độ đậm (\`opacity = 0.25\`) để người dùng vẫn nhận biết có Pin phía sau.
   - Khi người dùng click trực tiếp vào Pin 3D, gọi \`emitPinSelected(pin.id)\` trên \`ViewportBridge\` (và \`stopPropagation\` để không xuyên qua bề mặt phía sau).

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] Hàm tính tọa độ đẩy pháp tuyến (\`computeOffsetPinPosition(position, normal, epsilon)\`) hoạt động chính xác và có unit test.
- [ ] Click vào Pin 3D kích hoạt đúng callback đăng ký qua \`bridge.onPinSelected(cb)\`.
- [ ] \`npm run verify\` chạy xanh, không vi phạm quy tắc biên giới \`R4\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'B4',
    milestone: 'M1',
    assignees: ['NilsNielsen'],
    labels: ['stream:B-viewport'],
    title: '[B4] Smooth Camera Transition (CameraControls.setLookAt) on ViewportBridge.focusCamera()',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hoàng Đức Huy (\`@NilsNielsen\` — 3D Viewport & Raycast)**
- **Tài liệu bắt buộc cho AI Agent:** \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B4\`), \`docs/contracts/DATA_AND_EVENTS.md\` (Mục 3)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/viewport/**\`

### 2. Mục tiêu nghiệp vụ (Objective)
Khi người dùng chọn một Annotation từ thanh danh sách Sidebar 2D (do Luồng C điều khiển), \`AnnotationWorkspaceStore\` sẽ gọi \`bridge.focusCamera(cameraState, annotationId)\`. Luồng B phải điều khiển Camera 3D bay mượt mà (smooth interpolation) về đúng góc nhìn \`cameraState { position, target }\` mà tác giả đã lưu lúc tạo Pin.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Thực thi \`ViewportBridge.focusCamera(cameraState: CameraState, annotationId?: string)\`:**
   - Giải cấu trúc \`const [cx, cy, cz] = cameraState.position\` và \`const [tx, ty, tz] = cameraState.target\`.
   - Kiểm tra toàn bộ 6 giá trị đều là số hữu hạn (\`validateVec3(cameraState.position) && validateVec3(cameraState.target)\`).
   - Gọi \`cameraControls.setLookAt(cx, cy, cz, tx, ty, tz, /* enableTransition = */ true)\`.
2. **Đồng bộ Trạng thái Chọn:**
   - Nếu \`annotationId\` được truyền vào, đánh dấu Pin tương ứng ở trạng thái đang được focus/selected trên màn hình 3D.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] Gọi \`bridge.focusCamera({ position: [2, 3, 4], target: [0, 1, 0] }, 'ann-1')\` truyền đúng 6 tọa độ và cờ \`enableTransition = true\` xuống bộ điều khiển Camera.
- [ ] Có unit test kiểm chứng với mock \`CameraControls\` trong \`apps/web/test/\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'B5',
    milestone: 'M2',
    assignees: ['NilsNielsen'],
    labels: ['stream:B-viewport'],
    title: '[B5] Load Large .glb from Presigned URL with Progress, Draco/Meshopt Decoder & Expiry Handling',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hoàng Đức Huy (\`@NilsNielsen\` — 3D Viewport & Raycast)**
- **Tài liệu bắt buộc cho AI Agent:** \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B5\`)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/viewport/**\`

### 2. Mục tiêu nghiệp vụ (Objective)
Hỗ trợ tải mô hình \`.glb\` dung lượng lớn trực tiếp từ **Presigned GET URL** của S3/MinIO (do API \`GET /api/v1/models/:id\` trả về ở trường \`downloadUrl\`), hỗ trợ giải nén hình học Draco/Meshopt, báo cáo tiến độ tải \`0% -> 100%\` và xử lý an toàn khi Presigned URL hết hạn (\`403 Forbidden\` / network error).

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **State Machine tải mô hình (\`ModelLoadState\`):**
   - Quản lý các trạng thái rõ ràng:
     - \`IDLE\`: Chưa có URL.
     - \`LOADING\`: Đang tải (\`loadedBytes\`, \`totalBytes\`, \`progressPercent: 0..100\`).
     - \`READY\`: Tải và giải mã glTF thành công (kèm \`boundingBox\` để kích hoạt \`[B1]\`).
     - \`ERROR\`: Lỗi mạng, file hỏng hoặc Presigned URL hết hạn (\`reasonCode: 'URL_EXPIRED' | 'CORRUPT_GLB' | 'NETWORK_ERROR'\`).
2. **Hỗ trợ Nén Draco / Meshopt:**
   - Cấu hình \`GLTFLoader\` với \`DRACOLoader\` / \`MeshoptDecoder\` để mở được các file CAD/3D công nghiệp đã nén.
3. **Dọn dẹp Bộ nhớ GPU (Dispose):**
   - Khi chuyển sang model mới hoặc unmount, giải phóng (\`geometry.dispose()\`, \`material.dispose()\`, \`texture.dispose()\`) của model cũ để tránh rò rỉ VRAM.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] State machine chuyển trạng thái đúng \`IDLE -> LOADING (progressPercent) -> READY\` và bắt đúng lỗi \`URL_EXPIRED\` khi Presigned URL trả \`403\`.
- [ ] Có unit test kiểm chứng state machine tải model và tính phần trăm tiến độ trong \`apps/web/test/\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'B6',
    milestone: 'M3',
    assignees: ['NilsNielsen'],
    labels: ['stream:B-viewport'],
    title: '[B6] Live 3D Pin Marker Diffing on Realtime Store Updates Without Resetting Camera Rig',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hoàng Đức Huy (\`@NilsNielsen\` — 3D Viewport & Raycast)**
- **Tài liệu bắt buộc cho AI Agent:** \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B6\`)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/viewport/**\`

### 2. Mục tiêu nghiệp vụ (Objective)
Khi nhiều người dùng cùng làm việc realtime qua Socket.io, \`AnnotationWorkspaceStore\` sẽ gọi \`bridge.setPins(pins)\` liên tục mỗi khi có Pin mới hoặc có người đổi trạng thái Pin. Viewport 3D phải cập nhật mượt danh sách Pin mà **tuyệt đối không làm giật hay reset góc nhìn Camera hiện tại của người đang xem**.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Diffing danh sách \`ViewportPinMarker[]\` theo \`id\`:**
   - Viết hàm \`diffPinMarkers(prevPins, nextPins)\` phân loại rõ:
     - \`added\`: Các Pin mới xuất hiện.
     - \`updated\`: Các Pin có thay đổi về \`status\`, \`selected\`, \`position\` hoặc \`normal\`.
     - \`removed\`: Các Pin đã bị xóa.
     - \`unchanged\`: Các Pin giữ nguyên (không tạo lại Mesh 3D để tiết kiệm GC/GPU).
2. **Bảo toàn trạng thái \`CameraControls\`:**
   - Việc gọi \`bridge.setPins(nextPins)\` chỉ cập nhật nhánh Scene Graph chứa các Pin (\`PinsGroup\`), hoàn toàn tách biệt khỏi nhánh \`ModelGroup\` và \`CameraControls\` (camera chỉ di chuyển khi \`bridge.focusCamera()\` được gọi tường minh).

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] Khi \`setPins()\` được gọi liên tiếp với các cập nhật realtime, góc nhìn \`CameraState\` hiện tại của người dùng không bị thay đổi.
- [ ] Hàm \`diffPinMarkers\` xác định đúng các phần tử \`added\`, \`updated\`, \`removed\`, \`unchanged\` và có unit test kiểm chứng.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'B7',
    milestone: 'M3',
    assignees: ['NilsNielsen'],
    labels: ['stream:B-viewport', 'boundary:occ-invariant'],
    title: '[B7] Spatial Drag Lock Guard when Annotation is RESOLVED or ARCHIVED',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hoàng Đức Huy (\`@NilsNielsen\` — 3D Viewport & Raycast)**
- **Tài liệu bắt buộc cho AI Agent:** \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B7\`), \`packages/shared/src/domain/annotation-policy.ts\`
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/viewport/**\`

### 2. Mục tiêu nghiệp vụ (Objective)
Bảo vệ bất biến không gian ngay trên Viewport 3D: khi một Annotation đã ở trạng thái **\`RESOLVED\`** hoặc **\`ARCHIVED\`**, người dùng **không được phép kéo thả (drag) để dời vị trí Pin 3D sang chỗ khác**, đồng bộ 100% với quy tắc \`SPATIAL_LOCKED_WHEN_RESOLVED\` và \`ANNOTATION_ARCHIVED_IMMUTABLE\` của Backend API.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Tuân thủ tuyệt đối Luật \`R6 (single-source-business-rules)\`:**
   - **CẤM** tự viết cứng \`if (status === 'RESOLVED')\` rời rạc mà phải gọi trực tiếp hàm \`evaluateAnnotationMutation\` từ \`@spriter/shared\`:
     \`\`\`ts
     const check = evaluateAnnotationMutation(
       { status: pin.status, comments: [], position: pin.position, normal: pin.normal },
       { position: candidatePosition, normal: candidateNormal }
     );
     if (!check.allowed) {
       // Chặn thao tác kéo Pin và trả về check.reasonCode ('SPATIAL_LOCKED_WHEN_RESOLVED' | 'ANNOTATION_ARCHIVED_IMMUTABLE')
     }
     \`\`\`
2. **Phản hồi Trực quan trên 3D Viewport:**
   - Khi người dùng cố kéo một Pin đang \`RESOLVED\` hoặc \`ARCHIVED\`, giữ nguyên vị trí cũ của Pin và đổi con trỏ thành \`not-allowed\`.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] Kéo Pin ở trạng thái \`OPEN\` hoặc \`IN_PROGRESS\` được phép cập nhật tọa độ mới.
- [ ] Kéo Pin ở trạng thái \`RESOLVED\` bị chặn với mã lý do \`SPATIAL_LOCKED_WHEN_RESOLVED\`.
- [ ] Kéo Pin ở trạng thái \`ARCHIVED\` bị chặn với mã lý do \`ANNOTATION_ARCHIVED_IMMUTABLE\`.
- [ ] Có unit test kiểm chứng trong \`apps/web/test/\` và pass \`npm run arch:check\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'B8',
    milestone: 'M4',
    assignees: ['NilsNielsen'],
    labels: ['stream:B-viewport'],
    title: '[B8] 3D Pin Instancing & Occlusion Raycast Throttling (200-500 Pins >= 30 FPS)',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hoàng Đức Huy (\`@NilsNielsen\` — 3D Viewport & Raycast)**
- **Tài liệu bắt buộc cho AI Agent:** \`docs/tasks/STREAM_B_3D_VIEWPORT.md\` (\`B8\`)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/viewport/**\`

### 2. Mục tiêu nghiệp vụ (Objective)
Đảm bảo hiệu năng hiển thị 3D mượt mà ($\ge 30\text{ FPS}$) ngay cả khi một mô hình phức tạp có từ **200 đến 500 Annotations** cùng lúc bằng cách gom nhóm Draw Call (InstancedMesh / Buffer cập nhật hàng loạt) và giới hạn tần suất kiểm tra che khuất (Occlusion Raycast Throttling).

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Gom nhóm Ma trận Biến đổi cho \`InstancedMesh\`:**
   - Cung cấp bộ tính toán buffer ma trận/màu sắc hàng loạt cho \`200–500\` \`ViewportPinMarker\` chỉ trong 1 lần duyệt mảng (1 Draw Call duy nhất cho toàn bộ các Pin).
2. **Occlusion Raycast Throttling / Batching:**
   - Không chạy 500 phép Raycast kiểm tra che khuất ở mỗi frame 60Hz. Thay vào đó, chỉ kiểm tra theo lô (round-robin batching, ví dụ tối đa \`25–50\` pins mỗi frame hoặc chỉ khi camera di chuyển quá ngưỡng $\\Delta > 0.01$).

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] Thuật toán chia lô kiểm tra che khuất (occlusion batch scheduler) giới hạn đúng số lượng raycast mỗi frame và duyệt hết 500 pins sau $N$ bước.
- [ ] Tính toán buffer cho 500 pins hoàn tất trong \`< 5ms\` (đảm bảo ngân sách frame 16.6ms/33.3ms).
- [ ] Có unit test kiểm chứng trong \`apps/web/test/\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },

  // ==========================================================================
  // STREAM C — HỒ TRỌNG HIẾU (@soshyz27 — 2D COLLABORATION UI, STORE & ADAPTERS)
  // ==========================================================================
  {
    id: 'C1',
    milestone: 'M1',
    assignees: ['soshyz27'],
    labels: ['stream:C-collab-ui'],
    title: '[C1] Annotation Sidebar List, Status Filter & Camera Focus Selection Sync',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hồ Trọng Hiếu (\`@soshyz27\` — 2D Collaboration UI & Adapters)**
- **Tài liệu bắt buộc cho AI Agent:** \`AGENTS.md\`, \`apps/web/src/features/AGENTS.md\`, \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C1\`), \`docs/contracts/DATA_AND_EVENTS.md\` (Mục 3)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/features/**\`
- **Quy tắc kiến trúc bắt buộc (\`R4 & R5\`):**
  - **CẤM TUYỆT ĐỐI** import \`three\` hoặc \`@react-three/*\` vào \`src/features/**\` hay \`src/adapters/**\`.
  - Mọi tương tác với 3D Viewport chỉ đi qua \`AnnotationWorkspaceStore\` và \`ViewportBridge\`.

### 2. Mục tiêu nghiệp vụ (Objective)
Xây dựng bộ điều khiển và giao diện danh sách Annotation ở thanh bên (Sidebar 2D), cho phép lọc theo trạng thái (\`ALL\`, \`OPEN\`, \`IN_PROGRESS\`, \`RESOLVED\`, \`ARCHIVED\`), tìm kiếm theo nội dung comment/tên mesh, và đồng bộ 2 chiều việc chọn Pin giữa Sidebar 2D và Canvas 3D.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Kết nối với \`AnnotationWorkspaceStore\` (\`apps/web/src/app/annotation-store.ts\`):**
   - Lấy danh sách \`AnnotationDomainSnapshot[]\` từ Store, hỗ trợ lọc theo \`status\` và từ khóa tìm kiếm (khớp với \`meshName\`, \`authorName\` hoặc nội dung \`comments\`).
   - Hiển thị số lượng đếm (badge count) cho từng trạng thái (\`OPEN\`, \`IN_PROGRESS\`, \`RESOLVED\`, \`ARCHIVED\`).
2. **Đồng bộ Chọn 2 chiều (Sidebar 2D $\\leftrightarrow$ 3D Viewport):**
   - Khi người dùng **click vào một dòng trên Sidebar 2D**: gọi \`store.selectAnnotation(annotation.id, /* focusCamera = */ true)\` để Store vừa đánh dấu \`selectedAnnotationId = id\`, vừa ra lệnh \`bridge.focusCamera(annotation.cameraState, id)\` cho Camera 3D bay mượt về góc nhìn của Pin đó.
   - Khi người dùng **click vào một Pin trên Canvas 3D**: Store tự động nhận sự kiện từ \`bridge.onPinSelected\` và cập nhật \`selectedAnnotationId\`; Sidebar 2D phải tự động làm nổi bật (highlight) dòng tương ứng.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] Lọc danh sách chính xác theo từng \`AnnotationStatus\` và từ khóa tìm kiếm.
- [ ] Click dòng trên Sidebar gọi \`store.selectAnnotation(id, true)\` và kích hoạt \`bridge.focusCamera\`.
- [ ] Không import bất kỳ thư viện 3D nào (\`npm run arch:check\` xanh).

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C2',
    milestone: 'M1',
    assignees: ['soshyz27'],
    labels: ['stream:C-collab-ui'],
    title: '[C2] New Pin Creation Flow: Placement Mode -> Receive SurfacePick -> Submit Initial Comment',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hồ Trọng Hiếu (\`@soshyz27\` — 2D Collaboration UI & Adapters)**
- **Tài liệu bắt buộc cho AI Agent:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C2\`), \`docs/contracts/DATA_AND_EVENTS.md\` (Mục 2 & 3)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/features/**\`, \`apps/web/src/adapters/**\`

### 2. Mục tiêu nghiệp vụ (Objective)
Triển khai trọn vẹn luồng tạo mới một Annotation trên mô hình 3D: Người dùng bật chế độ *"Đặt Pin mới"* trên UI $\\rightarrow$ Click lên bề mặt 3D $\\rightarrow$ Nhận tọa độ \`SurfacePick\` từ \`ViewportBridge\` $\\rightarrow$ Nhập \`initialComment\` $\\rightarrow$ Lưu lên Server (hoặc \`FakeAnnotationApi\`) và hiển thị Pin mới ngay lập tức.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Bước 1 — Bật/Hủy Chế độ Đặt Pin (\`Placement Mode\`):**
   - Khi bấm nút *"Thêm Annotation"*, gọi \`store.setPlacementMode(true)\` (chuyển tiếp xuống \`bridge.setPlacementMode(true)\`).
   - Hỗ trợ bấm \`Escape\` hoặc nút *"Hủy"* để tắt \`setPlacementMode(false)\` và xóa \`pendingPick\`.
2. **Bước 2 — Nhận \`SurfacePick\` từ Viewport 3D:**
   - Khi Luồng B phát \`onSurfacePicked(pick: SurfacePick)\`, \`AnnotationWorkspaceStore\` tự động lưu \`pendingPick = pick\` và tắt \`placementMode = false\`.
   - Giao diện mở form tạo mới hiển thị thông tin vị trí \`pick.position\`, \`pick.meshName\` và ô nhập \`initialComment\`.
3. **Bước 3 — Kiểm tra & Gửi \`CreateAnnotationRequestDto\`:**
   - Kiểm tra \`initialComment.trim().length > 0\` (khuyến nghị gợi ý người dùng nhập $\\ge 10$ ký tự để đủ điều kiện \`RESOLVED\` sau này).
   - Gửi \`CreateAnnotationRequestDto { position: pick.position, normal: pick.normal, cameraState: pick.cameraState, meshName: pick.meshName, initialComment }\` lên API \`POST /api/v1/models/:modelId/annotations\`.
   - Khi nhận phản hồi \`201 Created (AnnotationDomainSnapshot)\`, đưa vào \`store.upsertAnnotation(snapshot)\`, xóa \`pendingPick = null\`, và chọn luôn Pin vừa tạo.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] Bật \`setPlacementMode(true)\` $\\rightarrow$ giả lập \`FakeViewportBridge.emitSurfacePick(pick)\` $\\rightarrow$ form nhận đúng \`pendingPick\`.
- [ ] Không cho phép submit khi \`initialComment\` rỗng; khi submit hợp lệ tạo ra Annotation \`version = 1\`, \`status = 'OPEN'\` và đồng bộ xuống \`ViewportBridge.setPins()\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C3',
    milestone: 'M1',
    assignees: ['soshyz27'],
    labels: ['stream:C-collab-ui', 'boundary:occ-invariant'],
    title: '[C3] Comment Thread Panel & Status Transition Controls Delegating to Shared Domain Policy',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hồ Trọng Hiếu (\`@soshyz27\` — 2D Collaboration UI & Adapters)**
- **Tài liệu bắt buộc cho AI Agent:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C3\`), \`docs/contracts/DATA_AND_EVENTS.md\` (Mục 1)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/features/annotations/**\`

### 2. Mục tiêu nghiệp vụ (Objective)
Hiển thị luồng thảo luận (Comment Thread) của Annotation đang chọn, cho phép gửi phản hồi mới (tự động nâng \`version + 1\`), và hiển thị các nút chuyển trạng thái (\`OPEN\`, \`IN_PROGRESS\`, \`RESOLVED\`, \`ARCHIVED\`) bằng cách **ủy quyền 100% logic kiểm tra nghiệp vụ cho \`@spriter/shared\`** (loại bỏ triệt để code smell lặp business rule giữa UI và API).

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Tuân thủ tuyệt đối Luật \`R6 (single-source-business-rules)\`:**
   - Sử dụng \`AnnotationThreadPanelController\` (\`apps/web/src/features/annotations/AnnotationThreadController.ts\`), gọi \`evaluateAnnotationMutation\` và \`canActorModifyAnnotation\` từ \`@spriter/shared\`.
   - **CẤM** khai báo lại hằng số độ dài comment tối thiểu (\`10\`) hay bảng chuyển trạng thái bên trong \`apps/web\`.
2. **Hiển thị Lý do Vô hiệu hóa Nút Chuyển Trạng thái (Disabled Reason Tooltip):**
   - Với mỗi trạng thái đích, gọi \`controller.canTransitionStatus(targetStatus)\`:
     - Nếu \`allowed === false\`, vô hiệu hóa nút bấm và hiển thị rõ \`reasonCode\` / \`message\` (ví dụ: *"Cần ít nhất 1 comment >= 10 ký tự trong chuỗi thảo luận trước khi chuyển sang RESOLVED"* — \`MISSING_RESOLUTION_COMMENT\`).
     - Với nút \`ARCHIVED\` hoặc \`DELETE\`, kiểm tra thêm \`canActorModifyAnnotation(currentUser, annotation, 'ARCHIVE')\` để chỉ bật cho tác giả của Pin hoặc \`PROJECT_LEAD\`.
3. **Thêm Comment mới vào Thread:**
   - Gọi API \`POST /api/v1/annotations/:id/comments\`, nhận về \`AnnotationDomainSnapshot\` mới (đã tăng \`version = version + 1\`) và cập nhật ngay vào Store để lần bấm đổi trạng thái tiếp theo dùng đúng \`expectedVersion\` mới nhất.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] Khi Thread chỉ có comment ngắn \`"Fix"\` (\`< 10\` ký tự), nút \`RESOLVED\` bị khóa kèm lý do \`MISSING_RESOLUTION_COMMENT\`.
- [ ] Khi Thread đã có 1 comment giải trình $\\ge 10$ ký tự, dù comment cuối cùng chỉ là \`"OK!"\` (3 ký tự), nút \`RESOLVED\` **vẫn được bật hợp lệ**.
- [ ] Thêm comment mới nâng \`version\` của Annotation trong Store lên \`+1\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run arch:check && npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C4',
    milestone: 'M1',
    assignees: ['soshyz27'],
    labels: ['stream:C-collab-ui'],
    title: '[C4] Export/Import JSON v1 UI with fileHash Mismatch Warning Dialog & Per-Item Error Display',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hồ Trọng Hiếu (\`@soshyz27\` — 2D Collaboration UI & Adapters)**
- **Tài liệu bắt buộc cho AI Agent:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C4\`), \`docs/contracts/DATA_AND_EVENTS.md\` (Mục 5.2)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/features/**\`, \`apps/web/src/adapters/**\`

### 2. Mục tiêu nghiệp vụ (Objective)
Cho phép người dùng xuất (Export) toàn bộ Annotations của mô hình hiện tại ra file JSON chuẩn \`ExportFileV1\` và nạp lại (Import) từ file JSON, xử lý trọn vẹn cả 2 tình huống lỗi đặc thù: **lệch mã băm mô hình 3D (\`409 IMPORT_MODEL_HASH_MISMATCH\`)** và **lỗi dữ liệu từng dòng (\`422 IMPORT_VALIDATION_FAILED\`)**.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Tính năng Export (\`ExportFileV1\`):**
   - Gọi \`GET /api/v1/models/:modelId/annotations/export\` (hoặc xuất từ Store kèm \`modelMeta { name, fileHash }\`) để tải về file \`<modelName>-annotations-v1.json\`.
2. **Tính năng Import — Bước 1 (Kiểm tra sơ bộ & Gửi chế độ \`STRICT\`):**
   - Đọc file JSON người dùng chọn, có thể chạy kiểm tra nhanh \`validateExportPayload(payload)\` từ \`@spriter/shared\`.
   - Mặc định gửi lên Server với \`mode: 'STRICT'\`: \`POST /api/v1/models/:modelId/annotations/import\`.
3. **Tính năng Import — Bước 2 (Xử lý \`409 IMPORT_MODEL_HASH_MISMATCH\`):**
   - Nếu Server trả về \`409\` với \`errorCode: 'IMPORT_MODEL_HASH_MISMATCH'\`, hiển thị hộp thoại cảnh báo rõ ràng:
     - Mã băm file 3D đang mở (\`expectedFileHash\`) khác với mã băm trong file JSON (\`actualFileHash\`).
     - Cung cấp 2 lựa chọn: **Hủy bỏ (Cancel)** hoặc **Vẫn tiếp tục nạp cưỡng bức (Force Import)** $\\rightarrow$ gọi lại API với \`mode: 'FORCE_HASH_MISMATCH'\`.
4. **Tính năng Import — Bước 3 (Xử lý \`422 IMPORT_VALIDATION_FAILED\`):**
   - Nếu Server trả về \`422\` kèm mảng \`itemErrors: ImportItemError[]\`, hiển thị bảng báo cáo lỗi chi tiết cho từng dòng (\`index\`, \`annotationId\`, \`reasonCode\`, \`message\`) để người dùng sửa file JSON.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] Export tạo đúng cấu trúc \`ExportFileV1\` khớp với fixture mẫu \`packages/shared/fixtures/export-v1.json\`.
- [ ] Khi gặp \`409 IMPORT_MODEL_HASH_MISMATCH\`, state controller bật cờ yêu cầu xác nhận và cho phép retry với \`mode: 'FORCE_HASH_MISMATCH'\`.
- [ ] Khi gặp \`422 IMPORT_VALIDATION_FAILED\`, lưu và hiển thị đầy đủ danh sách \`itemErrors[]\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:shared && npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C5',
    milestone: 'M2',
    assignees: ['soshyz27'],
    labels: ['stream:C-collab-ui'],
    title: '[C5] Login/Register Views & HttpAnnotationApi Adapter with expectedVersion Contract',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hồ Trọng Hiếu (\`@soshyz27\` — 2D Collaboration UI & Adapters)**
- **Tài liệu bắt buộc cho AI Agent:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C5\`), \`docs/contracts/DATA_AND_EVENTS.md\` (Mục 2)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/adapters/**\`, \`apps/web/src/features/**\`

### 2. Mục tiêu nghiệp vụ (Objective)
Xây dựng Adapter kết nối HTTP thực tế (\`HttpAnnotationApi\`) thay thế cho \`FakeAnnotationApi\` khi chạy với Backend thật (\`http://localhost:4000\`), quản lý phiên đăng nhập JWT (\`login\`, \`register\`, \`me\`) và đảm bảo mọi lệnh cập nhật đều đính kèm \`expectedVersion\` cùng header \`Authorization: Bearer <token>\`.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Quản lý Phiên Đăng nhập (Auth Controller / Adapter):**
   - Hỗ trợ gọi \`POST /api/v1/auth/login\`, \`POST /api/v1/auth/register\`, \`GET /api/v1/auth/me\`.
   - Lưu \`accessToken\` và \`currentUser: UserSummary\` (\`id\`, \`email\`, \`name\`, \`role: 'REVIEWER' | 'PROJECT_LEAD'\`).
   - Hỗ trợ chọn nhanh 3 tài khoản Dev có sẵn trên Backend để test nhóm:
     - \`lead@spriter.local\` / \`SpriterLead#2026\` (\`PROJECT_LEAD\`)
     - \`huy@spriter.local\` / \`Spriter3D#2026\` (\`REVIEWER\`)
     - \`hieu@spriter.local\` / \`SpriterUI#2026\` (\`REVIEWER\`)
2. **Cài đặt \`HttpAnnotationApi\` thực thi \`AnnotationApiPort\`:**
   - Tự động đính kèm header \`Authorization: Bearer <accessToken>\` và \`Content-Type: application/json\`.
   - Trong \`patchAnnotation(id, payload)\`: luôn gửi \`expectedVersion\` trong body JSON và phân tích chính xác phản hồi:
     - \`200 OK\` $\\rightarrow$ \`{ ok: true, data: snapshot }\`
     - \`409 Conflict\` $\\rightarrow$ \`{ ok: false, status: 409, errorCode: 'CONCURRENCY_CONFLICT', currentVersion, serverSnapshot }\`
     - \`422 Unprocessable Entity\` $\\rightarrow$ \`{ ok: false, status: 422, errorCode, message }\`
     - \`401\` / \`403\` $\\rightarrow$ xử lý hết hạn phiên hoặc không đủ quyền RBAC.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] \`HttpAnnotationApi\` truyền đúng \`Authorization: Bearer ...\` và \`expectedVersion\` qua hàm \`fetch\` (có thể truyền custom \`fetchFn\` vào constructor để unit test không cần mở port mạng).
- [ ] Bóc tách chính xác lỗi \`409 CONCURRENCY_CONFLICT\` (kèm \`serverSnapshot\`), \`403 FORBIDDEN_OPERATION\`, và \`422\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C6',
    milestone: 'M2',
    assignees: ['soshyz27'],
    labels: ['stream:C-collab-ui'],
    title: '[C6] Presigned .glb Upload Modal with SHA-256 Hash Calculation & Progress Bar',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hồ Trọng Hiếu (\`@soshyz27\` — 2D Collaboration UI & Adapters)**
- **Tài liệu bắt buộc cho AI Agent:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C6\`)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/features/**\`, \`apps/web/src/adapters/**\`

### 2. Mục tiêu nghiệp vụ (Objective)
Triển khai luồng tải file mô hình \`.glb\` mới lên hệ thống theo đúng kiến trúc **Direct-to-S3/MinIO Presigned Upload 3 bước**, tự động băm mã SHA-256 (\`fileHash\`) của file ở phía client để phục vụ kiểm tra toàn vẹn khi Export/Import, và hiển thị thanh tiến độ tải \`0% -> 100%\`.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Bước 1 — Kiểm tra File & Tính mã băm SHA-256 (\`fileHash\`):**
   - Kiểm tra đuôi file \`.glb\` hoặc \`.gltf\` và \`fileSize > 0\`.
   - Tính mã băm SHA-256 hex 64 ký tự (dùng Web Crypto API \`crypto.subtle.digest('SHA-256', buffer)\`).
2. **Bước 2 — Xin Presigned PUT URL & Upload Trực tiếp lên Storage:**
   - Gọi \`POST /api/v1/models/upload-url\` với \`RequestModelUploadUrlDto { fileName, fileSize, fileHash }\` (chỉ gửi JSON metadata vài trăm bytes, tuyệt đối không gửi binary \`.glb\` vào API Server để tránh lỗi \`413 PAYLOAD_TOO_LARGE\`).
   - Dùng \`uploadUrl\` nhận được để gửi \`PUT\` binary trực tiếp lên S3/MinIO, cập nhật tiến độ \`progressPercent (0..100)\`.
3. **Bước 3 — Xác nhận Hoàn tất (\`Confirm Upload\`):**
   - Gọi \`POST /api/v1/models/:modelId/confirm\` với \`ConfirmModelUploadDto { fileSize, fileHash }\` để nhận về \`ModelSummaryDto\` (trạng thái \`READY\` kèm \`downloadUrl\`) và chuyển không gian làm việc sang model mới.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] Tính đúng chuỗi hex SHA-256 64 ký tự từ dữ liệu file \`.glb\`.
- [ ] Thực thi đúng trình tự 3 bước: \`requestUploadUrl\` $\\rightarrow$ \`PUT uploadUrl\` (cập nhật \`progressPercent\`) $\\rightarrow$ \`confirmUpload\`.
- [ ] Có unit test kiểm chứng controller/adapter upload 3 bước với mock storage/API.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C7',
    milestone: 'M3',
    assignees: ['soshyz27'],
    labels: ['stream:C-collab-ui', 'boundary:occ-invariant'],
    title: '[C7] SocketRealtimeAdapter with Monotonic Version Guard & Gap Recovery Catch-Up Sync',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hồ Trọng Hiếu (\`@soshyz27\` — 2D Collaboration UI & Adapters)**
- **Tài liệu bắt buộc cho AI Agent:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C7\`), \`docs/contracts/DATA_AND_EVENTS.md\` (Mục 4)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/adapters/**\`, \`apps/web/src/features/**\`

### 2. Mục tiêu nghiệp vụ (Objective)
Xây dựng \`SocketRealtimeAdapter\` lắng nghe các sự kiện thời gian thực từ \`SocketRealtimeGateway\` (\`room = model:{modelId}\`), bảo vệ Store khỏi các gói tin WebSocket đến trễ/lộn thứ tự bằng **Monotonic Version Guard**, và tự động tải bù dữ liệu bị lỡ (\`Catch-Up Sync\`) khi phát hiện hụt version hoặc vừa kết nối lại sau khi rớt mạng.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Gia nhập Room & Đồng bộ Bù khi Reconnect (\`room:join\`):**
   - Khi kết nối hoặc kết nối lại (\`reconnect\`), thu thập bảng phiên bản hiện có trong Store \`knownVersions: Record<string, number>\` (ví dụ \`{ 'ann-1': 2, 'ann-2': 5 }\`) và gửi \`room:join { modelId, knownVersions }\`.
   - Nếu \`RoomJoinAck.missedAnnotations\` trả về các bản ghi có version mới hơn, lập tức gọi \`store.upsertAnnotation()\` cho từng bản ghi đó.
2. **Xử lý 4 sự kiện \`ServerRealtimeEvent\` với \`classifyRealtimeVersionStep\`:**
   - \`annotation:created\`: Gọi \`store.upsertAnnotation(event.annotation)\`.
   - \`annotation:updated\`: Gọi \`store.handleRealtimeUpdate(event.previousVersion, event.annotation)\` (bên trong sử dụng \`classifyRealtimeVersionStep(localVersion, previousVersion, incomingVersion)\` từ \`@spriter/shared\`):
     - Nếu trả về \`'IGNORE_STALE'\` (\`incomingVersion <= localVersion\`): bỏ qua gói tin cũ đến trễ.
     - Nếu trả về \`'APPLY'\` (\`previousVersion === localVersion\`): cập nhật mượt vào Store và 3D Pins.
     - Nếu trả về \`'APPLY_AND_FETCH_GAP'\` (\`previousVersion > localVersion\`, tức là đã bị rớt gói tin trung gian): áp dụng bản mới nhất VÀ tự động gọi \`GET /api/v1/models/:modelId/annotations?updatedAfter=<lastSyncIso>\` để đồng bộ bù toàn bộ model, sau đó gọi \`store.clearCatchUpFlag()\`.
   - \`comment:created\`: Nếu \`annotationVersion > localVersion\`, cập nhật comment và nâng \`version\` của Annotation; nếu phát hiện gap thì kích hoạt catch-up fetch.
   - \`annotation:deleted\`: Xóa Annotation khỏi Store và cập nhật lại \`ViewportBridge.setPins()\`.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] Gói tin WebSocket có \`version <= localVersion\` bị bỏ qua hoàn toàn (\`IGNORE_STALE\`), không làm lùi trạng thái UI.
- [ ] Khi nhận gói tin có \`previousVersion > localVersion\` (ví dụ đang ở \`v2\` mà nhận sự kiện nhảy từ \`v4 -> v5\`), adapter tự động kích hoạt gọi API \`listAnnotations(updatedAfter)\` để tải bù và xóa cờ \`needsCatchUpFetch\`.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C8',
    milestone: 'M3',
    assignees: ['soshyz27'],
    labels: ['stream:C-collab-ui', 'boundary:occ-invariant'],
    title: '[C8] 409 Conflict Resolution Dialog (Inspect serverSnapshot, Accept Server vs Retry on Latest)',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hồ Trọng Hiếu (\`@soshyz27\` — 2D Collaboration UI & Adapters)**
- **Tài liệu bắt buộc cho AI Agent:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C8\`), \`docs/contracts/DATA_AND_EVENTS.md\` (Mục 5.1)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/features/annotations/**\`

### 2. Mục tiêu nghiệp vụ (Objective)
Giải quyết trọn vẹn biến cố kiến trúc cốt lõi ở phía Client: khi 2 người dùng cùng lúc cập nhật một Annotation và Server trả về **\`409 CONCURRENCY_CONFLICT\`**, giao diện **tuyệt đối không được làm mất ý định thay đổi của người dùng và không tự ý gộp trường ngầm**, mà hiển thị hộp thoại đối chiếu giữa thay đổi đang chờ của người dùng với \`serverSnapshot\` mới nhất để người dùng quyết định.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Bảo toàn Ý định Người dùng khi gặp \`409 Conflict\`:**
   - Khi \`PATCH /api/v1/annotations/:id\` trả về \`409\`, lưu lại:
     - \`conflictSnapshot: AnnotationDomainSnapshot\` (bản chụp mới nhất trên Server ở \`currentVersion\`).
     - \`pendingStatusAttempt\` / \`pendingPatch\` (thao tác mà người dùng vừa thực hiện).
     - Đồng bộ \`conflictSnapshot\` vào Store để 3D Viewport và Comment Thread hiển thị đúng dữ liệu mới nhất của đồng nghiệp.
2. **Cung cấp 2 Hành động Giải quyết Xung đột Rõ ràng:**
   - **Lựa chọn 1 — Chấp nhận bản của Server (\`acceptServerConflictSnapshot()\`):** Hủy thao tác đang chờ, đóng hộp thoại xung đột và giữ nguyên trạng thái \`serverSnapshot\`.
   - **Lựa chọn 2 — Thử áp dụng lại trên phiên bản mới nhất (\`retryPendingStatusOnLatestVersion()\`):**
     - Kiểm tra lại \`evaluateAnnotationMutation(conflictSnapshot, pendingPatch)\` từ \`@spriter/shared\`.
     - Nếu thay đổi vẫn hợp lệ trên nền \`conflictSnapshot\` (ví dụ: người kia chỉ vừa thêm comment nâng lên \`v5\`, và mình muốn chuyển sang \`RESOLVED\`), tự động gửi lại lệnh \`PATCH\` với **\`expectedVersion = conflictSnapshot.version\` (\`5\`)** để nâng lên \`v6\` thành công!
     - Nếu thay đổi không còn hợp lệ trên nền mới (ví dụ: người kia đã \`ARCHIVED\` annotation đó ở \`v5\`), thông báo rõ lý do vi phạm Invariant.

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] Kịch bản xung đột \`v4 -> 409 (server v5) -> retryPendingStatusOnLatestVersion() -> 200 OK (v6)\` hoạt động hoàn hảo.
- [ ] Kịch bản \`acceptServerConflictSnapshot()\` xóa trạng thái lỗi và giữ nguyên bản \`v5\` của Server.

### 5. Cổng xác minh (Verification Gate)
\`\`\`bash
npm run test:web && npm run verify
\`\`\``,
  },
  {
    id: 'C9',
    milestone: 'M4',
    assignees: ['soshyz27'],
    labels: ['stream:C-collab-ui'],
    title: '[C9] Keyboard Accessibility (a11y) & Loading/Empty/Error States for Review Workspace',
    body: `### 1. Phân công & Phạm vi (Stream & Scope)
- **Người phụ trách (Owner):** **Hồ Trọng Hiếu (\`@soshyz27\` — 2D Collaboration UI & Adapters)**
- **Tài liệu bắt buộc cho AI Agent:** \`docs/tasks/STREAM_C_COLLAB_UI.md\` (\`C9\`)
- **Phạm vi file được phép sửa (Write Scope):** \`apps/web/src/features/**\`

### 2. Mục tiêu nghiệp vụ (Objective)
Hoàn thiện trải nghiệm người dùng và khả năng tiếp cận (Keyboard Accessibility — a11y) cho toàn bộ không gian làm việc 2D: điều hướng bằng bàn phím (\`N\`, \`Escape\`, \`ArrowUp/ArrowDown\`, \`Enter\`), quản lý trạng thái \`Loading\` / \`Empty\` / \`Error\`, và cung cấp đầy đủ thuộc tính ARIA cho trình đọc màn hình.

### 3. Yêu cầu kỹ thuật chi tiết (Detailed Technical Requirements)
1. **Phím tắt Bàn phím (Keyboard Shortcuts Controller):**
   - Phím \`n\` hoặc \`N\` (khi không focus trong ô \`input\`/\`textarea\`): Bật chế độ đặt Pin mới (\`setPlacementMode(true)\`).
   - Phím \`Escape\`: Hủy chế độ đặt Pin (\`setPlacementMode(false)\`) hoặc đóng hộp thoại xung đột \`409\` / bỏ chọn Pin.
   - Phím \`ArrowDown\` / \`ArrowUp\` (hoặc \`j\` / \`k\`): Di chuyển chọn Pin kế tiếp / trước đó trong danh sách Sidebar đã lọc và tự động gọi \`focusCamera\`.
2. **Trạng thái Giao diện (\`WorkspaceUiState\`):**
   - Quản lý rõ ràng các trạng thái: \`isLoadingAnnotations\`, \`isSubmittingComment\`, \`isUploadingModel\`, \`emptyStateMessage\` (khi model chưa có Pin nào hoặc khi bộ lọc \`status\` không khớp với Pin nào), và \`globalErrorBanner\`.
3. **Chuẩn Accessibility (ARIA Metadata):**
   - Cung cấp hàm sinh thuộc tính ARIA chuẩn (\`role="listbox"\`, \`aria-selected\`, \`role="alertdialog"\` cho hộp thoại \`409 Conflict\`, \`aria-disabled\` kèm \`title\` giải thích lý do khóa nút chuyển trạng thái).

### 4. Tiêu chí nghiệm thu (Acceptance Criteria)
- [ ] Phím tắt \`N\`, \`Escape\`, \`ArrowDown\`, \`ArrowUp\` điều khiển chính xác \`AnnotationWorkspaceStore\` và bỏ qua khi người dùng đang gõ chữ trong ô comment.
- [ ] Đầy đủ trạng thái Empty / Loading / Error và ARIA metadata, có unit test kiểm chứng trong \`apps/web/test/\`.

### 5. Cổng xác minh (Verification Gate)
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
    console.log('📋 GitHub Project Provisioner Plan (4 Milestones, 4 Labels, 27 Detailed Issues)');
    console.log('================================================================================');
    for (const m of MILESTONES) {
      const mIssues = ISSUES.filter((i) => i.milestone === m.key);
      console.log(`\n🎯 ${m.title} (${mIssues.length} issues)`);
      for (const issue of mIssues) {
        console.log(
          `   - ${issue.title} [Owner: @${issue.assignees.join(', @')}] [${issue.labels.join(', ')}]`,
        );
      }
    }
    if (!isDryRun && (!token || !repo)) {
      console.log(
        '\nℹ️  To sync/update these directly on GitHub:\n' +
          '   GITHUB_TOKEN=ghp_xxx npm run github:sync',
      );
    }
    return;
  }

  console.log(`🚀 Syncing Milestones, Labels, and 27 Detailed Issues to GitHub repository: ${repo}...`);

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
    } else {
      const created = await ghRequest('/milestones', 'POST', {
        title: m.title,
        description: m.description,
      });
      milestoneNumberByKey.set(m.key, created.number);
      console.log(`  ✔ Created milestone: ${created.title} (#${created.number})`);
    }
  }

  // 3. Create or Update all 27 Task Issues (Idempotent by [A1] / [B1] / [C1] prefix)
  const existingIssues = await ghRequest('/issues?state=all&per_page=100');
  for (const issue of ISSUES) {
    const prefix = `[${issue.id}]`;
    const alreadyExists = existingIssues.find((ei) => !ei.pull_request && ei.title.startsWith(prefix));
    if (alreadyExists) {
      await ghRequest(`/issues/${alreadyExists.number}`, 'PATCH', {
        title: issue.title,
        body: issue.body,
        labels: issue.labels,
        milestone: milestoneNumberByKey.get(issue.milestone),
        assignees: issue.assignees,
      });
      console.log(
        `  ↻ Updated issue #${alreadyExists.number}: ${issue.title} -> @${issue.assignees.join(', @')}`,
      );
      continue;
    }

    const created = await ghRequest('/issues', 'POST', {
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
      milestone: milestoneNumberByKey.get(issue.milestone),
      assignees: issue.assignees,
    });
    console.log(`  ✔ Created issue #${created.number}: ${created.title}`);
  }

  console.log('✅ All 27 GitHub Issues are synced with full technical specifications and assignees!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
