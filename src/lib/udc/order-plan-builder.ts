import { randomUUID } from 'crypto';
import type { SizedSelection, OrderPlan } from './types.js';

/**
 * Builds an immutable OrderPlan from a sized selection.
 * Plan must be persisted before any execution.
 */
export function buildOrderPlan(sized: SizedSelection): OrderPlan {
  return Object.freeze({
    planId: randomUUID(),
    symbol: sized.symbol,
    structure: sized.structure,
    legs: sized.legs.map((leg) => Object.freeze({ ...leg })),
    risk: Object.freeze({
      maxLoss: sized.maxLoss,
    }),
  });
}
