import { logger } from './logger.js';
import { sleep } from './sleep.js';
import { shouldRetryProviderError } from '../services/provider-error-classifier.js';

export type RetryOptions = {
  retries: number;
  baseDelayMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
  /** When true, only retry TRANSIENT errors (5xx, timeout). Do not retry 401/403/404/429. */
  providerAware?: boolean;
};

export async function retry<T>(
  operation: () => Promise<T>,
  { retries, baseDelayMs = 1000, sleepFn = sleep, onRetry, providerAware = false }: RetryOptions
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      const shouldRetry =
        attempt < retries &&
        (!providerAware || shouldRetryProviderError(error));

      if (!shouldRetry) {
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
