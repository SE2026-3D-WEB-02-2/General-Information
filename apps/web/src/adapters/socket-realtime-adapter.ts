import type {
  AnnotationDomainSnapshot,
  RoomJoinAck,
  RoomJoinPayload,
  ServerRealtimeEvent,
} from '@spriter/shared';
import { AnnotationWorkspaceStore } from '../app/annotation-store.ts';
import type { WorkspaceApiPort } from '../features/annotations/workspace-ports.ts';

export interface SocketLike {
  readonly connected?: boolean;
  on(event: string, handler: (...args: unknown[]) => void): void;
  off(event: string, handler: (...args: unknown[]) => void): void;
  emit(event: string, payload: RoomJoinPayload, ack: (response: RoomJoinAck) => void): void;
}

/** Socket.io transport adapter; a SocketLike fake can be injected for isolated tests. */
export class SocketRealtimeAdapter {
  private readonly handlers = new Map<string, (...args: unknown[]) => void>();
  private lastSyncIso = new Date(0).toISOString();
  private syncing: Promise<void> | null = null;
  private readonly socket: SocketLike;
  private readonly modelId: string;
  private readonly store: AnnotationWorkspaceStore;
  private readonly api: WorkspaceApiPort;
  private readonly onError?: (error: unknown) => void;

  constructor(
    socket: SocketLike,
    modelId: string,
    store: AnnotationWorkspaceStore,
    api: WorkspaceApiPort,
    onError?: (error: unknown) => void,
  ) {
    this.socket = socket;
    this.modelId = modelId;
    this.store = store;
    this.api = api;
    this.onError = onError;
  }

  start(): void {
    if (this.handlers.size) return;
    for (const type of ['annotation:created', 'annotation:updated', 'annotation:deleted', 'comment:created']) {
      const handler = (...args: unknown[]) => { void this.handleEvent(args[0] as ServerRealtimeEvent).catch((error) => this.onError?.(error)); };
      this.handlers.set(type, handler);
      this.socket.on(type, handler);
    }
    // Socket.io fires `connect` on both the first connection and every reconnect.
    const connect = () => { void this.join().then(() => this.catchUp()).catch((error) => this.onError?.(error)); };
    this.handlers.set('connect', connect);
    this.socket.on('connect', connect);
    const connectError = (...args: unknown[]) => this.onError?.(args[0]);
    this.handlers.set('connect_error', connectError);
    this.socket.on('connect_error', connectError);
    if (this.socket.connected !== false) connect();
  }

  stop(): void {
    for (const [type, handler] of this.handlers) this.socket.off(type, handler);
    this.handlers.clear();
  }

  async join(): Promise<void> {
    const knownVersions = Object.fromEntries(this.store.getAnnotations().map((item) => [item.id, item.version]));
    const ack = await new Promise<RoomJoinAck>((resolve) => {
      this.socket.emit('room:join', { modelId: this.modelId, knownVersions }, resolve);
    });
    if (!ack.ok) throw new Error(ack.errorCode ?? 'Không thể vào phòng review.');
    for (const item of ack.missedAnnotations ?? []) this.store.upsertSnapshot(item);
  }

  private async handleEvent(event: ServerRealtimeEvent): Promise<void> {
    if (!event || event.modelId !== this.modelId) return;
    if (event.type === 'annotation:deleted') {
      this.store.removeAnnotation(event.annotationId);
      return;
    }
    if (event.type === 'annotation:created') {
      this.store.upsertSnapshot(event.annotation);
      return;
    }
    if (event.type === 'annotation:updated') {
      const decision = this.store.handleRealtimeUpdate(event.previousVersion, event.annotation);
      if (decision === 'APPLY_AND_FETCH_GAP') await this.catchUp();
      return;
    }
    // A comment event carries only the new comment. Fetch a full snapshot to keep
    // thread and version state consistent with HTTP and annotation:updated events.
    const current = this.store.getAnnotations().find((item) => item.id === event.annotationId);
    if (!current || event.annotationVersion > current.version) await this.catchUp();
  }

  async catchUp(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = this.fetchPages().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async fetchPages(): Promise<void> {
    let cursor: string | undefined;
    let serverTime = this.lastSyncIso;
    do {
      const page = await this.api.listAnnotations(this.modelId, { updatedAfter: this.lastSyncIso, cursor, limit: 50 });
      for (const item of page.items) this.store.upsertSnapshot(item);
      serverTime = page.serverTime;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    this.lastSyncIso = serverTime;
    this.store.clearMissedVersionGap();
  }

  getLastSyncIso(): string { return this.lastSyncIso; }
  getSnapshot(annotationId: string): AnnotationDomainSnapshot | undefined {
    return this.store.getAnnotations().find((item) => item.id === annotationId);
  }
}
