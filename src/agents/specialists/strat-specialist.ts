import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData, Candle } from '../../types/index.js';
import { featureFlags } from '../../services/feature-flag.service.js';

type StratBarType = 1 | 2 | 3;
type StratPattern = '2-1-2' | '3-1-2' | '3-2-2' | 'none';
type PatternDirection = 'bullish' | 'bearish' | 'neutral';

function classifyCandle(
  prev: { high: number; low: number },
  curr: { high: number; low: number }
): StratBarType {
  if (curr.high <= prev.high && curr.low >= prev.low) return 1;
  if (curr.high > prev.high && curr.low < prev.low) return 3;
  return 2;
}

function detectPatternDirection(candles: Candle[]): PatternDirection {
  const trigger = candles[candles.length - 1];
  const setup = candles[candles.length - 2];
  if (trigger.close > setup.high) return 'bullish';
  if (trigger.close < setup.low) return 'bearish';
  return 'neutral';
}

export class StratSpecialist extends BaseAgent {
  constructor() {
    super('strat_specialist', 'specialist');
  }

  shouldActivate(_signal: EnrichedSignal, marketData: MarketData): boolean {
    if (!featureFlags.isEnabled('enable_strat_specialist')) return false;
    return marketData.candles.length >= 3;
  }

  async analyze(signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const candles = marketData.candles.slice(-3);
    const barTypes: StratBarType[] = [
      classifyCandle(candles[0], candles[1]),
      classifyCandle(candles[1], candles[2]),
    ];

    let pattern: StratPattern = 'none';
    if (barTypes[0] === 2 && barTypes[1] === 1) pattern = '2-1-2';
    if (barTypes[0] === 3 && barTypes[1] === 1) pattern = '3-1-2';
    if (barTypes[0] === 3 && barTypes[1] === 2) pattern = '3-2-2';

    if (pattern === 'none') {
      return this.buildOutput('neutral', 25, ['no_strat_pattern'], false, {
        agentType: 'specialist',
        stratPattern: pattern,
        candleSequence: barTypes,
      });
    }

    const patternDir = detectPatternDirection(candles);

    if (patternDir === 'neutral') {
      return this.buildOutput('neutral', 30, ['strat_pattern_no_trigger'], false, {
        agentType: 'specialist',
        stratPattern: pattern,
        patternDirection: patternDir,
        signalDirection: signal.direction,
        candleSequence: barTypes,
      });
    }

    const signalAligned =
      (patternDir === 'bullish' && signal.direction === 'long') ||
      (patternDir === 'bearish' && signal.direction === 'short');

    const bias: AgentOutput['bias'] = patternDir === 'bullish' ? 'bullish' : 'bearish';
    let confidence = signalAligned ? 75 : 30;

    if (pattern === '2-1-2') confidence = signalAligned ? 75 : 25;
    if (pattern === '3-1-2') confidence = signalAligned ? 70 : 30;
    if (pattern === '3-2-2') confidence = signalAligned ? 65 : 35;

    confidence = Math.max(15, Math.min(95, confidence));

    const reasons: string[] = [
      `strat_${pattern}_${patternDir}`,
      signalAligned ? 'pattern_signal_aligned' : 'pattern_signal_mismatch',
    ];

    return this.buildOutput(bias, confidence, reasons, false, {
      agentType: 'specialist',
      stratPattern: pattern,
      patternDirection: patternDir,
      signalDirection: signal.direction,
      signalAligned,
      candleSequence: barTypes,
    });
  }
}
