import * as Sentry from '@sentry/node';
import { logger } from '../../utils/logger.js';
import { db } from '../../services/database.service.js';
import { getEngineConfig } from '../config/loader.js';
import {
  GovernorDecision,
  PositionState,
} from '../types/enums.js';
import type {
  TradePlan,
  GovernorResult,
  TradingAccount,
  MarketContext,
} from '../types/index.js';

export interface PortfolioSnapshot {
  positions: PositionExposure[];
  totalEquity: number;
  netDeltaDollars: number;
  netGamma: number;
  totalMaxLoss: number;
  dteConcentration: Map<number, number>;
  underlyingConcentration: Map<string, number>;
  bucketUsage: Map<string, number>;
}

export interface PositionExposure {
  positionId: string;
  underlying: string;
  strategyTag: string;
  delta: number;
  gamma: number;
  contracts: number;
  maxLoss: number;
  dte: number;
  underlyingPrice: number;
}

export class PortfolioGovernor {

  /**
   * Evaluate a proposed TradePlan against portfolio risk limits.
   * Returns APPROVE, RESIZE, or REJECT with detailed reasoning.
   */
  async evaluate(
    plan: TradePlan,
    account: TradingAccount,
    marketContext: MarketContext,
    correlationBuckets?: Map<string, string[]>
  ): Promise<GovernorResult> {
    const cfg = getEngineConfig().portfolio;
    const reasonCodes: string[] = [];
    let sizeMultiplier = 1.0;

    // 1. Build current portfolio snapshot
    const snapshot = await this.buildPortfolioSnapshot(account.id, marketContext.underlyingPrice);

    // 2. Compute proposed exposure
    const proposed = this.computeProposedExposure(plan, marketContext.underlyingPrice);

    // 3. Net delta check
    const projectedNetDeltaDollars = snapshot.netDeltaDollars + proposed.deltaExposureDollars;
    const deltaCapDollars = account.totalEquity * cfg.maxNetDeltaPct;

    if (Math.abs(projectedNetDeltaDollars) > deltaCapDollars) {
      const ratio = deltaCapDollars / Math.abs(projectedNetDeltaDollars);
      if (ratio < 0.5) {
        reasonCodes.push('NET_DELTA_EXCEEDED');
        return this.buildResult(GovernorDecision.REJECT, reasonCodes, 0, snapshot, proposed, 0);
      }
      sizeMultiplier = Math.min(sizeMultiplier, ratio);
      reasonCodes.push('NET_DELTA_RESIZED');
    }

    // 4. Shock simulation ±2%
    const shockLoss = this.simulateShock(snapshot, proposed, marketContext.underlyingPrice);
    const shockCapDollars = account.totalEquity * cfg.maxShockLossPct;

    if (Math.abs(shockLoss) > shockCapDollars) {
      const ratio = shockCapDollars / Math.abs(shockLoss);
      if (ratio < 0.5) {
        reasonCodes.push('SHOCK_LOSS_EXCEEDED');
        return this.buildResult(GovernorDecision.REJECT, reasonCodes, 0, snapshot, proposed, shockLoss);
      }
      sizeMultiplier = Math.min(sizeMultiplier, ratio);
      reasonCodes.push('SHOCK_LOSS_RESIZED');
    }

    // 6. Underlying concentration
    const currentUnderlyingRisk = snapshot.underlyingConcentration.get(plan.underlying) ?? 0;
    const proposedUnderlyingRisk = currentUnderlyingRisk + plan.riskModel.maxLossTotal;
    const underlyingCap = account.totalEquity * cfg.maxUnderlyingRiskPct;

    if (proposedUnderlyingRisk > underlyingCap) {
      reasonCodes.push('UNDERLYING_CONCENTRATION_EXCEEDED');
      return this.buildResult(GovernorDecision.REJECT, reasonCodes, 0, snapshot, proposed, shockLoss);
    }

    // 7. DTE concentration
    const planMinDTE = Math.min(...plan.legs.map(l => l.dte));
    const dteBucket = Math.floor(planMinDTE / 7) * 7; // bucket by week
    const currentDTERisk = snapshot.dteConcentration.get(dteBucket) ?? 0;
    const proposedDTERisk = currentDTERisk + plan.riskModel.maxLossTotal;
    const dteCap = snapshot.totalMaxLoss > 0
      ? (proposedDTERisk / (snapshot.totalMaxLoss + plan.riskModel.maxLossTotal))
      : 0;

    if (dteCap > cfg.maxDTEConcentrationPct) {
      reasonCodes.push('DTE_CONCENTRATION_EXCEEDED');
      return this.buildResult(GovernorDecision.REJECT, reasonCodes, 0, snapshot, proposed, shockLoss);
    }

    // 8. Underlying liquidity regime check
    const liquidityRatio = marketContext.underlyingVolume > 0
      ? marketContext.underlyingVolume / marketContext.avgVolume30D
      : 0;

    if (liquidityRatio < cfg.underlyingLiquidityRejectPct) {
      reasonCodes.push('UNDERLYING_ILLIQUID_REJECT');
      return this.buildResult(GovernorDecision.REJECT, reasonCodes, 0, snapshot, proposed, shockLoss, liquidityRatio);
    }

    if (liquidityRatio < cfg.underlyingLiquidityFloorPct) {
      sizeMultiplier = Math.min(sizeMultiplier, 0.5);
      reasonCodes.push('UNDERLYING_ILLIQUID_RESIZE');
    }

    // 9. Correlation bucket risk (if dynamic buckets provided)
    if (correlationBuckets) {
      const bucketCheck = this.checkCorrelationBucketRisk(
        plan, snapshot, correlationBuckets, account.totalEquity, cfg.maxCorrelationBucketRiskPct
      );
      if (bucketCheck.exceeded) {
        reasonCodes.push('CORRELATION_BUCKET_EXCEEDED');
        return this.buildResult(GovernorDecision.REJECT, reasonCodes, 0, snapshot, proposed, shockLoss, liquidityRatio);
      }
    }

    // 10. Determine final decision
    const decision = sizeMultiplier < 1.0 ? GovernorDecision.RESIZE : GovernorDecision.APPROVE;
    if (decision === GovernorDecision.APPROVE) {
      reasonCodes.push('ALL_CHECKS_PASSED');
    }

    return this.buildResult(decision, reasonCodes, sizeMultiplier, snapshot, proposed, shockLoss, liquidityRatio);
  }

