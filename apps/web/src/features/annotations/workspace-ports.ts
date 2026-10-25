import type {
  AnnotationDomainSnapshot,
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
  PresignedUploadResponseDto,
  RegisterRequestDto,
  RequestModelUploadUrlDto,
} from '@spriter/shared';
import type { AnnotationApiPort } from './AnnotationThreadController.ts';

export interface WorkspaceApiPort extends AnnotationApiPort {
  listAnnotations(modelId: string, query?: ListAnnotationsQueryDto): Promise<PaginatedAnnotationsResponseDto>;
  createAnnotation(modelId: string, body: CreateAnnotationRequestDto): Promise<AnnotationDomainSnapshot>;
  addComment(annotationId: string, body: CreateCommentRequestDto): Promise<AnnotationDomainSnapshot>;
  exportAnnotations(modelId: string): Promise<ExportFileV1>;
  importAnnotations(modelId: string, body: ImportAnnotationsRequestDto): Promise<ImportAnnotationsResponseDto>;
  login(body: LoginRequestDto): Promise<AuthSessionResponseDto>;
  register(body: RegisterRequestDto): Promise<AuthSessionResponseDto>;
  requestUploadUrl(body: RequestModelUploadUrlDto): Promise<PresignedUploadResponseDto>;
  confirmUpload(modelId: string, body: ConfirmModelUploadDto): Promise<ModelSummaryDto>;
  setAccessToken(token: string | null): void;
}
