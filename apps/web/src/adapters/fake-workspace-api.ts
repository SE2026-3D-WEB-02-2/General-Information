import {
  type AnnotationDomainSnapshot,
  type AuthSessionResponseDto,
  type ConfirmModelUploadDto,
  type CreateAnnotationRequestDto,
  type CreateCommentRequestDto,
  type ExportFileV1,
  type ImportAnnotationsRequestDto,
  type ImportAnnotationsResponseDto,
  type ListAnnotationsQueryDto,
  type LoginRequestDto,
  type ModelSummaryDto,
  type PaginatedAnnotationsResponseDto,
  type PatchAnnotationRequestDto,
  type PresignedUploadResponseDto,
  type RegisterRequestDto,
  type RequestModelUploadUrlDto,
  type UserSummary,
  evaluateAnnotationMutation,
  validateExportPayload,
  validateSurfacePick,
} from '@spriter/shared';
import type { WorkspaceApiPort } from '../features/annotations/workspace-ports.ts';
import { ApiClientError } from './http-annotation-api.ts';

const MODEL_ID = 'model-gltf-01';
const FILE_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

const seed: AnnotationDomainSnapshot[] = [
  {
    id: 'ann-demo-1', modelId: MODEL_ID, authorId: 'user-ui-hieu', authorName: 'Hồ Trọng Hiếu',
    status: 'OPEN', version: 1, position: [1.2, 0.9, -0.4], normal: [0, 1, 0],
    cameraState: { position: [3.5, 2.1, 4], target: [1.2, 0.9, -0.4] },
    meshName: 'Front_Housing_Flange',
    comments: [
      { id: 'c-demo-1', authorId: 'user-ui-hieu', authorName: 'Hồ Trọng Hiếu', content: 'Kiểm tra lại khoảng hở ở mép trước của cụm vỏ.', createdAt: '2026-10-24T08:15:00.000Z' },
      { id: 'c-demo-2', authorId: 'user-3d-huy', authorName: 'Hoàng Đức Huy', content: 'Mình sẽ đối chiếu vị trí này trên mô hình mới.', createdAt: '2026-10-24T09:10:00.000Z' },
    ],
    createdAt: '2026-10-24T08:15:00.000Z', updatedAt: '2026-10-24T09:10:00.000Z',
  },
  {
    id: 'ann-demo-2', modelId: MODEL_ID, authorId: 'user-3d-huy', authorName: 'Hoàng Đức Huy',
    status: 'IN_PROGRESS', version: 2, position: [-0.8, 1.3, 0.5], normal: [0, 0, 1],
    cameraState: { position: [-2, 2, 4], target: [-0.8, 1.3, 0.5] },
    meshName: 'Door_Panel',
    comments: [{ id: 'c-demo-3', authorId: 'user-3d-huy', authorName: 'Hoàng Đức Huy', content: 'Cần làm mềm đường bo ở cạnh dưới tay nắm.', createdAt: '2026-10-23T04:20:00.000Z' }],
    createdAt: '2026-10-23T04:20:00.000Z', updatedAt: '2026-10-24T07:10:00.000Z',
  },
  {
    id: 'ann-demo-3', modelId: MODEL_ID, authorId: 'user-lead-nekover2', authorName: 'Nekover2',
    status: 'RESOLVED', version: 3, position: [0.1, 1.8, -1.1], normal: [0, 1, 0],
    cameraState: { position: [2, 3, 2], target: [0.1, 1.8, -1.1] },
    meshName: 'Top_Cover',
    comments: [{ id: 'c-demo-4', authorId: 'user-lead-nekover2', authorName: 'Nekover2', content: 'Đã chỉnh đường nối nắp theo bản CAD mới nhất.', createdAt: '2026-10-22T05:45:00.000Z' }],
    createdAt: '2026-10-21T10:00:00.000Z', updatedAt: '2026-10-22T05:45:00.000Z',
  },
];

function clientError(statusCode: number, errorCode: 'VALIDATION_FAILED' | 'ANNOTATION_NOT_FOUND' | 'IMPORT_MODEL_HASH_MISMATCH' | 'IMPORT_VALIDATION_FAILED', message: string, extra: Record<string, unknown> = {}) {
  return new ApiClientError(statusCode, { errorCode, message, ...extra });
}

/** Browser demo adapter. It deliberately keeps all data in memory. */
export class FakeWorkspaceApi implements WorkspaceApiPort {
  private readonly annotations = new Map(seed.map((item) => [item.id, structuredClone(item)]));
  private user: UserSummary = { id: 'user-ui-hieu', email: 'hieu@spriter.local', name: 'Hồ Trọng Hiếu', role: 'REVIEWER' };
  private model: ModelSummaryDto = {
    id: MODEL_ID, name: 'turbine_housing_v1.glb', storageKey: 'demo/model.glb', fileSize: 14_520_832,
    fileHash: FILE_HASH, status: 'READY', uploadedBy: 'user-lead-nekover2', createdAt: '2026-10-24T00:00:00.000Z',
  };

  setAccessToken(_token: string | null): void {}

  async listAnnotations(modelId: string, query: ListAnnotationsQueryDto = {}): Promise<PaginatedAnnotationsResponseDto> {
    let items = Array.from(this.annotations.values()).filter((item) => item.modelId === modelId);
    if (query.status) items = items.filter((item) => item.status === query.status);
    if (query.updatedAfter) items = items.filter((item) => item.updatedAt > query.updatedAfter!);
    items.sort((a, b) => a.id.localeCompare(b.id));
    const totalCount = items.length;
    const start = query.cursor ? Math.max(0, items.findIndex((item) => item.id === query.cursor) + 1) : 0;
    const limit = query.limit ?? 50;
    const page = items.slice(start, start + limit);
    return { items: structuredClone(page), nextCursor: start + limit < items.length ? page.at(-1)?.id ?? null : null, totalCount, serverTime: new Date().toISOString() };
  }

