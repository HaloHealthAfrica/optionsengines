// ORB Specialist Agent - Opening Range Breakout
import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';
import { featureFlags } from '../../services/feature-flag.service.js';

const ORB_SYMBOLS = new Set(['SPY', 'QQQ', 'SPX']);

function isWithinOpeningWindow(timestamp: Date): boolean {
  const hours = timestamp.getUTCHours();
  const minutes = timestamp.getUTCMinutes();
  // Approximate 9:30-10:00 ET as 13:30-14:00 UTC
  return (hours === 13 && minutes >= 30) || (hours === 14 && minutes === 0);
}

export class ORBSpecialist extends BaseAgent {
  constructor() {
    super('orb_specialist', 'specialist');
  }

  shouldActivate(signal: EnrichedSignal, _marketData: MarketData): boolean {
    if (!featureFlags.isEnabled('enable_orb_specialist')) {
      return false;
    }
    if (!ORB_SYMBOLS.has(signal.symbol)) {
      return false;
    }
    if (signal.sessionType !== 'RTH') {
      return false;
    }
    return isWithinOpeningWindow(signal.timestamp);
  }

  async analyze(_signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const candles = marketData.candles.slice(0, 5);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const orbHigh = Math.max(...highs);
    const orbLow = Math.min(...lows);
    const price = marketData.currentPrice;

    let breakoutDirection: 'up' | 'down' | 'none' = 'none';
    if (price > orbHigh) {
      breakoutDirection = 'up';
    } else if (price < orbLow) {
      breakoutDirection = 'down';
    }

    let confidence = 40;
    const reasons: string[] = ['orb_range_calculated'];

    if (breakoutDirection === 'up') {
      confidence = 80;
      reasons.push('breakout_up');
    } else if (breakoutDirection === 'down') {
      confidence = 80;
      reasons.push('breakout_down');
    } else {
      reasons.push('no_breakout');
    }

    const bias: AgentOutput['bias'] = breakoutDirection === 'up' ? 'bullish' : breakoutDirection === 'down' ? 'bearish' : 'neutral';

    return this.buildOutput(bias, Math.max(0, Math.min(100, confidence)), reasons, false, {
      agentType: 'specialist',
      orbHigh,
      orbLow,
      breakoutDirection,
    });
  }
}
