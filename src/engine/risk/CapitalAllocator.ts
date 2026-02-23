import { logger } from '../../utils/logger.js';
import { db } from '../../services/database.service.js';
import { getEngineConfig } from '../config/loader.js';
import { RejectionCode, PositionState } from '../types/enums.js';
import type { TradePlan, TradingAccount } from '../types/index.js';

export interface AllocationResult {
  allowed: boolean;
  rejectionCode: RejectionCode | null;
  reason: string | null;
  allocatedBucket: string;
  bucketUsageBefore: number;
  bucketCapacity: number;
  sizeMultiplier: number;
  taperingLevel: number;
}

export interface BucketStatus {
  bucket: string;
  usedRisk: number;
  capacityRisk: number;
  usagePct: number;
  remaining: number;
}

export class CapitalAllocator {

  /**
   * Validate that a trade plan fits within its bucket allocation and tapering limits.
   */
  async evaluate(
    plan: TradePlan,
    account: TradingAccount
  ): Promise<AllocationResult> {
    const cfg = getEngineConfig();
    const bucketLimits = cfg.buckets;
    const taperingCfg = cfg.tapering;

    const bucket = this.mapStrategyToBucket(plan.strategyTag);
    const bucketPct = bucketLimits[bucket];

    if (bucketPct === undefined) {
      logger.warn('Unknown bucket for strategy', { strategyTag: plan.strategyTag, bucket });
      return {
        allowed: false,
        rejectionCode: RejectionCode.BUCKET_EXHAUSTED,
        reason: `No bucket allocation defined for strategy "${plan.strategyTag}" (bucket: ${bucket})`,
        allocatedBucket: bucket,
        bucketUsageBefore: 0,
        bucketCapacity: 0,
        sizeMultiplier: 0,
        taperingLevel: 0,
      };
    }

    // 1. Compute current bucket usage from open positions
    const currentUsage = await this.computeBucketUsage(account.id);
    const bucketUsed = currentUsage.get(bucket) ?? 0;
    const bucketCapacity = account.totalEquity * bucketPct;
    const proposedRisk = plan.riskModel.maxLossTotal;

    // 2. Check if trade fits in bucket
    if (bucketUsed + proposedRisk > bucketCapacity) {
      return {
        allowed: false,
        rejectionCode: RejectionCode.BUCKET_EXHAUSTED,
        reason: `Bucket "${bucket}" exhausted: used=$${bucketUsed.toFixed(0)} + proposed=$${proposedRisk.toFixed(0)} > capacity=$${bucketCapacity.toFixed(0)}`,
        allocatedBucket: bucket,
        bucketUsageBefore: bucketUsed,
        bucketCapacity,
        sizeMultiplier: 0,
        taperingLevel: 0,
      };
    }

    // 3. Apply tapering based on drawdown
    let sizeMultiplier = 1.0;
    let taperingLevel = 0;

    const drawdownPct = this.computeDrawdownPct(account);

    if (drawdownPct >= taperingCfg.level2DrawdownPct) {
      if (taperingCfg.level2FreezeEntries) {
        return {
          allowed: false,
          rejectionCode: RejectionCode.INSUFFICIENT_CAPITAL,
          reason: `Level 2 tapering: drawdown ${(drawdownPct * 100).toFixed(1)}% >= ${(taperingCfg.level2DrawdownPct * 100).toFixed(0)}% — entries frozen`,
          allocatedBucket: bucket,
          bucketUsageBefore: bucketUsed,
          bucketCapacity,
          sizeMultiplier: 0,
          taperingLevel: 2,
        };
      }
      taperingLevel = 2;
    } else if (drawdownPct >= taperingCfg.level1DrawdownPct) {
      sizeMultiplier = taperingCfg.level1SizeMultiplier;
      taperingLevel = 1;
    }

    // 4. Verify tapered size still fits in bucket
    const taperedRisk = proposedRisk * sizeMultiplier;
    if (bucketUsed + taperedRisk > bucketCapacity) {
      return {
        allowed: false,
        rejectionCode: RejectionCode.BUCKET_EXHAUSTED,
        reason: `Bucket "${bucket}" exhausted after tapering: used=$${bucketUsed.toFixed(0)} + tapered=$${taperedRisk.toFixed(0)} > capacity=$${bucketCapacity.toFixed(0)}`,
        allocatedBucket: bucket,
        bucketUsageBefore: bucketUsed,
        bucketCapacity,
        sizeMultiplier,
        taperingLevel,
      };
    }

    logger.info('Capital allocation approved', {
      bucket,
      bucketUsed,
      bucketCapacity,
      proposedRisk,
      sizeMultiplier,
      taperingLevel,
      drawdownPct,
    });

    return {
      allowed: true,
      rejectionCode: null,
      reason: null,
      allocatedBucket: bucket,
      bucketUsageBefore: bucketUsed,
      bucketCapacity,
      sizeMultiplier,
      taperingLevel,
    };
  }

