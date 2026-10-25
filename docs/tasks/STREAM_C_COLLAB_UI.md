# Hồ sơ Task Luồng C: Collaboration UI, Store & Adapters (UI Owner Stream)

> **Dành cho AI Agent của Thành viên C (Collaboration UI & State Owner):**
> - **Write Scope (Được phép sửa):** `apps/web/src/features/**`, `apps/web/src/adapters/**` (và phối hợp với Tech Lead trên `apps/web/src/app/annotation-store.ts`).
> - **Read-Only Contracts:** `packages/shared/**`, `apps/web/src/viewport/bridge.ts`, `docs/contracts/DATA_AND_EVENTS.md`.
> - **CẤM TUYỆT ĐỐI:**
>   1. Không được import `three` hoặc `@react-three/*` vào `src/features/**` hay `src/adapters/**` (Luật `R5: no-three-in-features`).
>   2. Không được tự viết lặp điều kiện chuyển trạng thái hay độ dài comment — bắt buộc gọi `evaluateAnnotationMutation` từ `@spriter/shared` (Luật `R6`).
> - **Lệnh kiểm chứng bắt buộc sau mỗi Task:** `npm run test:web && npm run verify`.

---

## Danh sách Task Chi tiết & Cổng Xác minh

### `[C1]` Sidebar Danh sách Annotation & Bộ lọc Trạng thái Kết nối Store
- **Milestone:** `M1`
- **Mục tiêu:** Hiển thị danh sách Annotations từ `AnnotationWorkspaceStore`, hỗ trợ lọc theo trạng thái (`OPEN`, `IN_PROGRESS`, `RESOLVED`, `ARCHIVED`). Khi người dùng click vào một dòng trên Sidebar, gọi `store.selectAnnotation(id, true)` để làm nổi bật Pin và ra lệnh cho Camera 3D bay tới góc nhìn đó.
- **Cổng xác minh:** `npm run test:web` (kiểm chứng đồng bộ chọn dòng Sidebar $\rightarrow$ `bridge.focusCamera`).

### `[C2]` Luồng Đặt Pin Mới: Nhận `onSurfacePicked` $\rightarrow$ Nhập Comment Đầu tiên $\rightarrow$ Lưu
- **Milestone:** `M1`
- **Mục tiêu:** Khi người dùng bấm nút *"Thêm Annotation"*, bật `bridge.setPlacementMode(true)`. Khi nhận tọa độ `pendingPick` từ `ViewportBridge`, hiển thị khung nhập `initialComment` và gửi qua `AnnotationApiPort`.
- **Cổng xác minh:** Test mô phỏng qua `FakeViewportBridge.emitSurfacePick()` trong `apps/web/test/web-boundary.spec.ts`.

### `[C3]` Khung Comment Thread & Nút Chuyển Trạng thái Dùng `evaluateAnnotationMutation`
- **Milestone:** `M1`
- **Mục tiêu:** Trong `AnnotationThreadPanelController` (`apps/web/src/features/annotations/AnnotationThreadController.ts`), sử dụng `canTransitionStatus(targetStatus)` (ủy quyền 100% cho `evaluateAnnotationMutation` từ `@spriter/shared`) để bật/tắt các nút chuyển trạng thái và hiển thị tooltip giải thích lý do (`MISSING_RESOLUTION_COMMENT`, `ANNOTATION_ARCHIVED_IMMUTABLE`).
- **Cổng xác minh:** `npm run arch:check && npm run test:web`.

### `[C4]` Tính năng Export / Import File `.json` (`ExportFileV1`) & Cảnh báo Lệch `fileHash`
- **Milestone:** `M1`
- **Mục tiêu:**
  - Xuất danh sách annotations ra file `.json` đúng chuẩn `ExportFileV1`.
  - Khi Import file `.json`, kiểm tra bằng `validateExportPayload(payload)`. Nếu API trả về `409 IMPORT_MODEL_HASH_MISMATCH`, hiển thị hộp thoại cảnh báo người dùng và cho phép gửi lại với `mode: 'FORCE_HASH_MISMATCH'`. Nếu trả về `422 IMPORT_VALIDATION_FAILED`, hiển thị danh sách lỗi từng dòng từ `itemErrors[]`.
