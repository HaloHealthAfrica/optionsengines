import * as Sentry from '@sentry/node';

type ErrorStats = {
  total: number;
  bySource: Record<string, number>;
};

export class ErrorTracker {
  private total = 0;
  private bySource: Record<string, number> = {};

  recordError(source: string): void {
    this.total += 1;
    this.bySource[source] = (this.bySource[source] ?? 0) + 1;
    Sentry.captureMessage('WORKER_ERROR', {
      level: 'error',
      tags: { source },
      extra: { count: this.bySource[source], total: this.total },
    });
  }

  getStats(): ErrorStats {
    return {
      total: this.total,
      bySource: { ...this.bySource },
    };
  }

  reset(): void {
    this.total = 0;
    this.bySource = {};
  }
}

export const errorTracker = new ErrorTracker();
