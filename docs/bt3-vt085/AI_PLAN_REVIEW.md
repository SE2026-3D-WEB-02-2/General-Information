# VT-085 — Plan do AI lập và phần review của người làm

## 1. Prompt (gửi nguyên văn cho coding agent, chế độ plan-only, không sửa file)

Công cụ: Claude Code (model Claude Opus 5.5), sub-agent loại `Plan` (chỉ đọc repo), ngày 2026-11-16.

```text
You are a coding agent asked to plan (NOT implement) a change in the repository at
/Users/nekover2/Developments/Spriter ... Read AGENTS.md, docs/contracts/DATA_AND_EVENTS.md,
apps/api/AGENTS.md, packages/shared/AGENTS.md first, then the relevant source.

Change request (verbatim from the course): "Thêm cơ chế khôi phục thao tác vừa thực hiện (undo)
cho một hành động có rủi ro mất dữ liệu."
Risk focus: "dữ liệu biên hoặc rỗng vượt qua validation".
Mandatory test design technique: contract testing.

PART 1 — BEFORE any plan: explain the contracts and invariants that this change touches:
 (a) which existing action is the data-loss action you would target and why (cite file:line);
 (b) the current request/response contract of that action and of any contract the undo must add;
 (c) the invariants the undo must protect, most important first, enforced in code vs only implied.
PART 2 — Implementation plan: numbered assumptions; exact files to create/modify; new DTOs /
error codes / status codes; test plan per level and how contract testing is applied, which
boundary/empty inputs; persistence (Postgres adapter + migrations); risks of your own plan.
Cite line numbers. Do not write or edit any files. Keep the answer under ~900 words.
```

Ràng buộc VT-085 ("AI giải thích contract và invariants trước") được ép bằng cấu trúc PART 1 → PART 2.

## 2. Tóm tắt output của AI

**PART 1 — contract và invariant (AI giải thích trước):**
- Hành động mất dữ liệu: `AnnotationService.deleteAnnotation` (`annotation.service.ts:462-506`).
  Bản in-memory xoá bằng `dbStore.delete` (`in-memory.repository.ts:96`); bản Postgres chạy
  `DELETE FROM annotations` (`postgres.repository.ts:240`), cascade xoá comments (`0000_init.sql:48`).
- Delete không có kiểm tra version. Audit ghi sai nhãn `'UPDATED'` (`:488`). Reconnect không
  thấy được các lần xoá.
- Invariant xếp theo thứ tự: (1) tombstone đúng bằng bản ghi đã xoá, kể cả mọi comment;
  (2) version chỉ tăng; (3) token rỗng, trống, sai hoặc hết hạn thì không bao giờ restore;
  (4) quyền giống delete; (5) restore không ghi đè row đang sống; (6) dữ liệu khôi phục hợp lệ
  domain; (7) event chỉ phát sau commit.

**PART 2 — plan:**
- Cửa sổ 30 s, đọc qua `ClockPort`. Mỗi lần xoá chỉ undo được một lần. Restore phát lại
  `annotation:created`. Response của DELETE chỉ thêm trường.
- Shared: DTO, validator `validateRestoreAnnotationRequest(body: unknown)`, mã lỗi mới
  `UNDO_TOKEN_REQUIRED` / `UNDO_NOT_AVAILABLE` / `UNDO_TARGET_ID_REOCCUPIED` / `UNDO_WINDOW_EXPIRED`.
  Thêm cờ `restored?: true` vào `AnnotationCreatedEvent`. Fixture contract
  `packages/shared/fixtures/undo-delete-v1.json`.
- Port: thêm outcome `'DELETED' | 'RESTORED'`. **Thay** `deleteById` bằng
  `deleteToTombstone(...)`, thêm `restoreFromTombstone`. Token sinh bằng `crypto.randomUUID()`.
- **Migration mới** `0001_annotation_tombstones.sql`: bảng tombstone, drop rồi tạo lại
  `CHECK outcome` của audit log.
