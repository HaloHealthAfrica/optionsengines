import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger.js';
import { db } from '../../services/database.service.js';
import { getEngineConfig } from '../config/loader.js';
import { attributionEngine } from './AttributionEngine.js';

export interface StrategyWeight {
  id: string;
  accountId: string;
  strategyTag: string;
  weight: number;
  sampleCount: number;
  winRate: number | null;
  avgPnl: number | null;
  edgeScore: number | null;
  lastUpdated: Date;
  cooldownRemaining: number;
}

export interface WeightAdjustment {
  strategyTag: string;
  fromWeight: number;
  toWeight: number;
  reason: string;
  sampleCount: number;
  winRate: number | null;
  avgPnl: number | null;
}

export class MetaLearner {

  /**
   * Get current weight for a strategy. Returns 1.0 if not yet tracked.
   */
  async getWeight(accountId: string, strategyTag: string): Promise<number> {
    const result = await db.query(
      `SELECT weight, cooldown_remaining FROM oe_strategy_weights
       WHERE account_id = $1 AND strategy_tag = $2`,
      [accountId, strategyTag]
    );

    if (result.rows.length === 0) return 1.0;

    return parseFloat(result.rows[0].weight);
  }

  /**
   * Get all strategy weights for an account.
   */
  async getAllWeights(accountId: string): Promise<StrategyWeight[]> {
    const result = await db.query(
      `SELECT * FROM oe_strategy_weights WHERE account_id = $1 ORDER BY strategy_tag`,
      [accountId]
    );

    return result.rows.map(this.mapRow);
  }

  /**
   * Run the meta-learning cycle for all strategies in an account.
   * Evaluates attribution data and adjusts weights accordingly.
   */
  async runLearningCycle(accountId: string): Promise<WeightAdjustment[]> {
    const cfg = getEngineConfig().metaLearner;
    const adjustments: WeightAdjustment[] = [];

    // Get all distinct strategies with attribution data
    const strategiesResult = await db.query(
      `SELECT DISTINCT strategy_tag FROM oe_attribution_rows
       WHERE account_id = $1 AND realized_pnl IS NOT NULL`,
      [accountId]
    );

    for (const row of strategiesResult.rows) {
      const strategyTag = row.strategy_tag as string;
      const adjustment = await this.evaluateStrategy(accountId, strategyTag, cfg);
      if (adjustment) {
        adjustments.push(adjustment);
      }
    }

    if (adjustments.length > 0) {
      logger.info('Meta-learning cycle complete', {
        accountId,
        adjustmentCount: adjustments.length,
        adjustments: adjustments.map(a => ({ tag: a.strategyTag, from: a.fromWeight, to: a.toWeight })),
      });
    }

    return adjustments;
  }

  /**
   * Evaluate a single strategy and adjust weight if needed.
   */
  private async evaluateStrategy(
    accountId: string,
    strategyTag: string,
    cfg: {
      minSampleCount: number;
      degradationThreshold: number;
      adjustmentFactor: number;
      cooldownTrades: number;
      weightFloor: number;
      weightCeiling: number;
    }
  ): Promise<WeightAdjustment | null> {
    const performance = await attributionEngine.getStrategyPerformance(accountId, strategyTag);

    if (performance.sampleCount < cfg.minSampleCount) {
      return null;
    }

    const currentWeight = await this.getWeight(accountId, strategyTag);

    // Check cooldown
    const cooldown = await this.getCooldownRemaining(accountId, strategyTag);
    if (cooldown > 0) {
      await this.decrementCooldown(accountId, strategyTag);
      return null;
    }

    // Detect edge decay
    const decay = await attributionEngine.detectEdgeDecay(
      accountId, strategyTag, 20, cfg.degradationThreshold
    );

    let newWeight = currentWeight;
    let reason = '';

    if (decay.decaying) {
      // Reduce weight
      newWeight = currentWeight * cfg.adjustmentFactor;
      reason = `Edge decay: recent WR ${(decay.recentWinRate * 100).toFixed(1)}% vs overall ${(decay.overallWinRate * 100).toFixed(1)}%`;
    } else if (performance.edgeScore > 0.7 && currentWeight < 1.0) {
      // Recovery: edge is strong, gradually restore weight
      newWeight = Math.min(currentWeight * (1 + (1 - cfg.adjustmentFactor)), cfg.weightCeiling);
      reason = `Edge recovery: score ${performance.edgeScore.toFixed(3)}, restoring weight`;
    } else {
      return null;
    }

    // Enforce floor/ceiling
    newWeight = Math.max(cfg.weightFloor, Math.min(cfg.weightCeiling, newWeight));

    // Skip trivial adjustments
    if (Math.abs(newWeight - currentWeight) < 0.01) {
      return null;
    }

    // Persist
    await this.upsertWeight(accountId, strategyTag, newWeight, performance, cfg.cooldownTrades);
    await this.logWeightChange(accountId, strategyTag, currentWeight, newWeight, reason, performance);

    return {
      strategyTag,
      fromWeight: currentWeight,
      toWeight: newWeight,
      reason,
      sampleCount: performance.sampleCount,
      winRate: performance.winRate,
      avgPnl: performance.avgPnl,
    };
  }