  async createAnnotation(modelId: string, body: CreateAnnotationRequestDto): Promise<AnnotationDomainSnapshot> {
    const check = validateSurfacePick(body);
    if (!check.valid || !body.initialComment.trim()) throw clientError(422, 'VALIDATION_FAILED', check.error ?? 'Cần nhập bình luận đầu tiên.');
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const annotation: AnnotationDomainSnapshot = {
      id, modelId, authorId: this.user.id, authorName: this.user.name, status: 'OPEN', version: 1,
      position: body.position, normal: body.normal, cameraState: body.cameraState, meshName: body.meshName,
      comments: [{ id: crypto.randomUUID(), authorId: this.user.id, authorName: this.user.name, content: body.initialComment.trim(), createdAt: now }],
      createdAt: now, updatedAt: now,
    };
    this.annotations.set(id, structuredClone(annotation));
    return annotation;
  }

  async addComment(id: string, body: CreateCommentRequestDto): Promise<AnnotationDomainSnapshot> {
    const current = this.annotations.get(id);
    if (!current) throw clientError(404, 'ANNOTATION_NOT_FOUND', 'Không tìm thấy pin.');
    if (current.status === 'ARCHIVED' || !body.content.trim()) throw clientError(422, 'VALIDATION_FAILED', 'Không thể thêm bình luận này.');
    const now = new Date().toISOString();
    const next: AnnotationDomainSnapshot = {
      ...current, version: current.version + 1, updatedAt: now,
      comments: [...current.comments, { id: crypto.randomUUID(), authorId: this.user.id, authorName: this.user.name, content: body.content.trim(), createdAt: now }],
    };
    this.annotations.set(id, structuredClone(next));
    return next;
  }

  async patchAnnotation(id: string, payload: PatchAnnotationRequestDto) {
    const current = this.annotations.get(id);
    if (!current) return { ok: false as const, statusCode: 422 as const, errorCode: 'ANNOTATION_NOT_FOUND' };
    if (current.version !== payload.expectedVersion) return { ok: false as const, statusCode: 409 as const, errorCode: 'CONCURRENCY_CONFLICT', serverSnapshot: structuredClone(current) };
    const result = evaluateAnnotationMutation(current, payload);
    if (!result.allowed) return { ok: false as const, statusCode: 422 as const, errorCode: result.reasonCode ?? 'VALIDATION_FAILED' };
    const next: AnnotationDomainSnapshot = {
      ...current, status: payload.status ?? current.status, position: payload.position ?? current.position,
      normal: payload.normal ?? current.normal, cameraState: payload.cameraState ?? current.cameraState,
      version: current.version + 1, updatedAt: new Date().toISOString(),
    };
    this.annotations.set(id, structuredClone(next));
    return { ok: true as const, data: next };
  }

  async exportAnnotations(modelId: string): Promise<ExportFileV1> {
    return { schemaVersion: '1.0', exportedAt: new Date().toISOString(), modelMeta: { name: this.model.name, fileHash: this.model.fileHash }, annotations: (await this.listAnnotations(modelId, { limit: 1000 })).items };
  }

  async importAnnotations(modelId: string, body: ImportAnnotationsRequestDto): Promise<ImportAnnotationsResponseDto> {
    if (body.mode !== 'FORCE_HASH_MISMATCH' && body.payload.modelMeta.fileHash !== this.model.fileHash) {
      throw clientError(409, 'IMPORT_MODEL_HASH_MISMATCH', 'Mã băm model không khớp.', { expectedFileHash: this.model.fileHash, actualFileHash: body.payload.modelMeta.fileHash });
    }
    const check = validateExportPayload(body.payload);
    if (!check.valid) throw clientError(422, 'IMPORT_VALIDATION_FAILED', 'Dữ liệu import không hợp lệ.', { itemErrors: check.itemErrors });
    const annotations = body.payload.annotations.map((item) => ({ ...structuredClone(item), modelId }));
    for (const item of annotations) this.annotations.set(item.id, item);
    return { importedCount: annotations.length, annotations };
  }

  private session(): AuthSessionResponseDto {
    return { user: this.user, accessToken: 'demo-only-token', expiresInSeconds: 86_400 };
  }

  async login(body: LoginRequestDto): Promise<AuthSessionResponseDto> {
    if (!body.email.trim() || !body.password.trim()) throw clientError(422, 'VALIDATION_FAILED', 'Nhập email và mật khẩu.');
    this.user = { ...this.user, email: body.email.trim() };
    return this.session();
  }

  async register(body: RegisterRequestDto): Promise<AuthSessionResponseDto> {
    if (!body.email.trim() || body.password.length < 8 || !body.name.trim()) throw clientError(422, 'VALIDATION_FAILED', 'Kiểm tra lại tên, email và mật khẩu.');
    this.user = { id: crypto.randomUUID(), email: body.email.trim(), name: body.name.trim(), role: 'REVIEWER' };
    return this.session();
  }

  async requestUploadUrl(body: RequestModelUploadUrlDto): Promise<PresignedUploadResponseDto> {
    return { modelId: crypto.randomUUID(), uploadUrl: 'mock://spriter-upload', storageKey: `demo/${body.fileName}`, expiresInSeconds: 900, maxApiJsonBodyBytes: 1_048_576 };
  }

  async confirmUpload(modelId: string, body: ConfirmModelUploadDto): Promise<ModelSummaryDto> {
    this.model = { ...this.model, id: modelId, fileSize: body.fileSize, fileHash: body.fileHash, status: 'READY' };
    return this.model;
  }
}