  // ─── Portfolio Snapshot Building ───

  async buildPortfolioSnapshot(accountId: string, currentUnderlyingPrice: number): Promise<PortfolioSnapshot> {
    const result = await db.query(
      `SELECT p.*, tp.underlying, tp.strategy_tag, tp.contracts, tp.structure
       FROM oe_positions p
       JOIN oe_trade_plans tp ON p.trade_plan_id = tp.trade_plan_id
       WHERE p.account_id = $1 AND p.state IN ($2, $3, $4)`,
      [accountId, PositionState.OPEN, PositionState.PARTIALLY_FILLED, PositionState.EXIT_PENDING]
    );

    const positions: PositionExposure[] = [];
    let netDeltaDollars = 0;
    let netGamma = 0;
    let totalMaxLoss = 0;
    const dteConcentration = new Map<number, number>();
    const underlyingConcentration = new Map<string, number>();
    const bucketUsage = new Map<string, number>();

    // Fetch legs for each position's trade plan to get greek exposure
    for (const row of result.rows) {
      const legsResult = await db.query(
        `SELECT * FROM oe_trade_plan_legs WHERE trade_plan_id = $1`,
        [row.trade_plan_id]
      );

      const contracts = parseInt(row.contracts) || row.entry_filled_qty || 1;
      let posDelta = 0;
      let posGamma = 0;
      let minDTE = Infinity;

      for (const leg of legsResult.rows) {
        const legDelta = parseFloat(leg.delta) || 0;
        const legGamma = parseFloat(leg.gamma) || 0;
        const legDTE = parseInt(leg.dte) || 0;
        const multiplier = leg.leg_role === 'SHORT' ? -1 : 1;

        posDelta += multiplier * legDelta * contracts * 100;
        posGamma += multiplier * legGamma * contracts * 100;
        if (legDTE < minDTE) minDTE = legDTE;
      }

      const deltaExposureDollars = posDelta * currentUnderlyingPrice;
      const maxLoss = Math.abs(parseFloat(row.entry_avg_price || '0')) * contracts * 100;

      netDeltaDollars += deltaExposureDollars;
      netGamma += posGamma;
      totalMaxLoss += maxLoss;

      // DTE concentration (bucket by week)
      const dteBucket = Math.floor(minDTE / 7) * 7;
      dteConcentration.set(dteBucket, (dteConcentration.get(dteBucket) ?? 0) + maxLoss);

      // Underlying concentration
      const underlying = row.underlying;
      underlyingConcentration.set(underlying, (underlyingConcentration.get(underlying) ?? 0) + maxLoss);

      // Bucket usage
      const tag = row.strategy_tag;
      bucketUsage.set(tag, (bucketUsage.get(tag) ?? 0) + maxLoss);

      positions.push({
        positionId: row.position_id,
        underlying,
        strategyTag: tag,
        delta: posDelta,
        gamma: posGamma,
        contracts,
        maxLoss,
        dte: minDTE === Infinity ? 0 : minDTE,
        underlyingPrice: currentUnderlyingPrice,
      });
    }

    // Get account equity
    const accountResult = await db.query(
      'SELECT total_equity FROM oe_trading_accounts WHERE id = $1',
      [accountId]
    );
    const totalEquity = accountResult.rows.length > 0
      ? parseFloat(accountResult.rows[0].total_equity)
      : 0;

    return {
      positions,
      totalEquity,
      netDeltaDollars,
      netGamma,
      totalMaxLoss,
      dteConcentration,
      underlyingConcentration,
      bucketUsage,
    };
  }