  // ─── Persistence ───

  private async upsertWeight(
    accountId: string,
    strategyTag: string,
    weight: number,
    performance: { sampleCount: number; winRate: number; avgPnl: number; edgeScore: number },
    cooldownTrades: number
  ): Promise<void> {
    await db.query(
      `INSERT INTO oe_strategy_weights (id, account_id, strategy_tag, weight, sample_count, win_rate, avg_pnl, edge_score, cooldown_remaining)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (account_id, strategy_tag) DO UPDATE SET
         weight = EXCLUDED.weight,
         sample_count = EXCLUDED.sample_count,
         win_rate = EXCLUDED.win_rate,
         avg_pnl = EXCLUDED.avg_pnl,
         edge_score = EXCLUDED.edge_score,
         cooldown_remaining = EXCLUDED.cooldown_remaining,
         last_updated = NOW()`,
      [randomUUID(), accountId, strategyTag, weight, performance.sampleCount,
       performance.winRate, performance.avgPnl, performance.edgeScore, cooldownTrades]
    );
  }

  private async logWeightChange(
    accountId: string,
    strategyTag: string,
    fromWeight: number,
    toWeight: number,
    reason: string,
    performance: { sampleCount: number; winRate: number; avgPnl: number }
  ): Promise<void> {
    await db.query(
      `INSERT INTO oe_strategy_weights_log (id, account_id, strategy_tag, from_weight, to_weight, reason, sample_count, win_rate, avg_pnl)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [randomUUID(), accountId, strategyTag, fromWeight, toWeight, reason,
       performance.sampleCount, performance.winRate, performance.avgPnl]
    );
  }

  private async getCooldownRemaining(accountId: string, strategyTag: string): Promise<number> {
    const result = await db.query(
      `SELECT cooldown_remaining FROM oe_strategy_weights
       WHERE account_id = $1 AND strategy_tag = $2`,
      [accountId, strategyTag]
    );

    if (result.rows.length === 0) return 0;
    return parseInt(result.rows[0].cooldown_remaining) || 0;
  }

  private async decrementCooldown(accountId: string, strategyTag: string): Promise<void> {
    await db.query(
      `UPDATE oe_strategy_weights SET cooldown_remaining = GREATEST(0, cooldown_remaining - 1)
       WHERE account_id = $1 AND strategy_tag = $2`,
      [accountId, strategyTag]
    );
  }

  private mapRow(row: Record<string, unknown>): StrategyWeight {
    return {
      id: row.id as string,
      accountId: row.account_id as string,
      strategyTag: row.strategy_tag as string,
      weight: parseFloat(row.weight as string),
      sampleCount: parseInt(row.sample_count as string),
      winRate: row.win_rate !== null ? parseFloat(row.win_rate as string) : null,
      avgPnl: row.avg_pnl !== null ? parseFloat(row.avg_pnl as string) : null,
      edgeScore: row.edge_score !== null ? parseFloat(row.edge_score as string) : null,
      lastUpdated: new Date(row.last_updated as string),
      cooldownRemaining: parseInt(row.cooldown_remaining as string) || 0,
    };
  }
}

export const metaLearner = new MetaLearner();
