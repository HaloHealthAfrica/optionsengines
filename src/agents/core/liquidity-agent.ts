import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';

const SPREAD_BLOCK_THRESHOLD = 15;
const SPREAD_WARN_THRESHOLD = 8;
const MIN_OPEN_INTEREST = 50;
const MIN_VOLUME = 10;
const MIN_LIQUIDITY_SCORE = 20;

export class LiquidityAgent extends BaseAgent {
  constructor() {
    super('liquidity', 'core');
  }

  shouldActivate(_signal: EnrichedSignal, _marketData: MarketData): boolean {
    return true;
  }

  async analyze(_signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const liq = marketData.liquidity;
    const reasons: string[] = [];
    let blockTrade = false;
    let confidence = 60;

    if (!liq) {
      return this.buildOutput('neutral', 40, ['liquidity_data_unavailable'], false, {
        agentType: 'core',
        liquidityScore: null,
      });
    }

    const { bidAskSpreadPct, openInterest, volume, dollarVolume, slippageEstimate, liquidityScore } = liq;

    if (bidAskSpreadPct != null) {
      if (bidAskSpreadPct >= SPREAD_BLOCK_THRESHOLD) {
        blockTrade = true;
        reasons.push(`spread_too_wide_${bidAskSpreadPct.toFixed(1)}pct`);
      } else if (bidAskSpreadPct >= SPREAD_WARN_THRESHOLD) {
        confidence = Math.max(confidence - 15, 20);
        reasons.push('wide_spread_caution');
      } else if (bidAskSpreadPct < 3) {
        confidence = Math.min(confidence + 5, 85);
        reasons.push('tight_spread');
      }
    }

    if (openInterest != null) {
      if (openInterest < MIN_OPEN_INTEREST) {
        confidence = Math.max(confidence - 20, 15);
        reasons.push('low_open_interest');
        if (openInterest < 10) {
          blockTrade = true;
          reasons.push('critically_low_oi');
        }
      } else if (openInterest > 500) {
        confidence = Math.min(confidence + 5, 85);
        reasons.push('strong_open_interest');
      }
    }

    if (volume != null) {
      if (volume < MIN_VOLUME) {
        confidence = Math.max(confidence - 15, 15);
        reasons.push('low_volume');
      } else if (volume > 100) {
        confidence = Math.min(confidence + 5, 85);
        reasons.push('active_trading');
      }
    }

    if (slippageEstimate != null && slippageEstimate > 0) {
      if (slippageEstimate > 5) {
        blockTrade = true;
        reasons.push('excessive_slippage_estimate');
      } else if (slippageEstimate > 2) {
        confidence = Math.max(confidence - 10, 20);
        reasons.push('elevated_slippage');
      }
    }

    if (liquidityScore < MIN_LIQUIDITY_SCORE) {
      blockTrade = true;
      reasons.push('liquidity_score_below_minimum');
    } else if (liquidityScore < 40) {
      confidence = Math.max(confidence - 10, 25);
      reasons.push('below_average_liquidity');
    } else if (liquidityScore > 70) {
      confidence = Math.min(confidence + 5, 85);
      reasons.push('strong_liquidity');
    }

    if (reasons.length === 0) {
      reasons.push('liquidity_adequate');
    }

    confidence = Math.max(10, Math.min(90, confidence));

    return this.buildOutput('neutral', confidence, reasons, blockTrade, {
      agentType: 'core',
      liquidityScore,
      bidAskSpreadPct: bidAskSpreadPct ?? null,
      openInterest: openInterest ?? null,
      volume: volume ?? null,
      dollarVolume: dollarVolume ?? null,
      slippageEstimate: slippageEstimate ?? null,
      blocked: blockTrade,
    });
  }
}