  /**
   * Get a summary of all bucket statuses for an account.
   */
  async getBucketStatuses(accountId: string, totalEquity: number): Promise<BucketStatus[]> {
    const bucketLimits = getEngineConfig().buckets;
    const currentUsage = await this.computeBucketUsage(accountId);

    return Object.entries(bucketLimits).map(([bucket, pct]) => {
      const capacity = totalEquity * pct;
      const used = currentUsage.get(bucket) ?? 0;
      return {
        bucket,
        usedRisk: used,
        capacityRisk: capacity,
        usagePct: capacity > 0 ? used / capacity : 0,
        remaining: Math.max(0, capacity - used),
      };
    });
  }

  // ─── Bucket Usage from Open Positions ───

  private async computeBucketUsage(accountId: string): Promise<Map<string, number>> {
    const result = await db.query(
      `SELECT tp.strategy_tag, SUM(
          CASE WHEN tp.structure IN ('CREDIT_CALL_SPREAD','CREDIT_PUT_SPREAD')
               THEN (ABS(tpl_short.strike - tpl_long.strike) - (tpl_short.mid - tpl_long.mid)) * 100 * tp.contracts
               ELSE tp.contracts * 100 * COALESCE(p.entry_avg_price, 0)
          END
       ) as total_risk
       FROM oe_positions p
       JOIN oe_trade_plans tp ON p.trade_plan_id = tp.trade_plan_id
       LEFT JOIN oe_trade_plan_legs tpl_short ON tpl_short.trade_plan_id = tp.trade_plan_id AND tpl_short.leg_role = 'SHORT'
       LEFT JOIN oe_trade_plan_legs tpl_long ON tpl_long.trade_plan_id = tp.trade_plan_id AND tpl_long.leg_role = 'LONG'
       WHERE p.account_id = $1 AND p.state IN ($2, $3, $4)
       GROUP BY tp.strategy_tag`,
      [accountId, PositionState.OPEN, PositionState.PARTIALLY_FILLED, PositionState.EXIT_PENDING]
    );

    const usage = new Map<string, number>();
    for (const row of result.rows) {
      const bucket = this.mapStrategyToBucket(row.strategy_tag);
      const current = usage.get(bucket) ?? 0;
      usage.set(bucket, current + parseFloat(row.total_risk || '0'));
    }
    return usage;
  }

  // ─── Drawdown ───

  computeDrawdownPct(account: TradingAccount): number {
    if (account.peakEquity <= 0) return 0;
    const drawdown = (account.peakEquity - account.totalEquity) / account.peakEquity;
    return Math.max(0, drawdown);
  }

  // ─── Strategy → Bucket Mapping ───

  mapStrategyToBucket(strategyTag: string): string {
    const tag = strategyTag.toUpperCase();

    if (tag.includes('ORB')) return 'ORB';
    if (tag.includes('GEX')) return 'GEX';
    if (tag.includes('SPREAD') || tag.includes('CREDIT')) return 'Spread';

    return 'Experimental';
  }
}

export const capitalAllocator = new CapitalAllocator();
