import { AnnotationService } from '../domain/annotation.service.ts';

export interface PurgeRunSummary {
  purgedCount: number;
  totalPurgedLifetime: number;
  executedAt: string;
}

/**
 * [A9] Automated 7-Day Operational Audit Log Purge Worker (`expires_at <= NOW()`).
 * Enforces the 7-day operational data retention constraint (`OPERATIONAL_LOG_TTL_DAYS = 7`).
 */
export class OperationalLogPurgeWorker {
  private readonly annotationService: AnnotationService;
  private readonly nowFn: () => Date;
  private timer: ReturnType<typeof setInterval> | null = null;
  private totalPurgedLifetime = 0;
  private lastRunSummary: PurgeRunSummary | null = null;

  constructor(annotationService: AnnotationService, nowFn: () => Date = () => new Date()) {
    this.annotationService = annotationService;
    this.nowFn = nowFn;
  }

  public async runOnce(): Promise<PurgeRunSummary> {
    const purgedCount = await this.annotationService.purgeExpiredOperationalLogs();
    this.totalPurgedLifetime += purgedCount;
    const summary: PurgeRunSummary = {
      purgedCount,
      totalPurgedLifetime: this.totalPurgedLifetime,
      executedAt: this.nowFn().toISOString(),
    };
    this.lastRunSummary = summary;
    return summary;
  }

  public start(intervalMs = 60 * 60 * 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runOnce();
    }, intervalMs);
    this.timer.unref?.();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public getLastRunSummary(): PurgeRunSummary | null {
    return this.lastRunSummary;
  }
}
