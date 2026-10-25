# Chuẩn Hợp đồng Dữ liệu, API, Viewport Bridge & Realtime (Data & Events Contract v1.1)

> Tài liệu này khóa cứng **5 điểm giao cắt kỹ thuật cốt lõi** giữa **Luồng A (Backend/Realtime)**, **Luồng B (3D Viewport)** và **Luồng C (Collaboration UI & Store)**. Mọi kiểu dữ liệu dưới đây đã được cài đặt sẵn trong gói `@spriter/shared` (`packages/shared/src/index.ts`).

---

## 1. Thống nhất Kiểu dữ liệu `@spriter/shared` & Ma trận Chuyển trạng thái

### 1.1. Đồng nhất tên trường giữa REST API, Store và JSON Export/Import
Trước đây trong bản phác thảo sơ bộ, JSON Export bọc tọa độ trong `spatial: { position, normal, cameraState }` trong khi API dùng trường phẳng. Từ phiên bản `v1.1`, **cả REST API, WebSocket, Zustand Store và file Export/Import JSON (`ExportFileV1`) đều dùng chung một cấu trúc phẳng `AnnotationDomainSnapshot`**:

```typescript
export interface AnnotationDomainSnapshot {
  id: string;
  modelId: string;
  authorId: string;
  authorName?: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'ARCHIVED';
  version: number; // Khởi tạo = 1, tăng đơn điệu (+1) sau mỗi lần cập nhật hoặc thêm comment
  position: [number, number, number]; // Tọa độ trong Model-Local Space
  normal: [number, number, number];   // Vector pháp tuyến đơn vị (|length - 1.0| <= 0.01)
  cameraState: {
    position: [number, number, number];
    target: [number, number, number];
  };
  meshName?: string;
  comments: Array<{
    id: string;
    authorId: string;
    authorName?: string;
    content: string;
    createdAt: string;
  }>;
  createdAt?: string;
  updatedAt: string;
}
```

### 1.2. Ma trận chuyển trạng thái chính xác (`ALLOWED_TRANSITIONS`)
| Trạng thái hiện tại (`current.status`) | Các trạng thái đích được phép (`patch.status`) | Ràng buộc bất biến (Invariants) |
| :--- | :--- | :--- |
| **`OPEN`** | `IN_PROGRESS`, `RESOLVED` | Muốn sang `RESOLVED` phải thỏa điều kiện Comment giải trình bên dưới. |
| **`IN_PROGRESS`** | `OPEN`, `RESOLVED` | Muốn sang `RESOLVED` phải thỏa điều kiện Comment giải trình bên dưới. |
| **`RESOLVED`** | `IN_PROGRESS`, `ARCHIVED` | **Khóa tọa độ 3D (`SPATIAL_LOCKED_WHEN_RESOLVED`):** Không được sửa `position`/`normal` khi đang `RESOLVED` trừ khi đồng thời chuyển `status` về `IN_PROGRESS`. Chỉ tác giả hoặc `PROJECT_LEAD` mới được chuyển sang `ARCHIVED`. |
| **`ARCHIVED`** | `[]` *(Không được chuyển đi đâu)* | **Bất biến hoàn toàn (`ANNOTATION_ARCHIVED_IMMUTABLE`):** Cấm sửa trạng thái, cấm sửa tọa độ, cấm thêm comment mới. |

### 1.3. Quy tắc Comment khi chuyển sang `RESOLVED` (Đã đồng bộ Tài liệu & Code)
* **Quy tắc thống nhất:** Trong mảng `current.comments` phải có **ít nhất một (01) comment** có độ dài sau khi cắt khoảng trắng $\ge 10$ ký tự:
  ```typescript
  const hasValidExplanation = current.comments.some(
    (comment) => comment.content.trim().length >= MIN_RESOLUTION_COMMENT_LENGTH // 10
  );
  ```
* *Lý do:* Nếu người A đã viết comment giải trình dài 50 ký tự, sau đó người B vào trả lời ngắn gọn `"OK!"` (3 ký tự) ở cuối Thread, Annotation đó **vẫn hoàn toàn hợp lệ** để chuyển sang `RESOLVED`.

---

## 2. Hợp đồng REST API, Phân trang, Định dạng Lỗi & Quyền thao tác

