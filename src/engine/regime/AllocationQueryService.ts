import { db } from '../../services/database.service.js';
import { regimePolicyEngine } from './RegimePolicyEngine.js';
import type { AllocationSnapshot, RegimeContext, AllocationPolicy } from './RegimePolicyEngine.js';

export interface AllocationStatus {
  hasActivePolicy: boolean;
  latestSnapshot: AllocationSnapshot | null;
  policy: AllocationPolicy | null;
  regimeTag: string | null;
}

export interface TradeAllocationCheck {
  allowed: boolean;
  strategyWeight: number;
  globalSizeMultiplier: number;
  bucketLimit: number;
  denyReason: string | null;
  regimeTag: string;
}

/**
 * Read-only query layer for regime-based allocation.
 * Used by governor, capital allocator, and dashboard.
 */
export class AllocationQueryService {

  /**
   * Get full allocation status for an account.
   */
  async getStatus(accountId: string): Promise<AllocationStatus> {
    const [policy, snapshot] = await Promise.all([
      regimePolicyEngine.getActivePolicy(accountId),
      regimePolicyEngine.getLatestSnapshot(accountId),
    ]);

    return {
      hasActivePolicy: policy !== null && policy.enabled,
      latestSnapshot: snapshot,
      policy,
      regimeTag: snapshot?.regimeTag ?? null,
    };
  }

  /**
   * Check whether a specific trade is allowed under current allocation.
   * Used in the decision pipeline before entry.
   */
  async checkTradeAllocation(
    accountId: string,
    strategyTag: string,
    bucketName: string,
    context: RegimeContext
  ): Promise<TradeAllocationCheck> {
    let snapshot = await regimePolicyEngine.getLatestSnapshot(accountId);

    // If no snapshot or stale (> 1 hour), recompute
    if (!snapshot || this.isSnapshotStale(snapshot)) {
      snapshot = await regimePolicyEngine.evaluate(accountId, context);
    }

    const allowed = regimePolicyEngine.isStrategyAllowed(strategyTag, snapshot);
    const strategyWeight = regimePolicyEngine.getStrategyWeight(strategyTag, snapshot);
    const globalSizeMultiplier = regimePolicyEngine.getGlobalSizeMultiplier(snapshot);
    const bucketLimit = regimePolicyEngine.getBucketLimit(bucketName, snapshot);

    let denyReason: string | null = null;
    if (!allowed) {
      denyReason = `Strategy ${strategyTag} denied by regime policy (${snapshot.regimeTag})`;
    }

    return {
      allowed,
      strategyWeight,
      globalSizeMultiplier,
      bucketLimit,
      denyReason,
      regimeTag: snapshot.regimeTag,
    };
  }

  /**
   * Get allocation history for an account.
   */
  async getHistory(
    accountId: string,
    limit: number = 50
  ): Promise<AllocationSnapshot[]> {
    const result = await db.query(
      `SELECT * FROM oe_allocation_snapshots
       WHERE account_id = $1
       ORDER BY computed_at DESC LIMIT $2`,
      [accountId, limit]
    );

    return result.rows.map(this.mapSnapshotRow);
  }

  /**
   * Get snapshots grouped by regime tag for analytics.
   */
  async getRegimeBreakdown(accountId: string): Promise<{
    regime: string;
    count: number;
    avgGlobalSize: number;
    denyCount: number;
  }[]> {
    const result = await db.query(
      `SELECT
         regime_tag,
         COUNT(*) as count,
         AVG((risk_multipliers->>'globalSize')::decimal) as avg_global_size,
         COUNT(*) FILTER (WHERE array_length(deny_strategies, 1) > 0) as deny_count
       FROM oe_allocation_snapshots
       WHERE account_id = $1
       GROUP BY regime_tag
       ORDER BY count DESC`,
      [accountId]
    );

    return result.rows.map((r: Record<string, unknown>) => ({
      regime: r.regime_tag as string,
      count: parseInt(r.count as string),
      avgGlobalSize: r.avg_global_size !== null ? parseFloat(r.avg_global_size as string) : 1.0,
      denyCount: parseInt(r.deny_count as string),
    }));
  }

  private isSnapshotStale(snapshot: AllocationSnapshot): boolean {
    const ageMs = Date.now() - snapshot.computedAt.getTime();
    return ageMs > 60 * 60 * 1000; // 1 hour
  }

  private mapSnapshotRow(row: Record<string, unknown>): AllocationSnapshot {
    return {
      id: row.id as string,
      accountId: row.account_id as string,
      computedAt: new Date(row.computed_at as string),
      underlying: row.underlying as string | null,
      regimeTag: row.regime_tag as string,
      bucketLimits: row.bucket_limits as Record<string, number>,
      strategyWeightOverrides: row.strategy_weight_overrides as Record<string, number>,
      riskMultipliers: row.risk_multipliers as Record<string, number>,
      denyStrategies: row.deny_strategies as string[],
      confidence: parseFloat(row.confidence as string),
      source: row.source as string,
      notes: row.notes as string | null,
    };
  }
}

export const allocationQueryService = new AllocationQueryService();
