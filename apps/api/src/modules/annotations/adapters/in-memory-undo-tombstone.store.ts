import { timingSafeEqual } from 'node:crypto';
import { type UndoTombstone, type UndoTombstoneStorePort } from '../domain/ports.ts';

/**
 * [VT-085] Process-local undo store. Undo survives only as long as this process (30 s window);
 * a multi-instance or restart-safe deployment needs a persistent adapter behind the same port.
 */
export class InMemoryUndoTombstoneStore implements UndoTombstoneStorePort {
  private readonly byAnnotationId = new Map<string, UndoTombstone>();

  public async save(tombstone: UndoTombstone): Promise<void> {
    const nowMs = Date.parse(tombstone.deletedAt);
    for (const [id, t] of this.byAnnotationId) {
      if (Date.parse(t.undoExpiresAt) <= nowMs) this.byAnnotationId.delete(id);
    }
    this.byAnnotationId.set(tombstone.record.id, structuredClone(tombstone));
  }

  public async peek(annotationId: string): Promise<UndoTombstone | undefined> {
    const t = this.byAnnotationId.get(annotationId);
    return t ? structuredClone(t) : undefined;
  }

  public async claim(annotationId: string, undoToken: string): Promise<UndoTombstone | undefined> {
    // No await between lookup and delete: two concurrent claims cannot both win.
    const t = this.byAnnotationId.get(annotationId);
    if (!t || !sameToken(t.undoToken, undoToken)) return undefined;
    this.byAnnotationId.delete(annotationId);
    return t;
  }

  public size(): number {
    return this.byAnnotationId.size;
  }
}

function sameToken(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
