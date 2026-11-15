# BT3 · VT-085 — Undo xoá annotation (Spec → Test → AI change → Verify → Review)

Hồ Quang Chung (22001549) · SE2026-T22 · 3D-WEB-02. **Bài cá nhân. Không merge khi nhóm chưa review.**

| | |
|---|---|
| Baseline | `master@2048a93` (27/27 test xanh, xem `evidence/00-baseline-verify.log`) |
| Nhánh nộp | `individual/vt-085-undo-delete` |
| Nhánh mutation (tạm, không merge) | `experiment/vt-085-mutation` |
| Spec | [`SPEC.md`](SPEC.md): problem statement, AC1–AC5, NFR1–NFR4, invariant |
| Plan AI + review | [`AI_PLAN_REVIEW.md`](AI_PLAN_REVIEW.md) |

## Chạy lại

Yêu cầu Node ≥ 22.18 (cần type-stripping; đã chạy trên Node 26.10). Không cần cài thêm package.

```bash
npm install
npm run test:vt085        # 77 test VT-085: shared unit + provider contract + consumer contract
npm run verify            # cổng của repo: arch-check R1–R6 + toàn bộ 104 test
npm run test:load:vt085   # 80 user đồng thời trên HTTP server thật, kiểm p95 ≤ 2500 ms
bash docs/bt3-vt085/flaky-check.sh   # thứ tự ngẫu nhiên, múi giờ, lặp race, token ngẫu nhiên
# coverage:
node --test --experimental-test-coverage \
  --test-coverage-include='packages/shared/src/contracts/undo-contracts.ts' \
  --test-coverage-include='apps/api/src/modules/annotations/**' \
  --test-coverage-include='apps/web/src/adapters/http-annotation-api.ts' \
  packages/shared/test/*.spec.ts apps/api/test/*.spec.ts apps/web/test/*.spec.ts
```

## Contract testing áp dụng thế nào

Có một nguồn sự thật duy nhất là `packages/shared/fixtures/undo-delete.contract.json`, gồm 20 interaction
(C01–C20), mỗi cái có `given`, request, status, `errorCode` và ví dụ response.

- **Provider** (`apps/api/test/vt085-undo-delete.provider.spec.ts`) replay từng interaction qua
  `SpriterApiApplication.handleRequest` với đồng hồ giả.
- **Consumer** (`apps/web/test/vt085-undo-delete.consumer.spec.ts`) dùng *cùng* các ví dụ đó để
  điều khiển `HttpAnnotationApi` qua một `fetch` giả. Consumer test kiểm cả phía request (method,
  path, body `{undoToken}`) lẫn cách map status thành kết quả.
- **Shared** (`packages/shared/test/vt085-undo-contract.spec.ts`) kiểm parser, biên cửa sổ thời gian
  và hàm `checkDeleteAnnotationResponse` mà consumer dùng lúc runtime.

## Lịch sử commit (test-first)

| Commit | Nội dung | Kết quả |
|---|---|---|
| `72416d2` | fixture + test (RED) | 53 test: 50 fail đúng lý do (`evidence/01-red-tests.log`) |
| `8544dd9` | patch: shared contract, tombstone, restore route, CAS delete, consumer | 76/76 + verify 103/103 (`evidence/02-green-tests.log`) |
| `df58238` | TC-TOMB, thêm sau khi mutant M4 sống sót | 104/104 |
| HEAD | harness tải, flaky check, README | `evidence/03…05` |

## Mutation "nuốt exception, trả dữ liệu mặc định"

Script `evidence/mutation/mutate.py`. Mỗi mutant là một commit trên `experiment/vt-085-mutation`,
được revert ngay sau khi chạy. Tip của nhánh mutation trùng code với nhánh nộp.

| Mutant | Vị trí | Lần 1 (suite gốc) | Lần 2 (+TC-TOMB) | Test giết |
|---|---|---|---|---|
| M1 | `restoreAnnotation`: catch → `OK` + snapshot chưa lưu | killed | killed | C20 |
| M2 | `restoreAnnotation`: catch → `OK` + annotation mặc định (OPEN v1, 0 comment) | killed | killed | C20 |
| M3 | `HttpAnnotationApi.restoreAnnotation`: catch → `ok:true` + snapshot mặc định | killed | killed | 17 consumer test |
| M4 | `deleteAnnotation`: nuốt lỗi lưu tombstone, vẫn trả token | **survived** | killed | TC-TOMB (mới) |
| M5 (phụ) | bỏ compare-and-delete | — | killed | TC-CAS |

## Giới hạn đã biết

- Tombstone chỉ lưu trong RAM (`InMemoryUndoTombstoneStore`). Restart hoặc chạy nhiều instance thì
  mất khả năng undo. Hiện server cũng chỉ wire repo in-memory (`app-router.ts:54`).
- `PostgresAnnotationRepository.deleteIfVersion` đã viết nhưng chưa có test nào chạy qua.
- Audit của delete vẫn ghi `'UPDATED'` (nợ cũ, cần đổi `CHECK` ở `0000_init.sql:62`).
- Không có bước type-check (repo không có `tsc`). Chất lượng chỉ được bảo đảm bằng test + arch-check.
- Chưa làm UI (toast undo): thuộc Stream C, cần review từ @soshyz27.
