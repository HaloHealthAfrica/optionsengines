/**
 * Provider Error Classification Layer
 * Classifies provider responses to avoid retrying non-retryable errors
 * and to handle empty/partial data gracefully.
 */

export type ProviderErrorType =
  | 'TRANSIENT' // Retry: 500, timeout, network
  | 'RATE_LIMIT' // 429 - do not retry
  | 'ENTITLEMENT' // 403 NOT_AUTHORIZED, subscription - disable provider temporarily
  | 'EMPTY_DATA' // 404 {s:no_data} - return [] or valid empty
  | 'PARTIAL_DATA' // Missing bp/ap - return null, do not throw
  | 'NOT_FOUND' // 404 - do not retry
  | 'UNKNOWN';

export interface ClassifiedError {
  type: ProviderErrorType;
  retryable: boolean;
  disableProvider?: boolean;
}

/**
 * Extract HTTP status from an error message or Error object
 */
function extractStatus(error: unknown): number | null {
  if (error instanceof Error) {
    const match = error.message.match(/ (\d{3}) /) || error.message.match(/(\d{3})/);
    if (match) return parseInt(match[1], 10);
    if (error.message.includes('NOT_AUTHORIZED') || error.message.includes('403')) return 403;
    if (error.message.includes('429')) return 429;
    if (error.message.includes('404')) return 404;
    if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) return 504;
  }
  return null;
}

/**
 * Check if error indicates "no_data" (valid empty state)
 */
function isNoDataError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('"s":"no_data"') ||
      msg.includes('{"s":"no_data"}') ||
      msg.includes('s: \'no_data\'') ||
      msg.includes('no_data')
    );
  }
  return false;
}

/**
 * Check if error indicates entitlement/subscription issue
 */
function isEntitlementError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes('not_authorized') ||
      msg.includes('not authorized') ||
      msg.includes('subscription does not permit') ||
      msg.includes('only one device is permitted')
    );
  }
  return false;
}

/**
 * Classify a provider error to determine retry behavior and handling
 */
export function classifyProviderError(error: unknown): ClassifiedError {
  const status = extractStatus(error);

  if (status === 429) {
    return { type: 'RATE_LIMIT', retryable: false };
  }

  if (status === 403 && isEntitlementError(error)) {
    return { type: 'ENTITLEMENT', retryable: false, disableProvider: true };
  }

  if (status === 403) {
    return { type: 'ENTITLEMENT', retryable: false };
  }

  if (status === 404) {
    if (isNoDataError(error)) {
      return { type: 'EMPTY_DATA', retryable: false };
    }
    return { type: 'NOT_FOUND', retryable: false };
  }

  if (status === 401) {
    return { type: 'ENTITLEMENT', retryable: false };
  }

  if (status !== null && status >= 500) {
    return { type: 'TRANSIENT', retryable: true };
  }

  if (error instanceof Error) {
    if (
      error.message.includes('timeout') ||
      error.message.includes('ETIMEDOUT') ||
      error.message.includes('ECONNRESET') ||
      error.message.includes('ENOTFOUND') ||
      error.message.includes('network')
    ) {
      return { type: 'TRANSIENT', retryable: true };
    }
  }

  return { type: 'UNKNOWN', retryable: false };
}

/**
 * Retry only if the error is TRANSIENT
 */
export function shouldRetryProviderError(error: unknown): boolean {
  const classified = classifyProviderError(error);
  return classified.retryable;
}