- **Cổng xác minh:** `npm run test:shared && npm run test:web`.

### `[C5]` Màn hình Login/Register & Adapter `HttpAnnotationApi`
- **Milestone:** `M2`
- **Mục tiêu:** Xây dựng form đăng nhập/đăng ký và cài đặt `HttpAnnotationApi` thực thi `AnnotationApiPort` gọi tới các endpoint REST `/api/v1/...` (luôn đính kèm `expectedVersion` khi `PATCH`).
- **Cổng xác minh:** Unit test `HttpAnnotationApi` với mock fetch kiểm chứng truyền đúng `expectedVersion` và bóc tách đúng `409` / `422`.

### `[C6]` Modal Upload File `.glb` Trực tiếp qua Presigned URL
- **Milestone:** `M2`
- **Mục tiêu:** Giao diện chọn file `.glb`, tính mã băm SHA-256 (`fileHash`), xin Presigned PUT URL từ API, tải thẳng lên S3/MinIO kèm thanh tiến độ (`0–100%`) và gọi API confirm.
- **Cổng xác minh:** Unit test luồng upload 3 bước (request URL $\rightarrow$ PUT binary $\rightarrow$ confirm).

### `[C7]` `SocketRealtimeAdapter` & Cơ chế Phát hiện Hụt Phiên bản (`APPLY_AND_FETCH_GAP`)
- **Milestone:** `M3`
- **Mục tiêu:** Lắng nghe 4 sự kiện Socket.io (`annotation:created`, `annotation:updated`, `annotation:deleted`, `comment:created`) và đẩy vào `AnnotationWorkspaceStore.handleRealtimeUpdate(previousVersion, snapshot)`.
- **Yêu cầu kỹ thuật:** Nếu hàm trả về `'IGNORE_STALE'`, bỏ qua gói tin cũ; nếu trả về `'APPLY_AND_FETCH_GAP'` (hoặc khi socket vừa `reconnect`), tự động gọi API lấy các bản ghi `updatedAfter` để đồng bộ bù.
- **Cổng xác minh:** Pass Test #1 & Test #2 trong `apps/web/test/web-boundary.spec.ts`.

### `[C8]` Giao diện Giải quyết Xung đột `409 Conflict` (Xem `serverSnapshot` & Thử lại trên Bản mới)
- **Milestone:** `M3`
- **Mục tiêu:** Khi `updateStatus` gặp lỗi `409 Conflict`, tuyệt đối không xóa mất thay đổi của người dùng mà hiển thị `conflictSnapshot` (trạng thái mới nhất trên Server) cùng 2 nút hành động:
  1. **Chấp nhận bản của Server (`acceptServerConflictSnapshot`)**
  2. **Thử áp dụng lại trên bản mới nhất (`retryPendingStatusOnLatestVersion`)** — tự động dùng `expectedVersion = conflictSnapshot.version`.
- **Cổng xác minh:** Pass kịch bản `retryPendingStatusOnLatestVersion()` (`v4 -> 409 v5 -> retry -> 200 v6`) trong `apps/web/test/web-boundary.spec.ts`.

### `[C9]` Hoàn thiện Trạng thái Loading / Empty / Error & Accessibility (a11y)
- **Milestone:** `M4`
- **Mục tiêu:** Đảm bảo toàn bộ các nút trạng thái, danh sách Sidebar và hộp thoại xung đột đều có nhãn `aria-label`, điều hướng được bằng bàn phím (`Tab` / `Enter` / `Escape`) và hiển thị rõ trạng thái Loading/Empty.
- **Cổng xác minh:** `npm run verify`.