- Web: port, http adapter, fake, `pendingUndo` trong store, toast undo trong `CollaborationWorkspace.tsx`.
- Test: ghi thêm vào các file spec sẵn có (`shared-contracts.spec.ts`, `annotation-api.spec.ts`,
  `stream-c.spec.ts`). Fixture được replay ở cả provider và consumer. Biên thời gian 29.999 s và 30 s.

## 3. Review bằng repository thật

| # | Điểm trong plan AI | Quyết định | Evidence trong repo |
|---|---|---|---|
| R1 | Migration `0001_…sql` + đổi `CHECK outcome` của audit log | **Bác bỏ** cho slice này | Server chỉ wire `new InMemoryAnnotationRepository()` (`app-router.ts:54`); `server.ts` không có Postgres. CI chỉ áp `0000_init.sql` (`.github/workflows/ci.yml`). Đổi `CHECK` (`0000_init.sql:61-62`) là thay đổi schema chưa chạy ở đâu, vi phạm NFR3. Thay vào đó: tombstone đặt sau một port riêng `UndoTombstoneStorePort`, có adapter in-memory, giới hạn ghi rõ trong README. |
| R2 | Thay chữ ký `deleteById` → `deleteToTombstone` | **Sửa** | Đổi chữ ký sẽ làm hỏng cả hai adapter cùng lúc. Thay bằng method **thêm mới** `deleteIfVersion(id, expectedVersion, audit)`, mô phỏng `updateIfVersion` sẵn có (`ports.ts:66-71`); `deleteById` giữ nguyên. |
| R3 | Cờ `restored?: true` trên `annotation:created` | **Bác bỏ** | Consumer không cần cờ: `socket-realtime-adapter.ts:79-81` gọi `store.upsertSnapshot` với mọi `annotation:created`, còn `annotation-store.ts:49-57` đã chặn snapshot cũ bằng version. Thêm cờ chỉ làm phình contract. Được kiểm bằng consumer contract test (TC-13). |
| R4 | "Comment chen giữa lúc delete đọc và ghi → tombstone thiếu comment" | **Chấp nhận** (AI đúng) | `deleteAnnotation` có `await findById` (`:467`) rồi `await deleteById` (`:492`), không kiểm version giữa hai bước. `addComment` có thể commit ở giữa (`:310`). Thêm CAS delete và thử lại tối đa 3 lần. |
| R5 | Mã lỗi riêng `UNDO_TOKEN_REQUIRED` cho 400 | **Sửa** | `ApiErrorCode` đã có `VALIDATION_FAILED` (`api-contracts.ts:156`), các route 400 khác cũng dùng mã này. Dùng lại để contract 400 thống nhất. |
| R6 | Toast undo trong `CollaborationWorkspace.tsx`, `pendingUndo` trong store | **Hoãn** | Thuộc Stream C (`AGENTS.md` §2, `.github/CODEOWNERS`: `/apps/web/src/features/** @soshyz27`). Repo không có hạ tầng test trình duyệt (`package.json` chỉ có `node --test`). Slice chỉ thêm method consumer trong `http-annotation-api.ts`, gắn cờ cần Stream C review. |
| R7 | Token `crypto.randomUUID()` | **Sửa nhỏ** | UUID v4 chỉ có 122 bit ngẫu nhiên và có gạch nối. Dùng `randomBytes(16).toString('hex')` (128 bit, 32 hex). Validator thuần đặt ở shared; shared không được import `node:crypto` (luật R1, `scripts/arch-check.mjs:70-78`). |
| R8 | Test "updatedCount không đổi sau delete" (sửa nhãn audit) | **Hoãn**, ghi vào debt | Sửa nhãn `'UPDATED'` → `'DELETED'` cần đổi `CHECK` (xem R1). Ghi nhận là technical debt, không làm trong slice. |

Kết quả: chấp nhận 1 điểm (R4), sửa 3 điểm (R2, R5, R7), bác bỏ 2 điểm (R1, R3), hoãn 2 điểm (R6, R8).
