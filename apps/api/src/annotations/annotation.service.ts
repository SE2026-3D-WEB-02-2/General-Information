// [BEFORE REFACTORING]
// Smell 2: Naive Read-Modify-Write without Optimistic Concurrency Control (version) or Information Hiding

export interface RawDbAnnotation {
  id: string;
  model_id: string;
  author_id: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'ARCHIVED';
  position: [number, number, number];
  normal: [number, number, number];
  comments: Array<{ id: string; authorId: string; content: string; createdAt: string }>;
  internal_storage_bucket_token?: string; // Leaky internal field
  updated_at: string;
}

export class AnnotationService {
  private dbStore = new Map<string, RawDbAnnotation>();

  public async findRawById(id: string): Promise<RawDbAnnotation | undefined> {
    return this.dbStore.get(id);
  }

  // Smell 2: Last-Write-Wins blind overwrite — loses concurrent changes and leaks internal DB record
  public async overwriteDirectly(id: string, patch: Partial<RawDbAnnotation>): Promise<RawDbAnnotation> {
    const current = this.dbStore.get(id);
    if (!current) {
      throw new Error('Annotation not found');
    }
    const merged: RawDbAnnotation = {
      ...current,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    this.dbStore.set(id, merged);
    return merged;
  }
}
