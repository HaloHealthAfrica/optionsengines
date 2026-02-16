/**
 * Advanced Strike Selection Bridge
 *
 * Connects the advanced strike selection framework (delta targeting, DTE policy,
 * liquidity filters, Greeks scoring, GEX suitability) to the engine invokers.
 *
 * Flow:
 *   1. Fetch live option chain via MarketData.app (with UW fallback)
 *   2. Adapt rows → OptionContract[] (with BS-approximated Greeks)
 *   3. Build StrikeSelectionInput from signal context, enrichment, MTF bias hints
 *   4. Run selectStrike() from the advanced framework
 *   5. Return strike, expiration, optionType, entryPrice, and audit metadata
 *
 * Feature-gated behind ENABLE_ADVANCED_STRIKE_SELECTION (default: false).
 * Falls back to the simple selectStrike() on failure so the pipeline never blocks.
 */

import { selectStrike as advancedSelectStrike } from '../lib/strikeSelection/index.js';
import type { StrikeSelectionInput, StrikeSelectionOutput, OptionContract } from '../lib/strikeSelection/types.js';
import type { SetupType, RegimeType, GEXState } from '../lib/shared/types.js';
import { adaptOptionChain } from './option-chain-adapter.service.js';
import { marketData } from './market-data.js';
import { getStrikeSelectionHint, type StrikeSelectionHint } from './mtf-bias/strike-selection-adapter.service.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import * as Sentry from '@sentry/node';

export interface AdvancedStrikeResult {
  strike: number;
  expiration: Date;
  optionType: 'call' | 'put';
  entryPrice: number;
  advanced: true;
  scores?: StrikeSelectionOutput['scores'];
  guardrails?: StrikeSelectionOutput['guardrails'];
  rationale?: string[];
}

/**
 * Derive SetupType from signal timeframe.
 * Intraday (<=15m) → SCALP_GUARDED, daily/4h → SWING, weekly → POSITION, monthly → LEAPS
 */
function deriveSetupType(timeframe: string): SetupType {
  const tf = timeframe.toLowerCase();
  if (tf.includes('1m') || tf.includes('3m') || tf.includes('5m') || tf.includes('15m') || tf === 'scalp') {
    return 'SCALP_GUARDED';
  }
  if (tf.includes('30m') || tf.includes('1h') || tf.includes('4h') || tf.includes('d') || tf === 'swing') {
    return 'SWING';
  }
  if (tf.includes('w') || tf === 'position') {
    return 'POSITION';
  }
  if (tf.includes('m') && (tf.includes('month') || parseInt(tf) > 30)) {
    return 'LEAPS';
  }
  return 'SWING'; // safe default
}

/**
 * Map enrichment/bias regime string to the RegimeType enum.
 */
function mapRegime(regime?: string): RegimeType {
  const map: Record<string, RegimeType> = {
    TREND: 'BULL',
    STRONG_TREND: 'STRONG_BULL',
    COUNTER_TREND: 'BEAR',
    RANGE: 'NEUTRAL',
    BREAKOUT: 'BREAKOUT',
    BREAKDOWN: 'BREAKDOWN',
    CHOPPY: 'CHOPPY',
    STRONG_BULL: 'STRONG_BULL',
    BULL: 'BULL',
    NEUTRAL: 'NEUTRAL',
    BEAR: 'BEAR',
    STRONG_BEAR: 'STRONG_BEAR',
  };
  return map[regime?.toUpperCase() ?? ''] ?? 'NEUTRAL';
}

/**
 * Map enrichment GEX data to GEXState enum.
 */
function mapGexState(gammaContext?: Record<string, unknown>): GEXState {
  const regime = (gammaContext?.regime as string)?.toUpperCase();
  if (regime === 'LONG_GAMMA' || regime === 'POSITIVE_HIGH') return 'POSITIVE_HIGH';
  if (regime === 'SHORT_GAMMA' || regime === 'NEGATIVE_HIGH') return 'NEGATIVE_HIGH';
  if (regime === 'POSITIVE_LOW') return 'POSITIVE_LOW';
  if (regime === 'NEGATIVE_LOW') return 'NEGATIVE_LOW';
  return 'NEUTRAL';
}

/**
 * Derive expected hold time in minutes from setupType.
 */
function expectedHoldMinutes(setupType: SetupType): number {
  switch (setupType) {
    case 'SCALP_GUARDED': return 60;
    case 'SWING': return 5 * 24 * 60;
    case 'POSITION': return 30 * 24 * 60;
    case 'LEAPS': return 180 * 24 * 60;
  }
}

/**
 * Apply MTF bias hints to override delta/DTE ranges when available.
 * The hint narrows the search space based on confidence and regime.
 */
function applyBiasHint(
  chain: OptionContract[],
  hint: StrikeSelectionHint
): OptionContract[] {
  return chain.filter(c => {
    const absDelta = Math.abs(c.greeks.delta);
    return absDelta >= hint.deltaMin && absDelta <= hint.deltaMax &&
           c.dte >= hint.dteMin && c.dte <= hint.dteMax;
  });
}

