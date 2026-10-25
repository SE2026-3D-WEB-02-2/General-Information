# Hồ sơ Task Luồng B: 3D glTF Viewport & Raycast (Viewport Owner Stream)

> **Dành cho AI Agent của Thành viên B (3D Viewport Owner):**
> - **Write Scope (Được phép sửa):** `apps/web/src/viewport/**` (trừ việc thay đổi chữ ký của `bridge.ts`).
> - **Read-Only Contracts:** `packages/shared/**`, `apps/web/src/viewport/bridge.ts`, `docs/contracts/DATA_AND_EVENTS.md`.
> - **CẤM TUYỆT ĐỐI:** Không được import từ `apps/api/**` hoặc `apps/web/src/features/**`. Mọi giao tiếp với UI 2D và Store chỉ đi qua `ViewportBridge`.
> - **Lệnh kiểm chứng bắt buộc sau mỗi Task:** `npm run test:web && npm run verify`.

---

## Danh sách Task Chi tiết & Cổng Xác minh

### `[B1]` Load `.glb` & Chuẩn hóa Khung nhìn theo `BoundingBox` (Giữ nguyên Đỉnh Mesh Gốc)
- **Milestone:** `M1`
- **Mục tiêu:** Tải mô hình `.glb` vào R3F/Three.js Canvas và tự động căn chỉnh `camera.near`, `camera.far`, và khoảng cách nhìn của `CameraControls` dựa trên `BoundingBox`.
- **Ràng buộc bất biến:** **Tuyệt đối không gọi `geometry.center()` hay biến đổi tọa độ đỉnh của Mesh gốc**, để tọa độ `position` khi Export/Import luôn khớp 100% với file gốc.
- **Cổng xác minh:** Unit test hàm tính khung nhìn (`computeCameraFraming(boundingBox)`) với 3 kích thước model (`0.01m`, `1000m`, lệch tâm) và `npm run verify`.

### `[B2]` Raycast trên Bề mặt Mesh $\rightarrow$ Phát `SurfacePick` (Model-Local Space)
- **Milestone:** `M1`
- **Mục tiêu:** Khi `placementMode === true` và người dùng click lên bề mặt Mesh 3D, tính tọa độ điểm va chạm `position: [x,y,z]`, vector pháp tuyến đơn vị `normal: [nx,ny,nz]` (trong **Model-Local Space**), trạng thái `cameraState: { position, target }` và `meshName`, rồi phát qua `ViewportBridge.onSurfacePicked`.
- **Ràng buộc bất biến:** Vector `normal` bắt buộc phải được chuẩn hóa (`normalize()`) sao cho `validateUnitNormal(normal) === true` ($|\|\vec{n}\| - 1.0| \le 0.01$).
- **Cổng xác minh:** Kiểm tra đầu ra bằng `validateSurfacePick(pick)` từ `@spriter/shared` và `npm run verify`.

### `[B3]` Hiển thị 3D Pin Markers từ `ViewportBridge.setPins()` & Xử lý Che khuất (Occlusion)
- **Milestone:** `M1`
- **Mục tiêu:** Render danh sách `ViewportPinMarker[]` nhận từ `setPins(pins)`:
  - Đẩy vị trí hiển thị của Pin ra khỏi bề mặt một khoảng nhỏ theo vector pháp tuyến: $\vec{P}_{\text{display}} = \vec{P} + \vec{n} \cdot \epsilon$ để chống lún vào mesh (z-fighting).
  - Làm nổi bật Pin có `selected === true` và đổi màu theo `status` (`OPEN`, `IN_PROGRESS`, `RESOLVED`, `ARCHIVED`).
  - Khi người dùng click vào một Pin 3D, phát `onPinSelected(pin.id)`.
- **Cổng xác minh:** Unit test hàm tính tọa độ đẩy pháp tuyến và kiểm tra thông qua `FakeViewportBridge` trong `apps/web/test/web-boundary.spec.ts`.

### `[B4]` Bay Camera Mượt về Góc nhìn Tác giả (`focusCamera`)
- **Milestone:** `M1`
- **Mục tiêu:** Khi nhận lệnh `focusCamera(cameraState, annotationId)` từ `ViewportBridge`, gọi `cameraControls.setLookAt(cx, cy, cz, tx, ty, tz, true)` để đưa người xem về đúng góc nhìn lúc đặt Pin.
- **Cổng xác minh:** Unit test với mock `CameraControls` xác nhận đúng 6 tham số tọa độ và cờ `enableTransition = true`.

### `[B5]` Tải Model `.glb` Dung lượng Lớn từ Presigned URL + Giải nén Draco/Meshopt
- **Milestone:** `M2`
- **Mục tiêu:** Hỗ trợ tải file `.glb` từ Presigned GET URL của S3/MinIO, báo cáo phần trăm tiến độ tải (`0% -> 100%`), cấu hình bộ giải mã Draco/Meshopt và xử lý trạng thái lỗi khi URL hết hạn.
- **Cổng xác minh:** Unit test state machine tải model (`idle -> loading -> ready | error`).

### `[B6]` Cập nhật 3D Pins Thời gian thực mà Không làm Giật Camera
- **Milestone:** `M3`
- **Mục tiêu:** Khi `setPins()` được gọi liên tục do các sự kiện WebSocket từ người dùng khác, chỉ cập nhật các Pin thay đổi mà không reset vị trí đứng hiện tại của `CameraControls`.
- **Cổng xác minh:** `npm run verify`.

### `[B7]` Khóa Kéo/Di chuyển Pin 3D khi Annotation đã `RESOLVED` hoặc `ARCHIVED`
- **Milestone:** `M3`
- **Mục tiêu:** Trước khi cho phép người dùng kéo thả (drag) một Pin 3D sang vị trí mới trên bề mặt, gọi `evaluateAnnotationMutation` từ `@spriter/shared`. Nếu trạng thái là `RESOLVED` hoặc `ARCHIVED`, chặn thao tác kéo và trả về lý do `SPATIAL_LOCKED_WHEN_RESOLVED` / `ANNOTATION_ARCHIVED_IMMUTABLE`.
- **Cổng xác minh:** Unit test xác nhận chặn kéo thả khi `status === 'RESOLVED'`.

### `[B8]` Tối ưu Hiệu năng Render cho 200–500 Pins trên một Model
- **Milestone:** `M4`
- **Mục tiêu:** Tối ưu hóa việc cập nhật vị trí và kiểm tra che khuất (occlusion raycast throttling / instancing) để duy trì $\ge 30\text{ FPS}$ khi mô hình có tới 200–500 annotations.
- **Cổng xác minh:** `npm run verify`.
