import { MAX_API_JSON_BODY_BYTES, type ServerRealtimeEvent } from '@spriter/shared';
import { InMemoryAnnotationRepository } from '../modules/annotations/adapters/in-memory.repository.ts';
import { AnnotationService } from '../modules/annotations/domain/annotation.service.ts';
import { type ClockPort, type RealtimePublisherPort } from '../modules/annotations/domain/ports.ts';
import { AnnotationController } from '../modules/annotations/http/annotation.controller.ts';
import { InMemoryUserRepository } from '../modules/auth/adapters/in-memory-user.repository.ts';
import { AuthService } from '../modules/auth/domain/auth.service.ts';
import { AuthController } from '../modules/auth/http/auth.controller.ts';
import {
  InMemoryModelRepository,
  S3CompatiblePresignerAdapter,
} from '../modules/models/adapters/s3-presigned-storage.adapter.ts';
import { ModelService } from '../modules/models/domain/model.service.ts';
import { ModelController } from '../modules/models/http/model.controller.ts';

export interface HttpRequestEnvelope {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string | undefined>;
  headers?: {
    authorization?: string;
    contentType?: string;
    contentLength?: number;
  };
  body?: unknown;
}

export interface HttpResponseEnvelope {
  statusCode: number;
  body: unknown;
}

/**
 * Unified Hexagonal Backend Application wiring Auth ([A3]), Models ([A5]), and Annotations ([A1, A2, A4, A6]).
 * Can be invoked directly in fast unit/integration tests OR mounted onto Node's HTTP server.
 */
export class SpriterApiApplication {
  public readonly annotationRepo: InMemoryAnnotationRepository;
  public readonly authService: AuthService;
  public readonly modelService: ModelService;
  public readonly annotationService: AnnotationService;

  public readonly authController: AuthController;
  public readonly modelController: ModelController;
  public readonly annotationController: AnnotationController;
  public readonly publishedEvents: ServerRealtimeEvent[] = [];

  constructor(options?: { clock?: ClockPort; realtime?: RealtimePublisherPort }) {
    const nowFn = options?.clock ? () => options.clock!.now() : () => new Date();
    this.annotationRepo = new InMemoryAnnotationRepository();

    const modelRepo = new InMemoryModelRepository((readyModel) => {
      this.annotationRepo.seedModel(readyModel);
    });

    const realtime: RealtimePublisherPort = options?.realtime ?? {
      publishToModelRoom: (_modelId, event) => {
        this.publishedEvents.push(event);
      },
    };

    this.authService = new AuthService(new InMemoryUserRepository(), undefined, nowFn);
    this.modelService = new ModelService(modelRepo, new S3CompatiblePresignerAdapter(), nowFn);
    this.annotationService = new AnnotationService(
      this.annotationRepo,
      { now: nowFn },
      realtime,
    );

    this.authController = new AuthController(this.authService);
    this.modelController = new ModelController(this.modelService);
    this.annotationController = new AnnotationController(this.annotationService);
  }