  // ─── Proposed Exposure Computation ───

  computeProposedExposure(plan: TradePlan, underlyingPrice: number): {
    deltaExposureDollars: number;
    gammaExposure: number;
    maxLoss: number;
  } {
    let totalDelta = 0;
    let totalGamma = 0;

    for (const leg of plan.legs) {
      const multiplier = leg.legRole === 'SHORT' ? -1 : 1;
      totalDelta += multiplier * leg.delta * plan.contracts * 100;
      totalGamma += multiplier * leg.gamma * plan.contracts * 100;
    }

    return {
      deltaExposureDollars: totalDelta * underlyingPrice,
      gammaExposure: totalGamma,
      maxLoss: plan.riskModel.maxLossTotal,
    };
  }

  // ─── Shock Simulation ±2% ───

  simulateShock(
    snapshot: PortfolioSnapshot,
    proposed: { deltaExposureDollars: number; gammaExposure: number },
    underlyingPrice: number
  ): number {
    const shockPct = 0.02;
    const priceMove = underlyingPrice * shockPct;

    // Portfolio delta-gamma approximation for worst-case shock direction
    const totalDelta = snapshot.netDeltaDollars + proposed.deltaExposureDollars;
    const totalGamma = snapshot.netGamma + proposed.gammaExposure;

    // P&L ≈ delta * ΔS + 0.5 * gamma * (ΔS)²
    // Test both directions, take worst case
    const pnlUp = totalDelta * shockPct + 0.5 * totalGamma * (priceMove ** 2);
    const pnlDown = -totalDelta * shockPct + 0.5 * totalGamma * (priceMove ** 2);

    // Worst case loss (most negative)
    return Math.min(pnlUp, pnlDown);
  }

  // ─── Correlation Bucket Risk ───

  private checkCorrelationBucketRisk(
    plan: TradePlan,
    snapshot: PortfolioSnapshot,
    correlationBuckets: Map<string, string[]>,
    totalEquity: number,
    maxBucketRiskPct: number
  ): { exceeded: boolean; bucketRisk: number; cap: number } {
    // Find which bucket the new plan's underlying belongs to
    let targetBucket: string | null = null;
    for (const [bucketId, tickers] of correlationBuckets.entries()) {
      if (tickers.includes(plan.underlying)) {
        targetBucket = bucketId;
        break;
      }
    }

    if (!targetBucket) {
      return { exceeded: false, bucketRisk: 0, cap: totalEquity * maxBucketRiskPct };
    }

    const buckeTickers = correlationBuckets.get(targetBucket) ?? [];

    // Sum existing risk in this bucket
    let bucketRisk = plan.riskModel.maxLossTotal;
    for (const pos of snapshot.positions) {
      if (buckeTickers.includes(pos.underlying)) {
        bucketRisk += pos.maxLoss;
      }
    }

    const totalRisk = snapshot.totalMaxLoss + plan.riskModel.maxLossTotal;
    const bucketRiskPct = totalRisk > 0 ? bucketRisk / totalRisk : 0;

    return {
      exceeded: bucketRiskPct > maxBucketRiskPct,
      bucketRisk,
      cap: totalEquity * maxBucketRiskPct,
    };
  }

  // ─── Result Builder ───

  private buildResult(
    decision: GovernorDecision,
    reasonCodes: string[],
    sizeMultiplier: number,
    snapshot: PortfolioSnapshot,
    proposed: { deltaExposureDollars: number; gammaExposure: number },
    shockLoss: number,
    liquidityRatio: number = 1.0
  ): GovernorResult {
    const result: GovernorResult = {
      decision,
      reasonCodes,
      sizeMultiplier,
      netDeltaDollars: snapshot.netDeltaDollars + proposed.deltaExposureDollars,
      netGamma: snapshot.netGamma + proposed.gammaExposure,
      projectedShockLoss: shockLoss,
      underlyingLiquidityRatio: liquidityRatio,
    };

    if (decision === GovernorDecision.REJECT) {
      Sentry.addBreadcrumb({
        category: 'engine',
        message: `Trade rejected by governor: ${reasonCodes.join(', ')}`,
        level: 'warning',
        data: { decision, reasonCodes, sizeMultiplier, shockLoss, liquidityRatio },
      });
    }

    logger.info('Governor evaluation', {
      decision,
      reasonCodes,
      sizeMultiplier,
      netDeltaDollars: result.netDeltaDollars,
      shockLoss,
    });

    return result;
  }
}

export const portfolioGovernor = new PortfolioGovernor();
