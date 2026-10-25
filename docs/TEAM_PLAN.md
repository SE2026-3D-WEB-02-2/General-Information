# Kế hoạch Phân công 3 Thành viên & Cổng Xác minh (Team Plan & Verification Gates)

> Tài liệu này quy định phân vùng sở hữu code, danh sách 27 Tasks chia theo 4 Milestones (`M1–M4`) và các Cổng Xác minh (`G0–G4`) cho đội ngũ 3 người (cùng AI Agent của từng người).
> - Hợp đồng dữ liệu & sự kiện chi tiết: Xem [DATA_AND_EVENTS.md](file:///Users/nekover2/Developments/Spriter/docs/contracts/DATA_AND_EVENTS.md).
> - Hồ sơ chi tiết từng luồng cho AI Agent:
>   - **Luồng A (Tech Lead / Backend & Realtime):** [STREAM_A_BACKEND.md](file:///Users/nekover2/Developments/Spriter/docs/tasks/STREAM_A_BACKEND.md)
>   - **Luồng B (3D Viewport & Raycast):** [STREAM_B_3D_VIEWPORT.md](file:///Users/nekover2/Developments/Spriter/docs/tasks/STREAM_B_3D_VIEWPORT.md)
>   - **Luồng C (Collaboration UI & Store):** [STREAM_C_COLLAB_UI.md](file:///Users/nekover2/Developments/Spriter/docs/tasks/STREAM_C_COLLAB_UI.md)

---

## 1. Phân vùng Sở hữu Code (CODEOWNERS & Agent Scope)

| Mã Luồng | Vai trò | Vùng được phép sửa (Write Scope) | Vùng CẤM tự ý sửa (Read-Only) | Hồ sơ Task cho Agent |
| :--- | :--- | :--- | :--- | :--- |
| **Stream A** | **Tech Lead — Backend, Realtime, Hạ tầng** | `apps/api/**`, `infra/**`, `scripts/**`, `.github/**`, `apps/web/src/app/**` | `apps/web/src/viewport/**`, `apps/web/src/features/**` | `docs/tasks/STREAM_A_BACKEND.md` |
| **Stream B** | **3D Viewport Owner** | `apps/web/src/viewport/**` (trừ chữ ký `bridge.ts`) | `apps/api/**`, `apps/web/src/features/**`, `packages/shared/**` | `docs/tasks/STREAM_B_3D_VIEWPORT.md` |
| **Stream C** | **Collaboration UI & State Owner** | `apps/web/src/features/**`, `apps/web/src/adapters/**` | `apps/api/**`, `apps/web/src/viewport/**`, `packages/shared/**` | `docs/tasks/STREAM_C_COLLAB_UI.md` |
| **Shared** | **Hợp đồng dùng chung** | `packages/shared/**`, `apps/web/src/viewport/bridge.ts` | Bắt buộc **≥ 2 thành viên duyệt** + tăng `CONTRACT_VERSION` | `docs/contracts/DATA_AND_EVENTS.md` |

---

## 2. Definition of Done chung cho cả Người & AI Agent (D1–D6)

Trước khi tạo Pull Request hoặc đóng bất kỳ Issue nào trên GitHub, thành viên và AI Agent bắt buộc chạy lệnh `npm run verify` vượt qua tất cả các cổng sau:
1. **D1 (Scope Check):** Chỉ sửa các file nằm trong Write Scope của Stream mình (`git status --short`).
2. **D2 (Architecture Boundary Check):** `npm run arch:check` báo `PASS` (không vi phạm 6 luật kiến trúc `R1–R6`).
3. **D3 (Single Source of Business Rules):** Không viết lặp điều kiện chuyển trạng thái hay kiểm tra pháp tuyến bên ngoài `@spriter/shared`.
4. **D4 (Contract Compliance):** Mọi payload API, WebSocket, Export/Import và Raycast đều tuân thủ đúng kiểu trong `@spriter/shared`.
5. **D5 (Automated Tests):** `npm test` chạy xanh toàn bộ các bài test của `shared`, `api`, và `web`.
6. **D6 (One-Command Verification):** `npm run verify` trả về exit code `0`.

---

## 3. Tổng hợp 27 Issues theo 4 Milestones trên GitHub

### Milestone 1: `M1 - Single-Player 3D, Domain Contracts & OCC Core`
- **`[A1]`** Database Schema & Migration (`users`, `models`, `annotations[version]`, `comments`, `operational_audit_logs[expires_at]`).
- **`[A2]`** PostgreSQL / Transactional OCC Repository (`updateIfVersion` CAS + 7-day Audit Log).
- **`[B1]`** Load `.glb` & Chuẩn hóa khung nhìn theo `BoundingBox` (giữ nguyên đỉnh Mesh gốc).
- **`[B2]`** Raycast trên bề mặt Mesh $\rightarrow$ phát `SurfacePick` (Model-Local Space) qua `ViewportBridge`.
- **`[B3]`** Hiển thị 3D Pin Markers (đẩy theo vector pháp tuyến $\vec{P} + \vec{n}\cdot\epsilon$ & làm mờ khi khuất).
- **`[B4]`** Điều khiển `CameraControls.setLookAt` bay mượt về `cameraState` khi nhận `focusCamera`.
- **`[C1]`** Sidebar danh sách Annotation + Bộ lọc trạng thái kết nối `AnnotationWorkspaceStore`.
- **`[C2]`** Luồng đặt Pin mới: nhận `onSurfacePicked` $\rightarrow$ mở form nhập `initialComment` $\rightarrow$ lưu qua `AnnotationApiPort`.
- **`[C3]`** Khung Comment Thread & Nút chuyển trạng thái ủy quyền cho `evaluateAnnotationMutation`.
- **`[C4]`** Tính năng Export / Import file `.json` (`ExportFileV1`) kèm cảnh báo lệch `fileHash`.

### Milestone 2: `M2 - Auth, Presigned 3D Upload & Persistent REST API`
- **`[A3]`** Xác thực Email/Password + JWT Session & phân quyền thao tác (`canActorModifyAnnotation`).
- **`[A4]`** Hoàn thiện REST Endpoints: Phân trang danh sách, Tạo Annotation, Thêm Comment (`version + 1`), Patch OCC (`200/409/422`).
- **`[A5]`** API cấp Presigned PUT/GET URL (MinIO/S3) cho file `.glb` dung lượng tùy ý + giới hạn body API `1MB`.
- **`[A6]`** API Import/Export phía Server: kiểm tra `IMPORT_MODEL_HASH_MISMATCH` (`409`) và báo lỗi từng dòng `itemErrors[]` (`422`).
- **`[B5]`** Tải model `.glb` từ Presigned URL kèm thanh tiến độ, bộ giải nén Draco/Meshopt và xử lý lỗi hết hạn URL.
- **`[C5]`** Giao diện Login/Register & kết nối `HttpAnnotationApi` thật.
- **`[C6]`** Modal Upload file `.glb` trực tiếp lên Object Storage qua Presigned URL.

### Milestone 3: `M3 - Realtime Socket.io Sync & 409 Conflict Resolution`
- **`[A7]`** Socket.io Gateway (`room = model:{id}`): xác thực handshake, chỉ phát sự kiện sau khi DB commit thành công.
- **`[B6]`** Cập nhật danh sách 3D Pins theo thời gian thực từ Store mà không làm giật góc nhìn Camera.
- **`[B7]`** Khóa thao tác kéo/di chuyển Pin 3D khi Annotation đang ở trạng thái `RESOLVED` hoặc `ARCHIVED`.
- **`[C7]`** `SocketRealtimeAdapter` tích hợp `classifyRealtimeVersionStep`: chặn gói tin cũ và tự tải bù khi phát hiện hụt version (`APPLY_AND_FETCH_GAP`).
- **`[C8]`** Giao diện xử lý xung đột `409 Conflict`: giữ bản nháp, hiển thị `serverSnapshot` và cho phép `Accept Server` hoặc `Retry on Latest`.

### Milestone 4: `M4 - 984-Task Load Verification, 7-Day Log Purge & Polish`
- **`[A8]`** Kiểm thử tải 984 tác vụ/người dùng đồng thời trên PostgreSQL thật (`p95 <= 2.5s`, `0 Lost Updates`).
- **`[A9]`** Worker/Job tự động xóa các bản ghi `operational_audit_logs` đã quá hạn 7 ngày (`expires_at < NOW()`).
- **`[A10]`** Endpoint `/metrics` giám sát tỷ lệ xung đột `conflict_rate` (ngưỡng cảnh báo ADR-001 `> 8%`) và độ trễ `p95`.
- **`[B8]`** Tối ưu hiệu năng hiển thị 3D (Instancing / Frustum & Occlusion Culling) cho 200–500 Pins.
- **`[C9]`** Hoàn thiện Accessibility (a11y), phím tắt điều hướng nhanh và trạng thái Empty/Loading/Error.
