import type {
  AnnotationDomainSnapshot,
  AnnotationStatus,
  ApiErrorEnvelope,
  AuthSessionResponseDto,
  ConfirmModelUploadDto,
  CreateAnnotationRequestDto,
  CreateCommentRequestDto,
  ExportFileV1,
  ImportAnnotationsRequestDto,
  ImportAnnotationsResponseDto,
  ListAnnotationsQueryDto,
  LoginRequestDto,
  ModelSummaryDto,
  PaginatedAnnotationsResponseDto,
  PatchAnnotationRequestDto,
  PresignedUploadResponseDto,
  RegisterRequestDto,
  RequestModelUploadUrlDto,
} from '@spriter/shared';
import type { WorkspaceApiPort } from '../features/annotations/workspace-ports.ts';

export class ApiClientError extends Error {
  readonly statusCode: number;
  readonly detail: ApiErrorEnvelope;
  constructor(statusCode: number, detail: ApiErrorEnvelope) {
    super(detail.message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export class HttpAnnotationApi implements WorkspaceApiPort {
  private token: string | null = null;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    baseUrl = 'http://localhost:4000',
    fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
  }

  setAccessToken(token: string | null): void {
    this.token = token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body !== undefined) headers.set('Content-Type', 'application/json');
    if (this.token) headers.set('Authorization', `Bearer ${this.token}`);
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, headers });
    const body: unknown = await response.json();
    if (!response.ok) throw new ApiClientError(response.status, body as ApiErrorEnvelope);
    return body as T;
  }

  listAnnotations(modelId: string, query: ListAnnotationsQueryDto = {}): Promise<PaginatedAnnotationsResponseDto> {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit) params.set('limit', String(query.limit));
    if (query.updatedAfter) params.set('updatedAfter', query.updatedAfter);
    const suffix = params.size ? `?${params}` : '';
    return this.request(`/api/v1/models/${encodeURIComponent(modelId)}/annotations${suffix}`);
  }

  createAnnotation(modelId: string, body: CreateAnnotationRequestDto): Promise<AnnotationDomainSnapshot> {
    return this.request(`/api/v1/models/${encodeURIComponent(modelId)}/annotations`, {
      method: 'POST', body: JSON.stringify(body),
    });
  }

  addComment(annotationId: string, body: CreateCommentRequestDto): Promise<AnnotationDomainSnapshot> {
    return this.request(`/api/v1/annotations/${encodeURIComponent(annotationId)}/comments`, {
      method: 'POST', body: JSON.stringify(body),
    });
  }

  async patchAnnotation(id: string, payload: PatchAnnotationRequestDto): Promise<
    | { ok: true; data: AnnotationDomainSnapshot }
    | { ok: false; statusCode: 409 | 422; errorCode: string; serverSnapshot?: AnnotationDomainSnapshot }
  > {
    try {
      const data = await this.request<AnnotationDomainSnapshot>(`/api/v1/annotations/${encodeURIComponent(id)}`, {
        method: 'PATCH', body: JSON.stringify(payload),
      });
      return { ok: true, data };
    } catch (error) {
      if (error instanceof ApiClientError && (error.statusCode === 409 || error.statusCode === 422)) {
        return {
          ok: false,
          statusCode: error.statusCode,
          errorCode: error.detail.errorCode,
          serverSnapshot: error.detail.serverSnapshot,
        };
      }
      throw error;
    }
  }

  exportAnnotations(modelId: string): Promise<ExportFileV1> {
    return this.request(`/api/v1/models/${encodeURIComponent(modelId)}/annotations/export`);
  }

  importAnnotations(modelId: string, body: ImportAnnotationsRequestDto): Promise<ImportAnnotationsResponseDto> {
    return this.request(`/api/v1/models/${encodeURIComponent(modelId)}/annotations/import`, {
      method: 'POST', body: JSON.stringify(body),
    });
  }

  login(body: LoginRequestDto): Promise<AuthSessionResponseDto> {
    return this.request('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(body) });
  }

  register(body: RegisterRequestDto): Promise<AuthSessionResponseDto> {
    return this.request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify(body) });
  }

  requestUploadUrl(body: RequestModelUploadUrlDto): Promise<PresignedUploadResponseDto> {
    return this.request('/api/v1/models/upload-url', { method: 'POST', body: JSON.stringify(body) });
  }

  confirmUpload(modelId: string, body: ConfirmModelUploadDto): Promise<ModelSummaryDto> {
    return this.request(`/api/v1/models/${encodeURIComponent(modelId)}/confirm`, {
      method: 'POST', body: JSON.stringify(body),
    });
  }
}
