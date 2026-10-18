import { AnnotationService } from './annotation.service';

// [BEFORE REFACTORING]
// Smell 1: Business rules are duplicated in API controller (and slightly drift from UI)
// Smell 2: Exposes internal DB fields directly & performs unversioned overwrite (Lost Update vulnerability)

export class AnnotationController {
  constructor(private readonly annotationService: AnnotationService) {}

  public async patchAnnotation(req: {
    params: { id: string };
    body: {
      status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'ARCHIVED';
      position?: [number, number, number];
      normal?: [number, number, number];
    };
  }) {
    const existing = await this.annotationService.findRawById(req.params.id);
    if (!existing) {
      return { statusCode: 404, body: { message: 'Not found' } };
    }

    // Smell 1: Duplicated Business Rule in API (drifted from UI: checks >= 5 chars instead of >= 10, forgets IN_PROGRESS check)
    if (req.body.status === 'RESOLVED') {
      if (existing.comments.length === 0 || existing.comments[existing.comments.length - 1].content.length < 5) {
        return { statusCode: 400, body: { message: 'Cannot resolve without explanation comment' } };
      }
      const [nx, ny, nz] = req.body.normal ?? existing.normal;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (Math.abs(len - 1.0) > 0.05) {
        return { statusCode: 400, body: { message: 'Invalid normal vector' } };
      }
    }

    // Smell 2: Blind overwrite without checking version -> causes Lost Update when 2 users update concurrently!
    const updated = await this.annotationService.overwriteDirectly(req.params.id, req.body);
    return { statusCode: 200, body: updated };
  }
}
