import * as Sentry from '@sentry/node';
import { logger } from '../utils/logger.js';

const workerNames = new Set<string>();
let handlersRegistered = false;

export function registerWorkerErrorHandlers(workerName: string): void {
  workerNames.add(workerName);
  if (handlersRegistered) {
    return;
  }

  handlersRegistered = true;

  process.on('unhandledRejection', (reason) => {
    const error =
      reason instanceof Error ? reason : new Error(`UnhandledRejection: ${String(reason)}`);
    logger.error('Unhandled promise rejection in worker process', error);
    Sentry.captureException(error, {
      tags: { stage: 'worker', workers: Array.from(workerNames).join(',') || 'unknown' },
    });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception in worker process', error);
    Sentry.captureException(error, {
      tags: { stage: 'worker', workers: Array.from(workerNames).join(',') || 'unknown' },
      level: 'fatal',
    });
  });
}
