# Spriter — Multi-User 3D glTF Design Review & Realtime Annotation

Hệ thống review thiết kế 3D đa người dùng theo kiến trúc **Modular Monolith + Hexagonal Boundaries + Optimistic Concurrency Control (OCC)**, được thiết kế **AI-Agent-First** cho đội ngũ 3 thành viên làm việc song song.

---

## 1. Khởi chạy & Kiểm chứng Nhanh (Zero Global Dependencies)

Dự án sử dụng **`npm workspaces`** chuẩn đi kèm Node.js:

```bash
# 1. Cài đặt liên kết giữa các workspaces (@spriter/shared, @spriter/api, @spriter/web)
npm install

# 2. Chạy toàn bộ cổng kiểm tra kiến trúc (R1-R6) và bộ Unit/Boundary Tests
npm run verify

# 3. Xem danh sách 4 Milestones & 27 Issues chuẩn bị đồng bộ lên GitHub
npm run github:dry-run
```

---

## 2. Bản đồ Tài liệu cho 3 Thành viên & AI Agents

Mọi AI Agent (Antigravity/Gemini, Claude Code, Cursor, Copilot) khi mở repo đều tự động đọc `/AGENTS.md` và các file `AGENTS.md` phân cấp theo thư mục:

| Tài liệu | Mục đích |
| :--- | :--- |
| [`AGENTS.md`](file:///Users/nekover2/Developments/Spriter/AGENTS.md) | Chỉ dẫn gốc cho AI Agent: Kiến trúc, 6 luật cấm import (`R1–R6`) và định tuyến task. |
| [`TECHNICAL_DESIGN.md`](file:///Users/nekover2/Developments/Spriter/TECHNICAL_DESIGN.md) | Thiết kế kỹ thuật tổng thể, sơ đồ kiến trúc, ERD, ADR-001 và Refactoring Plan. |
| [`docs/contracts/DATA_AND_EVENTS.md`](file:///Users/nekover2/Developments/Spriter/docs/contracts/DATA_AND_EVENTS.md) | **Hợp đồng dữ liệu chi tiết:** Ma trận trạng thái, REST API, `ViewportBridge`, Socket.io và xử lý `409 Conflict` / Import. |
| [`docs/TEAM_PLAN.md`](file:///Users/nekover2/Developments/Spriter/docs/TEAM_PLAN.md) | Kế hoạch tổng thể cho 3 người, CODEOWNERS và các cổng tích hợp `G1–G4`. |
| [`docs/tasks/STREAM_A_BACKEND.md`](file:///Users/nekover2/Developments/Spriter/docs/tasks/STREAM_A_BACKEND.md) | **Luồng A (Bạn — Tech Lead / Backend & Realtime):** Đặc tả chi tiết Tasks `A1–A10`. |
| [`docs/tasks/STREAM_B_3D_VIEWPORT.md`](file:///Users/nekover2/Developments/Spriter/docs/tasks/STREAM_B_3D_VIEWPORT.md) | **Luồng B (Thành viên 2 — 3D Viewport & Raycast):** Đặc tả chi tiết Tasks `B1–B8`. |
| [`docs/tasks/STREAM_C_COLLAB_UI.md`](file:///Users/nekover2/Developments/Spriter/docs/tasks/STREAM_C_COLLAB_UI.md) | **Luồng C (Thành viên 3 — Collaboration UI & Store):** Đặc tả chi tiết Tasks `C1–C9`. |

---

## 3. Tự động Tạo Milestones, Labels & 27 Issues trên GitHub

Repo đã tích hợp sẵn cả **GitHub Actions Workflow** và **CLI Script** để tự động tạo toàn bộ **4 Milestones (`M1–M4`)**, **4 Labels** và **27 Task Issues (`[A1]–[A10]`, `[B1]–[B8]`, `[C1]–[C9]`)**:

### Cách 1: Bấm 1 nút trực tiếp trên giao diện GitHub (Không cần tạo Token tay)
1. Push repo này lên GitHub (`git remote add origin <URL> && git push -u origin master`).
2. Vào tab **Actions** trên GitHub $\rightarrow$ chọn workflow **"Bootstrap GitHub Milestones & 27 Task Issues"** ([`bootstrap-github-issues.yml`](file:///Users/nekover2/Developments/Spriter/.github/workflows/bootstrap-github-issues.yml)).
3. Bấm **"Run workflow"** $\rightarrow$ GitHub Actions sẽ tự động dùng `GITHUB_TOKEN` sẵn có để khởi tạo toàn bộ 4 Milestones, Labels và 27 Issues!

### Cách 2: Chạy trực tiếp từ máy local
```bash
GITHUB_TOKEN=ghp_your_token GITHUB_REPOSITORY=owner/repo npm run github:sync
```
