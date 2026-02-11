// Strat Specialist Agent - simple pattern detection
import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';
import { featureFlags } from '../../services/feature-flag.service.js';

type StratPattern = '2-1-2' | '3-1-2' | '3-2-2' | 'none';

function classifyCandle(prev: { high: number; low: number }, curr: { high: number; low: number }): number {
  if (curr.high <= prev.high && curr.low >= prev.low) {
    return 1; // inside
  }
  if (curr.high > prev.high && curr.low < prev.low) {
    return 3; // outside
  }
  return 2; // directional
}

export class StratSpecialist extends BaseAgent {
  constructor() {
    super('strat_specialist', 'specialist');
  }

  shouldActivate(_signal: EnrichedSignal, marketData: MarketData): boolean {
    if (!featureFlags.isEnabled('enable_strat_specialist')) {
      return false;
    }
    return marketData.candles.length >= 3;
  }

  async analyze(_signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const candles = marketData.candles.slice(-3);
    const types = [
      classifyCandle(candles[0], candles[1]),
      classifyCandle(candles[1], candles[2]),
    ];

    let pattern: StratPattern = 'none';
    if (types[0] === 2 && types[1] === 1) pattern = '2-1-2';
    if (types[0] === 3 && types[1] === 1) pattern = '3-1-2';
    if (types[0] === 3 && types[1] === 2) pattern = '3-2-2';

    let confidence = pattern === 'none' ? 25 : 70;
    confidence = Math.max(15, Math.min(95, confidence));

    const bias: AgentOutput['bias'] = pattern === 'none' ? 'neutral' : 'bullish';
    const reasons = pattern === 'none' ? ['no_strat_pattern'] : ['strat_pattern_detected'];

    return this.buildOutput(bias, confidence, reasons, false, {
      agentType: 'specialist',
      stratPattern: pattern,
      candleSequence: types,
    });
  }
}
