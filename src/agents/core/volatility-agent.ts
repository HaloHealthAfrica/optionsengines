import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';
import { computeBBWidthPercentile, last } from '../utils/technical-indicators.js';

export class VolatilityAgent extends BaseAgent {
  constructor() {
    super('volatility', 'core');
  }

  shouldActivate(_signal: EnrichedSignal, _marketData: MarketData): boolean {
    return true;
  }

  async analyze(signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const { indicators, currentPrice, volatility } = marketData;
    const reasons: string[] = [];
    let bias: AgentOutput['bias'] = 'neutral';
    let confidence = 50;
    let blockTrade = false;

    const ivRank = volatility?.ivRank;
    const ivPercentile = volatility?.ivPercentile;
    const expectedMove = volatility?.expectedMove;
    const skew = volatility?.skew;
    const hvRatio = volatility?.hvRatio;
    const termStructure = volatility?.termStructure;

    const bbWidthPct = computeBBWidthPercentile(
      indicators.bollingerBands.upper,
      indicators.bollingerBands.lower,
      indicators.bollingerBands.middle
    );

    const atr = last(indicators.atr);
    const realizedVolPct = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;

    let ivRankAvailable = false;
    if (ivRank != null && Number.isFinite(ivRank)) {
      ivRankAvailable = true;
      if (ivRank > 80) {
        confidence = Math.max(confidence - 15, 20);
        reasons.push('iv_rank_extreme_high');
      } else if (ivRank > 50) {
        reasons.push('iv_rank_elevated');
      } else if (ivRank < 20) {
        confidence = Math.min(confidence + 10, 80);
        reasons.push('iv_rank_low_favors_debit');
      } else {
        reasons.push('iv_rank_normal');
      }
    }

    if (hvRatio != null && Number.isFinite(hvRatio)) {
      if (hvRatio > 1.3) {
        reasons.push('iv_overpriced_vs_hv');
        confidence = Math.max(confidence - 10, 20);
      } else if (hvRatio < 0.7) {
        reasons.push('iv_underpriced_vs_hv');
        confidence = Math.min(confidence + 5, 80);
      }
    }

    if (expectedMove != null && currentPrice > 0) {
      const emPct = (expectedMove / currentPrice) * 100;
      if (emPct > 5) {
        reasons.push('large_expected_move');
      }
    }

    let skewBias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (skew != null && Number.isFinite(skew)) {
      if (skew > 5) {
        reasons.push('call_skew_elevated');
        skewBias = 'bullish';
        confidence = Math.min(confidence + 5, 80);
      } else if (skew < -5) {
        reasons.push('put_skew_elevated');
        skewBias = 'bearish';
        confidence = Math.min(confidence + 5, 80);
      }
    }

    let termBias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (termStructure === 'backwardation') {
      reasons.push('term_structure_backwardation');
      termBias = 'bearish';
      confidence = Math.max(confidence - 5, 25);
    } else if (termStructure === 'contango') {
      reasons.push('term_structure_contango');
      termBias = 'bullish';
    }

    if (bbWidthPct < 10) {
      reasons.push('extreme_compression');
      if (signal.setupType === 'breakout') {
        confidence = Math.min(confidence + 10, 80);
        reasons.push('compression_breakout_setup');
      }
    } else if (bbWidthPct > 90) {
      reasons.push('extreme_expansion');
      confidence = Math.max(confidence - 10, 25);
    }

    if (realizedVolPct > 3) {
      reasons.push('extreme_realized_vol');
      confidence = Math.max(confidence - 10, 20);
    }

    if (!ivRankAvailable) {
      reasons.push('iv_data_unavailable_using_realized');
    }

    let bullishSignals = 0;
    let bearishSignals = 0;
    for (const b of [skewBias, termBias]) {
      if (b === 'bullish') bullishSignals++;
      else if (b === 'bearish') bearishSignals++;
    }
    if (ivRank != null && ivRank < 20) bullishSignals++;
    if (ivRank != null && ivRank > 80) bearishSignals++;
    if (hvRatio != null && hvRatio < 0.7) bullishSignals++;
    if (hvRatio != null && hvRatio > 1.3) bearishSignals++;

    if (bullishSignals > bearishSignals) {
      bias = 'bullish';
    } else if (bearishSignals > bullishSignals) {
      bias = 'bearish';
    }

    confidence = Math.max(15, Math.min(85, confidence));

    return this.buildOutput(bias, Math.round(confidence), reasons, blockTrade, {
      agentType: 'core',
      ivRank: ivRank ?? null,
      ivPercentile: ivPercentile ?? null,
      hvRatio: hvRatio ?? null,
      bbWidthPercentile: Math.round(bbWidthPct),
      realizedVolPct: Math.round(realizedVolPct * 100) / 100,
      termStructure: termStructure ?? null,
    });
  }
}