| Endpoint | Method | Request Query / Body | Response Thành công | Quyền thao tác (RBAC) |
| :--- | :--- | :--- | :--- | :--- |
| `/api/v1/auth/login` | `POST` | `LoginRequestDto { email, password }` | `200 OK`: `AuthSessionResponseDto { user, accessToken, expiresInSeconds }` | Public |
| `/api/v1/models/:modelId/annotations` | `GET` | `ListAnnotationsQueryDto { status?, cursor?, limit=50, updatedAfter? }` | `200 OK`: `PaginatedAnnotationsResponseDto { items, nextCursor, totalCount, serverTime }` | Authenticated (`REVIEWER`, `PROJECT_LEAD`) |
| `/api/v1/models/:modelId/annotations` | `POST` | `CreateAnnotationRequestDto { position, normal, cameraState, meshName?, initialComment }` | `201 Created`: `AnnotationDomainSnapshot` (`version = 1`, kèm comment đầu tiên) | Authenticated |
| `/api/v1/annotations/:id/comments` | `POST` | `CreateCommentRequestDto { content }` | `201 Created`: `AnnotationDomainSnapshot` (tự động tăng `version = version + 1`) | Authenticated (trừ khi `ARCHIVED`) |
| `/api/v1/annotations/:id` | `PATCH` | `PatchAnnotationRequestDto { expectedVersion, status?, position?, normal?, cameraState? }` | `200 OK`: `AnnotationDomainSnapshot` (`version = expectedVersion + 1`) | Authenticated (`ARCHIVED` chỉ dành cho Author hoặc `PROJECT_LEAD`) |
| `/api/v1/models/:modelId/export` | `GET` | — | `200 OK`: `ExportFileV1` | Authenticated |
| `/api/v1/models/:modelId/import` | `POST` | `ImportAnnotationsRequestDto { mode?: 'STRICT' \| 'FORCE_HASH_MISMATCH', payload: ExportFileV1 }` | `201 Created`: `ImportAnnotationsResponseDto { importedCount, annotations }` | Authenticated |

### Định dạng Lỗi Thống nhất (`ApiErrorEnvelope`)
Mọi phản hồi lỗi (`400`, `401`, `403`, `404`, `409`, `422`) đều tuân theo cấu trúc `ApiErrorEnvelope` trong `packages/shared/src/contracts/api-contracts.ts`:
* **Khi xung đột phiên bản (`409 CONCURRENCY_CONFLICT`):**
  ```json
  {
    "errorCode": "CONCURRENCY_CONFLICT",
    "message": "Annotation was modified by another user. Inspect serverSnapshot before retrying.",
    "currentVersion": 3,
    "serverSnapshot": { "id": "ann-101", "version": 3, "status": "RESOLVED", "..." : "..." }
  }
  ```
* **Khi lệch mã băm file 3D lúc Import (`409 IMPORT_MODEL_HASH_MISMATCH`):**
  ```json
  {
    "errorCode": "IMPORT_MODEL_HASH_MISMATCH",
    "message": "Export fileHash does not match target 3D model fileHash.",
    "expectedFileHash": "e3b0c442...",
    "actualFileHash": "9999aaaa..."
  }
  ```
* **Khi có phần tử trong file Import vi phạm Invariant (`422 IMPORT_VALIDATION_FAILED`):**
  ```json
  {
    "errorCode": "IMPORT_VALIDATION_FAILED",
    "message": "1 annotation(s) failed domain invariant checks. Import rolled back.",
    "itemErrors": [
      {
        "index": 0,
        "annotationId": "ann-invalid-1",
        "reasonCode": "MISSING_RESOLUTION_COMMENT",
        "message": "Resolving an annotation requires at least 1 comment in the thread with >= 10 characters."
      }
    ]
  }
  ```

---

## 3. Giao diện Trao đổi với 3D Viewer (`ViewportBridge`) & Quyền sở hữu Store

* **Ai sở hữu Store?**
  * Lớp `AnnotationWorkspaceStore` đặt tại `apps/web/src/app/annotation-store.ts` (thuộc tầng Application Composition).
  * **Luồng B (3D Viewport)** KHÔNG truy cập trực tiếp vào Store hay gọi API; Luồng B chỉ cài đặt và giao tiếp qua giao diện `ViewportBridge` (`apps/web/src/viewport/bridge.ts`).
* **Luồng sự kiện 2 chiều qua `ViewportBridge`:**
  1. **Đặt Pin mới (Raycast Pick):**
     * UI (Luồng C) bật chế độ đặt Pin: gọi `bridge.setPlacementMode(true)`.
     * Người dùng click lên bề mặt Mesh 3D $\rightarrow$ Luồng B tính tọa độ trong **Model-Local Space** và phát sự kiện `onSurfacePicked(pick: SurfacePick)`.
     * Store tự động lưu `pendingPick = pick`, tắt `setPlacementMode(false)`, và UI (Luồng C) mở form nhập `initialComment`.
  2. **Chọn Pin từ 3D Canvas vs. Chọn từ 2D Sidebar:**
     * Khi người dùng **click vào Pin 3D trên Canvas**: Luồng B phát `onPinSelected(annotationId)` $\rightarrow$ Store gọi `selectAnnotation(annotationId, /* focusCamera = */ false)` để làm nổi bật Pin và mở Thread ở Sidebar (không cần bay lại camera vì người dùng đang nhìn trực tiếp vào Pin đó).
     * Khi người dùng **click vào một dòng trên Sidebar 2D**: UI (Luồng C) gọi `store.selectAnnotation(annotationId, /* focusCamera = */ true)` $\rightarrow$ Store gọi `bridge.focusCamera(annotation.cameraState, annotationId)` $\rightarrow$ Luồng B gọi `CameraControls.setLookAt(cx, cy, cz, tx, ty, tz, true)` để bay camera mượt về góc nhìn của tác giả.

