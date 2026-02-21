import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';

export class MultiTimeframeTrendAgent extends BaseAgent {
  constructor() {
    super('mtf_trend', 'core');
  }

  shouldActivate(_signal: EnrichedSignal, marketData: MarketData): boolean {
    return marketData.multiTimeframe != null;
  }

  async analyze(signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const mtf = marketData.multiTimeframe;
    if (!mtf) {
      return this.buildOutput('neutral', 30, ['mtf_data_unavailable'], false, {
        agentType: 'core',
      });
    }

    const frames = [mtf.tf5m, mtf.tf15m, mtf.tf1h, mtf.tf4h, mtf.tfDaily].filter(Boolean);
    if (frames.length === 0) {
      return this.buildOutput('neutral', 30, ['no_timeframe_data'], false, {
        agentType: 'core',
      });
    }

    let bullishCount = 0;
    let bearishCount = 0;
    const weights = [0.10, 0.15, 0.25, 0.25, 0.25]; // higher TF = more weight
    const tfs = [mtf.tf5m, mtf.tf15m, mtf.tf1h, mtf.tf4h, mtf.tfDaily];
    let weightedScore = 0;
    let totalWeight = 0;
    const details: string[] = [];

    for (let i = 0; i < tfs.length; i++) {
      const tf = tfs[i];
      if (!tf) continue;
      const w = weights[i];
      totalWeight += w;
      if (tf.trend === 'up') {
        bullishCount++;
        weightedScore += w;
        details.push(`tf${i}_up`);
      } else if (tf.trend === 'down') {
        bearishCount++;
        weightedScore -= w;
        details.push(`tf${i}_down`);
      } else {
        details.push(`tf${i}_flat`);
      }
    }

    const normalizedScore = totalWeight > 0 ? weightedScore / totalWeight : 0;
    const alignmentScore = mtf.alignmentScore;

    const allAligned =
      (bullishCount === frames.length) || (bearishCount === frames.length);
    const mixed = bullishCount > 0 && bearishCount > 0;

    let bias: AgentOutput['bias'] = 'neutral';
    let confidence = 40;
    const reasons: string[] = [];

    if (allAligned && bullishCount > 0) {
      bias = 'bullish';
      confidence = 80;
      reasons.push('all_timeframes_bullish');
    } else if (allAligned && bearishCount > 0) {
      bias = 'bearish';
      confidence = 80;
      reasons.push('all_timeframes_bearish');
    } else if (normalizedScore > 0.3) {
      bias = 'bullish';
      confidence = 55 + Math.round(normalizedScore * 25);
      reasons.push('majority_timeframes_bullish');
    } else if (normalizedScore < -0.3) {
      bias = 'bearish';
      confidence = 55 + Math.round(Math.abs(normalizedScore) * 25);
      reasons.push('majority_timeframes_bearish');
    } else {
      reasons.push('timeframes_mixed');
    }

    if (mixed) {
      confidence = Math.min(confidence, 55);
      reasons.push('conflicting_timeframes');
    }

    const signalAligned =
      (bias === 'bullish' && signal.direction === 'long') ||
      (bias === 'bearish' && signal.direction === 'short');

    if (!signalAligned && bias !== 'neutral') {
      confidence = Math.max(20, confidence - 15);
      reasons.push('mtf_opposes_signal');
    }

    confidence = Math.max(15, Math.min(90, confidence));

    return this.buildOutput(bias, Math.round(confidence), reasons, false, {
      agentType: 'core',
      bullishCount,
      bearishCount,
      normalizedScore: Math.round(normalizedScore * 100) / 100,
      alignmentScore,
      timeframeDetails: details,
    });
  }
}
