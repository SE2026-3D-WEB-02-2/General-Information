import * as THREE from 'three';

// [BEFORE REFACTORING]
// Smell 1: Business rules for status transition & spatial anchor validation are hardcoded in UI
// Smell 3: Direct coupling to THREE.Vector3, raw fetch(), and unversioned socket overwrite in UI component

export interface UiAnnotationRecord {
  id: string;
  modelId: string;
  authorId: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'ARCHIVED';
  position: [number, number, number];
  normal: [number, number, number];
  comments: Array<{ id: string; authorId: string; content: string; createdAt: string }>;
}

export class AnnotationThreadPanelController {
  private currentAnnotation: UiAnnotationRecord;

  constructor(initial: UiAnnotationRecord, private socket: { on: (evt: string, cb: (data: any) => void) => void }) {
    this.currentAnnotation = initial;

    // Smell 3: Blindly overwrites local state on incoming socket event without checking version
    this.socket.on('annotation:updated', (incoming: UiAnnotationRecord) => {
      if (incoming.id === this.currentAnnotation.id) {
        this.currentAnnotation = incoming;
      }
    });
  }

  // Smell 1: Duplicated Business Rule in UI (checks if annotation can be transitioned to targetStatus)
  public canTransitionStatus(targetStatus: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'ARCHIVED'): boolean {
    if (this.currentAnnotation.status === 'ARCHIVED') {
      return false;
    }
    if (targetStatus === 'RESOLVED') {
      const hasResolutionComment =
        this.currentAnnotation.comments.length >= 1 &&
        this.currentAnnotation.comments[this.currentAnnotation.comments.length - 1].content.trim().length >= 10;
      const normalVec = new THREE.Vector3(...this.currentAnnotation.normal);
      const isNormalValid = Math.abs(normalVec.length() - 1.0) < 0.01;
      return (
        (this.currentAnnotation.status === 'OPEN' || this.currentAnnotation.status === 'IN_PROGRESS') &&
        hasResolutionComment &&
        isNormalValid
      );
    }
    return true;
  }

  // Smell 2 & 3: Sends blind update without expectedVersion, directly coupled to network fetch
  public async updateStatus(targetStatus: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'ARCHIVED'): Promise<void> {
    if (!this.canTransitionStatus(targetStatus)) {
      throw new Error('UI_VALIDATION_FAILED: Cannot transition status');
    }
    const response = await fetch(`/api/v1/annotations/${this.currentAnnotation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: targetStatus }),
    });
    this.currentAnnotation = await response.json();
  }
}
