# Hồ sơ Task Luồng A: Backend, Realtime & Hạ tầng (Tech Lead Stream)

> **Dành cho AI Agent của Thành viên A (Tech Lead / Backend Owner):**
> - **Write Scope (Được phép sửa):** `apps/api/**`, `infra/**`, `scripts/**`, `.github/**`, `apps/web/src/app/**`.
> - **Read-Only Contracts:** `packages/shared/**` (Chỉ sửa khi cập nhật contract chung cho cả nhóm).
> - **Lệnh kiểm chứng bắt buộc sau mỗi Task:** `npm run test:api && npm run verify`.

---

## Danh sách Task Chi tiết & Cổng Xác minh

### `[A1]` Database Schema & Migration (`0000_init.sql`)
- **Milestone:** `M1`
- **Mục tiêu:** Thiết lập schema PostgreSQL cho 5 bảng (`users`, `models`, `annotations`, `comments`, `operational_audit_logs`) tại `apps/api/src/db/migrations/0000_init.sql`.
- **Yêu cầu kỹ thuật:**
  - Bảng `annotations` bắt buộc có `version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1)` và `status CHECK (status IN ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'ARCHIVED'))`.
  - Bảng `operational_audit_logs` bắt buộc có `expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days')` và index `idx_operational_audit_logs_expires_at`.
- **Cổng xác minh:** `npm run verify` xanh; file SQL chạy không lỗi trên PostgreSQL 16.

### `[A2]` Transactional OCC Repository & 7-Day Audit Trail
- **Milestone:** `M1`
- **Mục tiêu:** Thực thi `AnnotationRepositoryPort` (`apps/api/src/modules/annotations/domain/ports.ts`) đảm bảo kiểm soát đồng thời nguyên tử (Compare-And-Swap).
- **Yêu cầu kỹ thuật:**
  - Phương thức `updateIfVersion(id, expectedVersion, updatedRow, audit)` chỉ cập nhật khi `version = expectedVersion` và tăng `version = version + 1` cùng lúc với việc ghi `OperationalAuditLogEntry`.