/**
 * Run the advanced strike selection pipeline.
 * Returns null when the advanced framework cannot produce a result
 * (caller should fall back to the simple path).
 */
export async function advancedStrikeSelect(
  symbol: string,
  direction: 'long' | 'short',
  timeframe: string,
  enrichment?: {
    enrichedData?: Record<string, unknown>;
    gammaContext?: Record<string, unknown>;
    gammaDecision?: { regime: string; [k: string]: unknown };
    riskResult?: Record<string, unknown>;
  },
  mtfBiasState?: { confidence_score: number; regime_type: string; [k: string]: unknown } | null
): Promise<AdvancedStrikeResult | null> {
  const span = Sentry.startInactiveSpan({ name: 'advancedStrikeSelect', op: 'strike_selection' });
  try {
    // 1. Fetch spot price and option chain concurrently
    const [spotPrice, rawChain] = await Promise.all([
      marketData.getStockPrice(symbol),
      marketData.getOptionsChain(symbol),
    ]);

    if (!rawChain.length) {
      logger.warn('Advanced strike selection: empty option chain', { symbol });
      span?.end();
      return null;
    }

    // 2. Map direction
    const optionType: 'call' | 'put' = direction === 'long' ? 'call' : 'put';
    const ssDirection: 'CALL' | 'PUT' = direction === 'long' ? 'CALL' : 'PUT';

    // 3. Adapt chain rows → OptionContract[] with Greeks
    let chain = adaptOptionChain(rawChain, spotPrice, optionType);
    if (!chain.length) {
      logger.warn('Advanced strike selection: no contracts after adaptation', { symbol, rawCount: rawChain.length });
      span?.end();
      return null;
    }

    // 4. Derive setup context
    const setupType = deriveSetupType(timeframe);
    const regime = mapRegime(
      enrichment?.gammaDecision?.regime ??
      (mtfBiasState?.regime_type as string) ??
      undefined
    );
    const gexState = mapGexState(enrichment?.gammaContext);

    // 5. Apply MTF bias hint narrowing when available
    if (mtfBiasState) {
      try {
        const hint = getStrikeSelectionHint(mtfBiasState as any);
        const narrowed = applyBiasHint(chain, hint);
        if (narrowed.length > 0) {
          logger.info('Advanced strike selection: bias hint narrowed chain', {
            symbol,
            before: chain.length,
            after: narrowed.length,
            hint,
          });
          chain = narrowed;
        }
      } catch {
        // Hint not available, proceed with full chain
      }
    }

    // 6. Extract IV percentile from enrichment or use a default
    const ivPercentile = Number((enrichment?.enrichedData as Record<string, unknown>)?.ivPercentile ?? 50);

    // 7. Derive signal confidence
    const signalConfidence = Number(
      (enrichment?.enrichedData as Record<string, unknown>)?.confidence ??
      (enrichment?.riskResult as Record<string, unknown>)?.confidence ??
      65
    );

    // 8. Build risk budget from config
    const maxPremiumLoss = config.maxDailyLoss * 0.15; // 15% of daily loss cap per trade
    const maxCapitalAllocation = config.maxDailyLoss * 0.25;

    // 9. Build StrikeSelectionInput
    const input: StrikeSelectionInput = {
      symbol,
      spotPrice,
      direction: ssDirection,
      setupType,
      signalConfidence,
      expectedHoldTime: expectedHoldMinutes(setupType),
      expectedMovePercent: 2, // conservative default
      regime,
      gexState,
      ivPercentile,
      eventRisk: [], // TODO: Phase 3 — integrate event risk calendar
      riskBudget: {
        maxPremiumLoss,
        maxCapitalAllocation,
      },
      optionChain: chain,
    };

    // 10. Run the advanced selector
    const result: StrikeSelectionOutput = advancedSelectStrike(input);

    if (!result.success || !result.tradeContract) {
      logger.warn('Advanced strike selection: no valid strike found', {
        symbol,
        failureReason: result.failureReason,
        failedChecks: result.failedChecks,
        chainSize: chain.length,
      });
      span?.end();
      return null;
    }

    // 11. Build expiration Date from the selected contract's expiry string
    const expirationDate = new Date(result.tradeContract.expiry);
    expirationDate.setUTCHours(16, 0, 0, 0); // market close

    logger.info('Advanced strike selection succeeded', {
      symbol,
      strike: result.tradeContract.strike,
      expiry: result.tradeContract.expiry,
      dte: result.tradeContract.dte,
      score: result.scores?.overall,
      setupType,
      direction: ssDirection,
      chainSize: chain.length,
    });

    span?.end();

    return {
      strike: result.tradeContract.strike,
      expiration: expirationDate,
      optionType,
      entryPrice: result.tradeContract.midPrice,
      advanced: true,
      scores: result.scores,
      guardrails: result.guardrails,
      rationale: result.rationale,
    };
  } catch (error) {
    logger.error('Advanced strike selection failed, will fall back', error, { symbol });
    Sentry.captureException(error, {
      tags: { stage: 'advanced_strike_selection', symbol },
    });
    span?.end();
    return null;
  }
}
