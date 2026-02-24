import { createHash } from 'crypto';

/**
 * Deterministic decision ID: SHA-256 hash of (signalId + strategy + horizon + setupType).
 * Guarantees idempotency — replaying the same signal with the same strategy
 * produces the same decisionId, preventing duplicate rows.
 */
export function buildDecisionId(
  signalId: string,
  strategy: string,
  horizon: string,
  setupType: string,
): string {
  const input = `${signalId}|${strategy}|${horizon}|${setupType}`;
  return createHash('sha256').update(input).digest('hex').slice(0, 40);
}
