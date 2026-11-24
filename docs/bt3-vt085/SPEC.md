# VT-085 — Undo xoá annotation (spec)

Sinh viên: Hồ Quang Chung (22001549) · Nhóm SE2026-T22 · Đề tài 3D-WEB-02
Baseline: `master@2048a93` · Nhánh: `individual/vt-085-undo-delete`

## Problem statement

`DELETE /api/v1/annotations/:id` đang xoá cứng: bản in-memory gọi `dbStore.delete(id)`
(`in-memory.repository.ts:96`), bản Postgres chạy `DELETE FROM annotations` và bảng `comments`
có `ON DELETE CASCADE` (`0000_init.sql:48`). Một lần bấm nhầm làm mất vĩnh viễn pin, góc camera
và toàn bộ thread thảo luận. Không có cách khôi phục. Cần một cơ chế undo trong cửa sổ ngắn sau
khi xoá. Bản khôi phục phải giống hệt bản đã xoá. Dữ liệu rỗng hoặc ở biên không được lọt qua
validation để tạo ra một bản khôi phục sai hay một lần "khôi phục thành công" rỗng.

## Acceptance criteria

| ID | Tiêu chí |
|----|----------|
| AC1 | `DELETE` thành công trả `200 { deletedId, undoToken, undoExpiresAt }`. `undoToken` là 32 ký tự hex thường. `undoExpiresAt = thời điểm xoá + 30 s` (ISO-8601). `deletedId` giữ nguyên nên client cũ không vỡ. |
| AC2 | `POST /api/v1/annotations/:id/restore { undoToken }` hợp lệ, gửi trước `undoExpiresAt`, bởi chính người xoá hoặc `PROJECT_LEAD`, trả `200` và snapshot giống hệt lúc xoá (id, modelId, authorId, status, position, normal, cameraState, meshName, comments đúng thứ tự, createdAt). `version` bằng version lúc xoá cộng 1. Server phát `annotation:created`. |
| AC3 | Body thiếu, `null`, mảng; `undoToken` thiếu, `""`, chỉ có khoảng trắng, không phải string, sai định dạng: trả `400 VALIDATION_FAILED`, không đổi state, tombstone vẫn dùng được với token đúng. |
| AC4 | Undo dùng được đúng một lần và chỉ trong cửa sổ. Lúc `now >= undoExpiresAt` trả `410 UNDO_WINDOW_EXPIRED`. Token sai hoặc đã dùng trả `404 UNDO_NOT_AVAILABLE`. Reviewer khác (không phải người xoá) trả `403 FORBIDDEN_OPERATION`. |
| AC5 | Đường lỗi: id đã bị chiếm lại (vd. qua import) trả `409 RESTORE_ID_CONFLICT`, không ghi đè. Repository ném lỗi khi ghi lại trả `503 RESTORE_FAILED`, không trả snapshot mặc định, tombstone được giữ để thử lại. |

## Non-functional constraints

- NFR1 (hiệu năng): 80 tác vụ đồng thời (delete + restore), p95 mỗi request ≤ 2.5 s.
- NFR2 (đồng thời): 80 lệnh restore đồng thời với cùng token thì đúng 1 lệnh thành công.
- NFR3 (tương thích): không đổi schema Postgres hay `CHECK` của audit log trong slice này.
  Response của DELETE chỉ thêm trường. `npm run verify` (R1–R6) vẫn xanh.
- NFR4 (bảo mật): token ngẫu nhiên 128 bit (`node:crypto`). Sự kiện realtime
  `annotation:deleted` không chứa `undoToken`.

## Invariant / contract quan trọng nhất

> **Restore-or-explicit-error.** Một lần restore chỉ có hai kết cục. Một là trả đúng bản ghi lúc
> xoá (mọi trường nghiệp vụ deep-equal, `version` +1). Hai là trả lỗi tường minh mà không đổi
> state. Không bao giờ có "thành công" với dữ liệu mặc định hoặc rỗng. Mỗi tombstone khôi phục
> tối đa một lần.
