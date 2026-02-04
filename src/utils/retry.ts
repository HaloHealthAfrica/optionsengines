import { logger } from './logger.js';
import { sleep } from './sleep.js';

export type RetryOptions = {
  retries: number;
  baseDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
};

export async function retry<T>(
  operation: () => Promise<T>,
  { retries, baseDelayMs = 1000, sleepFn = sleep, onRetry }: RetryOptions
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }
      attempt += 1;
      const delayMs = Math.pow(2, attempt) * baseDelayMs;
      onRetry?.(error, attempt, delayMs);
      logger.warn('Retrying operation after error', { attempt, delayMs });
      await sleepFn(delayMs);
    }
  }
}