---

## 4. Hợp đồng Socket.io Realtime, Vào Room & Tải bù Sự kiện Đã lỡ (Catch-up Sync)

1. **Xác thực & Vào Room:**
   * Handshake: `io(URL, { auth: { token: accessToken } })`.
   * Sau khi kết nối, Client gửi `socket.emit('room:join', { modelId, knownVersions }, (ack: RoomJoinAck) => ...)`. Server kiểm tra quyền truy cập model và cho socket vào room `model:${modelId}`.
2. **4 Sự kiện Realtime từ Server (`ServerRealtimeEvent`):**
   * `annotation:created`: `{ type, eventId, modelId, emittedAt, annotation }` (`version = 1`)
   * `annotation:updated`: `{ type, eventId, modelId, emittedAt, previousVersion, annotation }`
   * `annotation:deleted`: `{ type, eventId, modelId, emittedAt, annotationId }`
   * `comment:created`: `{ type, eventId, modelId, emittedAt, annotationId, previousVersion, annotationVersion, comment }`
3. **Phát hiện Rớt gói tin (Gap Detection) & Tải bù khi Reconnect:**
   * Khi nhận sự kiện `annotation:updated` hoặc `comment:created`, Store gọi hàm `classifyRealtimeVersionStep(localVersion, previousVersion, incomingVersion)` (trong `@spriter/shared`):
     * Nếu `incomingVersion <= localVersion` $\rightarrow$ `'IGNORE_STALE'` (bỏ qua gói tin cũ đến trễ).
     * Nếu `previousVersion === localVersion` $\rightarrow$ `'APPLY'` (liền mạch, cập nhật ngay).
     * Nếu `previousVersion > localVersion` $\rightarrow$ `'APPLY_AND_FETCH_GAP'` (áp dụng ngay bản chụp mới nhất của annotation đó VÀ bật cờ `needsCatchUpFetch = true` để gọi `GET /api/v1/models/:modelId/annotations?updatedAfter=<lastSyncIso>` tải bù các thay đổi bị lỡ trong lúc rớt mạng).

---

## 5. Chính sách Xử lý Xung đột `409 Conflict` & Báo lỗi Import

1. **Xử lý xung đột `409 Conflict` (Xem bản mới của Server & Áp dụng lại có kiểm soát — KHÔNG tự gộp trường ngầm):**
   * *Tại sao không tự động gộp từng trường (auto field-level merge)?* Vì trong nghiệp vụ 3D Review, các trường có ràng buộc chéo với nhau (ví dụ: người A vừa chuyển `status` sang `RESOLVED` ở `v3`, trong khi người B đang sửa `position` dựa trên `v2`; nếu gộp tự động sẽ tạo ra bản ghi `RESOLVED` nhưng bị đổi tọa độ — vi phạm trực tiếp Invariant `SPATIAL_LOCKED_WHEN_RESOLVED`!).
   * *Cơ chế chuẩn trong `AnnotationThreadPanelController` và `AnnotationWorkspaceStore`:*
     * Khi nhận `409 Conflict`, Controller giữ nguyên ý định thay đổi của người dùng (`pendingStatusAttempt`) và lưu `conflictSnapshot = result.serverSnapshot`.
     * Giao diện hiển thị rõ trạng thái mới nhất trên Server (`conflictSnapshot`) cùng 2 lựa chọn:
       1. **Chấp nhận bản của Server (`acceptServerConflictSnapshot`):** Giữ bản `serverSnapshot` và hủy thao tác vừa bấm.
       2. **Thử áp dụng lại trên phiên bản mới nhất (`retryPendingStatusOnLatestVersion`):** Kiểm tra lại `evaluateAnnotationMutation(conflictSnapshot, pendingPatch)`; nếu vẫn hợp lệ với Invariant thì tự động gửi `PATCH` mới với `expectedVersion = conflictSnapshot.version`.
2. **Xử lý lỗi Import (`fileHash` & từng Annotation):**
   * Bước 1 (`fileHash`): Mặc định gửi `mode: 'STRICT'`. Nếu lệch mã băm SHA-256 của file `.glb`, Server trả về `409 IMPORT_MODEL_HASH_MISMATCH` kèm `expectedFileHash` và `actualFileHash`. Nếu người dùng xác nhận trên UI muốn nạp cưỡng bức, Client gửi lại với `mode: 'FORCE_HASH_MISMATCH'`.
   * Bước 2 (All-or-Nothing Per-Item Validation): Server chạy `validateExportPayload(payload)`. Nếu có bất kỳ Annotation nào lỗi, toàn bộ lệnh Import bị hủy (không lưu bản ghi nào) và trả về `422 IMPORT_VALIDATION_FAILED` kèm danh sách `itemErrors: [{ index, annotationId, reasonCode, message }]` để UI chỉ rõ dòng nào trong file JSON bị lỗi.