  public async handleRequest(req: HttpRequestEnvelope): Promise<HttpResponseEnvelope> {
    // 1. Global 1MB API Body & Binary Upload Guard ([A5])
    const bodyGuard = this.modelController.checkDirectUploadGuard({
      contentType: req.headers?.contentType,
      contentLength: req.headers?.contentLength,
    });
    if (!bodyGuard.allowed) {
      return { statusCode: bodyGuard.statusCode, body: bodyGuard.body };
    }

    const cleanPath = req.path.split('?')[0]!;

    // 2. Public Health & Auth Endpoints
    if (req.method === 'GET' && cleanPath === '/health') {
      return { statusCode: 200, body: { status: 'ok' } };
    }
    if (req.method === 'POST' && cleanPath === '/api/v1/auth/register') {
      return this.authController.register({ body: (req.body ?? {}) as any });
    }
    if (req.method === 'POST' && cleanPath === '/api/v1/auth/login') {
      return this.authController.login({ body: (req.body ?? {}) as any });
    }
    if (req.method === 'GET' && cleanPath === '/api/v1/auth/me') {
      return this.authController.me({ authorizationHeader: req.headers?.authorization });
    }

    // 3. Protected Routes require valid Bearer JWT ([A3])
    const auth = await this.authController.authenticateBearer(req.headers?.authorization);
    if (!auth.authenticated) {
      return auth.errorResponse;
    }
    const actor = auth.user;

    // 4. Models & Presigned Upload Routes ([A5])
    if (req.method === 'POST' && cleanPath === '/api/v1/models/upload-url') {
      return this.modelController.requestUploadUrl({
        actorId: actor.id,
        headers: req.headers,
        body: (req.body ?? {}) as any,
      });
    }

    const confirmMatch = /^\/api\/v1\/models\/([^/]+)\/confirm$/.exec(cleanPath);
    if (req.method === 'POST' && confirmMatch) {
      return this.modelController.confirmUpload({
        params: { id: confirmMatch[1]! },
        body: (req.body ?? {}) as any,
      });
    }

    // 5. Export / Import Routes ([A6])
    const exportMatch = /^\/api\/v1\/models\/([^/]+)\/annotations\/export$/.exec(cleanPath);
    if (req.method === 'GET' && exportMatch) {
      return this.annotationController.exportAnnotations({
        params: { modelId: exportMatch[1]! },
      });
    }

    const importMatch = /^\/api\/v1\/models\/([^/]+)\/annotations\/import$/.exec(cleanPath);
    if (req.method === 'POST' && importMatch) {
      return this.annotationController.importAnnotations({
        params: { modelId: importMatch[1]! },
        actorId: actor.id,
        body: (req.body ?? {}) as any,
      });
    }

    // 6. Model Annotations List & Create ([A4])
    const modelAnnMatch = /^\/api\/v1\/models\/([^/]+)\/annotations$/.exec(cleanPath);
    if (modelAnnMatch) {
      const modelId = modelAnnMatch[1]!;
      if (req.method === 'GET') {
        return this.annotationController.listAnnotations({
          params: { modelId },
          query: {
            status: req.query?.status as any,
            cursor: req.query?.cursor,
            limit: req.query?.limit ? Number(req.query.limit) : undefined,
            updatedAfter: req.query?.updatedAfter,
          },
        });
      }
      if (req.method === 'POST') {
        return this.annotationController.createAnnotation({
          params: { modelId },
          actorId: actor.id,
          body: (req.body ?? {}) as any,
        });
      }
    }

    const modelGetMatch = /^\/api\/v1\/models\/([^/]+)$/.exec(cleanPath);
    if (req.method === 'GET' && modelGetMatch) {
      return this.modelController.getModel({ params: { id: modelGetMatch[1]! } });
    }

    // 7. Annotation Comments, Patch OCC & Delete ([A2, A3, A4])
    const commentMatch = /^\/api\/v1\/annotations\/([^/]+)\/comments$/.exec(cleanPath);
    if (req.method === 'POST' && commentMatch) {
      return this.annotationController.addComment({
        params: { id: commentMatch[1]! },
        actorId: actor.id,
        body: (req.body ?? {}) as any,
      });
    }

    const annIdMatch = /^\/api\/v1\/annotations\/([^/]+)$/.exec(cleanPath);
    if (annIdMatch) {
      const id = annIdMatch[1]!;
      if (req.method === 'PATCH') {
        return this.annotationController.patchAnnotation({
          params: { id },
          actorId: actor.id,
          actorRole: actor.role,
          body: (req.body ?? {}) as any,
        });
      }
      if (req.method === 'DELETE') {
        return this.annotationController.deleteAnnotation({
          params: { id },
          actorId: actor.id,
          actorRole: actor.role,
        });
      }
    }

    return {
      statusCode: 404,
      body: { errorCode: 'NOT_FOUND', message: `Route ${req.method} ${cleanPath} not found.` },
    };
  }
}

export { MAX_API_JSON_BODY_BYTES };