- **Cổng xác minh:** `npm run test:api` (Pass Test #2 & Test #3 trong `apps/api/test/annotation-api.spec.ts`).

### `[A3]` Auth (Login/Register/Me) & RBAC Permission Gate
- **Milestone:** `M2`
- **Mục tiêu:** Xây dựng module xác thực (`POST /api/v1/auth/login`, `POST /api/v1/auth/register`, `GET /api/v1/auth/me`) và tích hợp hàm `canActorModifyAnnotation` từ `@spriter/shared`.
- **Yêu cầu kỹ thuật:**
  - Băm mật khẩu an toàn (`scrypt`/`argon2`), tuyệt đối không trả `password_hash` ra response hay log.
  - Chỉ cho phép tác giả Annotation hoặc `PROJECT_LEAD` chuyển trạng thái sang `ARCHIVED` hoặc xóa.
- **Cổng xác minh:** Unit test xác nhận `401` khi thiếu token, `403 FORBIDDEN_OPERATION` khi `REVIEWER` khác cố tình `ARCHIVE` annotation không phải của mình.

### `[A4]` Hoàn thiện REST CRUD & Cursor Pagination cho Annotations/Comments
- **Milestone:** `M2`
- **Mục tiêu:** Hoàn thiện `AnnotationController` (`apps/api/src/modules/annotations/http/annotation.controller.ts`):
  - `GET /api/v1/models/:modelId/annotations` (hỗ trợ lọc `status`, phân trang `cursor`/`limit`, và `updatedAfter` cho reconnect catch-up).
  - `POST /api/v1/models/:modelId/annotations` (tạo Annotation `version = 1` kèm `initialComment`).
  - `POST /api/v1/annotations/:id/comments` (thêm comment và tăng `annotation.version` lên `+1`).
  - `PATCH /api/v1/annotations/:id` (kiểm tra OCC `expectedVersion`, trả `200`, `409 CONCURRENCY_CONFLICT`, hoặc `422`).
- **Cổng xác minh:** `npm run test:api`.

### `[A5]` Presigned Upload/Download URL (MinIO/S3) cho File `.glb` Dung lượng Tùy ý
- **Milestone:** `M2`
- **Mục tiêu:** Cung cấp `POST /api/v1/models/upload-url` và `POST /api/v1/models/:id/confirm` để trình duyệt tải file `.glb` trực tiếp lên S3/MinIO mà không đi qua RAM của API Server.
- **Yêu cầu kỹ thuật:** Giới hạn body của API Server ở mức `1MB` (trả `413 Payload Too Large` nếu client cố gửi binary `.glb` vào API).
- **Cổng xác minh:** Test kiểm chứng sinh Presigned URL và lưu `file_size`, `file_hash` (SHA-256).

### `[A6]` Server-Side Export / Import JSON với Kiểm tra `fileHash` & Báo lỗi Từng dòng
- **Milestone:** `M2`
- **Mục tiêu:** Hoàn thiện `exportModelAnnotations` và `importModelAnnotations` trong `AnnotationService`.
- **Yêu cầu kỹ thuật:**
  - Nếu `mode === 'STRICT'` và `payload.modelMeta.fileHash !== model.fileHash`, trả về `409 IMPORT_MODEL_HASH_MISMATCH` kèm `expectedFileHash` và `actualFileHash`.
  - Gọi `validateExportPayload(payload)` từ `@spriter/shared`. Nếu có bất kỳ phần tử nào lỗi, hủy toàn bộ giao dịch (rollback 100%) và trả về `422 IMPORT_VALIDATION_FAILED` kèm mảng `itemErrors[]`.
- **Cổng xác minh:** Pass Test #4 trong `apps/api/test/annotation-api.spec.ts`.

### `[A7]` Socket.io Realtime Gateway (`room = model:{id}`)
- **Milestone:** `M3`
- **Mục tiêu:** Cài đặt `RealtimePublisherPort` bằng Socket.io, xác thực token khi join room `model:{modelId}` và phát 4 sự kiện (`annotation:created`, `annotation:updated`, `annotation:deleted`, `comment:created`).
- **Yêu cầu kỹ thuật:** Chỉ phát sự kiện WebSocket **sau khi** giao dịch DB đã commit thành công; nếu xảy ra `409` hoặc `422`, tuyệt đối không phát sự kiện.
- **Cổng xác minh:** Pass kiểm tra `publishedEvents.length === 1` trong `apps/api/test/annotation-api.spec.ts`.

### `[A8]` Kiểm thử tải 984 Tác vụ Đồng thời (`p95 <= 2.5s`, `0 Lost Updates`)
- **Milestone:** `M4`
- **Mục tiêu:** Chạy kiểm thử tải với 984 tác vụ/người dùng đồng thời trên PostgreSQL thật (CI / Docker).
- **Cổng xác minh:** Độ trễ `p95 <= 2500ms`, `0 Lost Updates` (số bản ghi log `UPDATED` khớp tuyệt đối với `version - 1`).

### `[A9]` Tác vụ Tự động Dọn dẹp Operational Audit Log 7 Ngày
- **Milestone:** `M4`
- **Mục tiêu:** Thực thi `purgeExpiredOperationalLogs()` xóa mọi bản ghi có `expires_at <= NOW()`.
- **Cổng xác minh:** Pass bài test dịch đồng hồ giả lập (`FakeClock`) sang ngày thứ 8 trong `apps/api/test/annotation-api.spec.ts`.

### `[A10]` Telemetry & Cảnh báo Ngưỡng ADR-001 (`conflict_rate > 8%`)
- **Milestone:** `M4`
- **Mục tiêu:** Cung cấp chỉ số `conflict_rate = conflict_count / total_patch_count` từ bảng log 7 ngày để theo dõi ngưỡng xem xét lại kiến trúc theo ADR-001.
- **Cổng xác minh:** Unit test tính đúng tỷ lệ phần trăm xung đột từ tập log mẫu.
