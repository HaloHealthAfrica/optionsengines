// Strategy Router - deterministic hashing for A/B routing
import crypto from 'crypto';
import { db } from './database.service.js';
import { config } from '../config/index.js';
import { featureFlags } from './feature-flag.service.js';

export interface RoutingSignal {
  signalId: string;
  symbol: string;
  timeframe: string;
  sessionId: string;
}

export interface RoutingDecision {
  experimentId: string;
  variant: 'A' | 'B';
  assignmentHash: string;
  splitPercentage: number;
  assignmentReason: string;
}

export function computeDeterministicHash(
  symbol: string,
  timeframe: string,
  sessionId: string
): string {
  const input = `${symbol}:${timeframe}:${sessionId}`;
  return crypto.createHash('sha256').update(input).digest('hex');
}

function hashToBucket(hash: string): number {
  const slice = hash.slice(0, 8);
  return parseInt(slice, 16) % 100;
}

export class StrategyRouter {
  async route(signal: RoutingSignal): Promise<RoutingDecision> {
    const assignmentHash = computeDeterministicHash(
      signal.symbol,
      signal.timeframe,
      signal.sessionId
    );

    const variantBEnabled = featureFlags.isEnabled('enable_variant_b');
    const splitPercentage = variantBEnabled ? config.abSplitPercentage : 0;
    const bucket = hashToBucket(assignmentHash);
    const variant: 'A' | 'B' = bucket < splitPercentage ? 'B' : 'A';
    const assignmentReason = variantBEnabled ? 'hash_split' : 'variant_b_disabled';

    const result = await db.query(
      `INSERT INTO experiments (signal_id, variant, assignment_hash, split_percentage)
       VALUES ($1, $2, $3, $4)
       RETURNING experiment_id`,
      [signal.signalId, variant, assignmentHash, splitPercentage]
    );

    return {
      experimentId: result.rows[0].experiment_id,
      variant,
      assignmentHash,
      splitPercentage,
      assignmentReason,
    };
  }
}

export const strategyRouter = new StrategyRouter();
