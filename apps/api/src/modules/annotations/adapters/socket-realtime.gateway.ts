import {
  type AnnotationDomainSnapshot,
  type RoomJoinAck,
  type RoomJoinPayload,
  type ServerRealtimeEvent,
  type SocketHandshakeAuth,
} from '@spriter/shared';
import { AuthService } from '../../auth/domain/auth.service.ts';
import { AnnotationService } from '../domain/annotation.service.ts';
import { type RealtimePublisherPort } from '../domain/ports.ts';

export interface RealtimeClientSubscriber {
  readonly socketId: string;
  onEvent: (event: ServerRealtimeEvent) => void;
}

export interface ExternalSocketIoLikeServer {
  to(room: string): { emit(eventName: string, payload: unknown): void };
}

/**
 * [A7] Socket.io Realtime Gateway (`room = model:{modelId}`).
 * - Authenticates handshake token (`SocketHandshakeAuth`).
 * - Verifies target model on `room:join` and computes missed-event catch-up (`missedAnnotations`) from `knownVersions`.
 * - Broadcasts `ServerRealtimeEvent` ONLY after DB transaction commits.
 */
export class SocketRealtimeGateway implements RealtimePublisherPort {
  private readonly roomSubscribers = new Map<string, Map<string, (event: ServerRealtimeEvent) => void>>();
  private readonly publishedHistory: Array<{ room: string; event: ServerRealtimeEvent }> = [];
  private authService?: AuthService;
  private annotationService?: AnnotationService;
  private externalIo?: ExternalSocketIoLikeServer;

  public bindServices(deps: {
    authService: AuthService;
    annotationService: AnnotationService;
    externalIo?: ExternalSocketIoLikeServer;
  }): void {
    this.authService = deps.authService;
    this.annotationService = deps.annotationService;
    this.externalIo = deps.externalIo;
  }

  public static getRoomName(modelId: string): string {
    return `model:${modelId}`;
  }

  public publishToModelRoom(modelId: string, event: ServerRealtimeEvent): void {
    const room = SocketRealtimeGateway.getRoomName(modelId);
    this.publishedHistory.push({ room, event });

    // 1. Broadcast to in-process subscribers
    const subs = this.roomSubscribers.get(room);
    if (subs) {
      for (const listener of subs.values()) {
        listener(event);
      }
    }

    // 2. Broadcast to external Socket.io server if attached
    if (this.externalIo) {
      this.externalIo.to(room).emit(event.type, event);
    }
  }

  public getPublishedHistory(): ReadonlyArray<{ room: string; event: ServerRealtimeEvent }> {
    return this.publishedHistory;
  }

  /**
   * Handles a client `room:join` request with JWT verification, model check, and `knownVersions` catch-up sync.
   */
  public async joinModelRoom(params: {
    socketId: string;
    auth: SocketHandshakeAuth;
    payload: RoomJoinPayload;
    onEvent: (event: ServerRealtimeEvent) => void;
  }): Promise<RoomJoinAck> {
    const nowIso = new Date().toISOString();
    if (!this.authService || !this.annotationService) {
      throw new Error('SocketRealtimeGateway.bindServices() must be called before joinModelRoom.');
    }

    const user = await this.authService.getAuthenticatedUser(params.auth.token);
    if (!user) {
      return {
        ok: false,
        room: '',
        serverTime: nowIso,
        errorCode: 'UNAUTHORIZED',
      };
    }

    const exportCheck = await this.annotationService.exportModelAnnotations(params.payload.modelId);
    if (exportCheck.status === 'MODEL_NOT_FOUND') {
      return {
        ok: false,
        room: '',
        serverTime: nowIso,
        errorCode: 'MODEL_NOT_FOUND',
      };
    }

    const room = SocketRealtimeGateway.getRoomName(params.payload.modelId);
    let subs = this.roomSubscribers.get(room);
    if (!subs) {
      subs = new Map();
      this.roomSubscribers.set(room, subs);
    }
    subs.set(params.socketId, params.onEvent);

    // Compute catch-up delta if client supplied `knownVersions` upon reconnect
    let missedAnnotations: AnnotationDomainSnapshot[] | undefined = undefined;
    if (params.payload.knownVersions) {
      missedAnnotations = exportCheck.data.annotations.filter((serverAnn) => {
        const clientKnownVersion = params.payload.knownVersions?.[serverAnn.id] ?? 0;
        return serverAnn.version > clientKnownVersion;
      });
    }

    return {
      ok: true,
      room,
      serverTime: nowIso,
      ...(missedAnnotations ? { missedAnnotations } : {}),
    };
  }

  public leaveModelRoom(socketId: string, modelId: string): void {
    const room = SocketRealtimeGateway.getRoomName(modelId);
    this.roomSubscribers.get(room)?.delete(socketId);
  }
}
