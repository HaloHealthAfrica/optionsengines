/**
 * Entry Decision Adapter - builds EntryDecisionInput from orchestrator signal, context, and enrichment.
 * Used by Engine A invoker to run evaluateEntryDecision (tier 1-4 rules) before strike selection.
 */

import type { EntryDecisionInput } from '../lib/entryEngine/types.js';
import type { Signal } from '../orchestrator/types.js';
import type { MarketContext } from '../orchestrator/types.js';
import type { GEXState, RegimeType, SessionType } from '../lib/shared/types.js';
import { evaluateMarketSession } from '../utils/market-session.js';
import { config } from '../config/index.js';

type EnrichmentLike = {
  enrichedData: Record<string, unknown>;
  riskResult: Record<string, unknown>;
};

function mapSessionToTiming(sessionLabel: string): SessionType {
  const upper = String(sessionLabel || '').toUpperCase();
  if (upper === 'PRE') return 'PRE_MARKET';
  if (upper === 'RTH') return 'MORNING';
  if (upper === 'POST') return 'AFTER_HOURS';
  if (upper === 'CLOSED') return 'AFTER_HOURS';
  return 'MORNING';
}

function netGexToGexState(netGex: number | undefined): GEXState {
  if (netGex == null || !Number.isFinite(netGex)) return 'NEUTRAL';
  const abs = Math.abs(netGex);
  if (netGex > 0) return abs > 1e9 ? 'POSITIVE_HIGH' : 'POSITIVE_LOW';
  return abs > 1e9 ? 'NEGATIVE_HIGH' : 'NEGATIVE_LOW';
}

function dealerPositionToRegime(dealerPosition: string | undefined): RegimeType {
  const pos = String(dealerPosition || '').toLowerCase();
  if (pos === 'long_gamma') return 'BULL';
  if (pos === 'short_gamma') return 'BEAR';
  return 'NEUTRAL';
}

/**
 * Build EntryDecisionInput from orchestrator signal, context, and enrichment.
 * Uses sensible defaults when data is unavailable.
 */
export function buildEntryDecisionInput(
  signal: Signal,
  context: MarketContext,
  enrichment: EnrichmentLike
): EntryDecisionInput {
  const ts = signal.timestamp instanceof Date ? signal.timestamp : new Date(signal.timestamp);
  const sessionEval = evaluateMarketSession({
    timestamp: ts,
    allowPremarket: config.allowPremarket,
    allowAfterhours: config.allowAfterhours,
    gracePeriodMinutes: config.marketCloseGraceMinutes,
  });

  const enriched = enrichment.enrichedData as Record<string, unknown> | undefined;
  const risk = enrichment.riskResult as Record<string, unknown> | undefined;
  const price = Number(enriched?.currentPrice ?? context.current_price ?? 0) || 450;
  const gex = enriched?.gex as { netGex?: number; dealerPosition?: string } | null | undefined;
  const atr = context.indicators?.atr ?? 0;
  const volatility = Number.isFinite(atr) && price > 0 ? (atr / price) * 100 : 15;

  const payload = signal.raw_payload as Record<string, unknown> | undefined;
  const signalPayload = payload?.signal as Record<string, unknown> | undefined;
  const confidence = Number(
    payload?.confidence ?? payload?.score ?? signalPayload?.confidence ?? 70
  );

  const openTrades = Number(risk?.openPositions ?? risk?.effectiveOpenPositions ?? 0);

  return {
    symbol: signal.symbol,
    timestamp: ts.getTime(),
    direction: signal.direction === 'long' ? 'CALL' : 'PUT',
    setupType: 'SWING',
    signal: {
      confidence: Math.max(0, Math.min(100, confidence)),
      pattern: typeof payload?.pattern === 'string' ? (payload.pattern as string) : 'signal',
      timeframe: signal.timeframe || '5m',
    },
    marketContext: {
      price,
      regime: dealerPositionToRegime(gex?.dealerPosition),
      gexState: netGexToGexState(gex?.netGex),
      volatility,
      ivPercentile: 50,
    },
    timingContext: {
      session: mapSessionToTiming(sessionEval.sessionLabel),
      minutesFromOpen: Math.max(0, sessionEval.minuteOfDay - (9 * 60 + 30)),
      liquidityState: 'NORMAL',
    },
    riskContext: {
      dailyPnL: 0,
      openTradesCount: openTrades,
      portfolioDelta: 0,
      portfolioTheta: 0,
    },
  };
}
