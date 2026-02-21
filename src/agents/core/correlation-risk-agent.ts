import { BaseAgent } from '../base-agent.js';
import { AgentOutput, EnrichedSignal, MarketData } from '../../types/index.js';

const MAX_DIRECTIONAL_EXPOSURE = 0.70;
const MAX_CORRELATED_SAME_DIR = 2;
const HIGH_CORRELATION_THRESHOLD = 0.70;

export class CorrelationRiskAgent extends BaseAgent {
  constructor() {
    super('correlation_risk', 'core');
  }

  shouldActivate(_signal: EnrichedSignal, marketData: MarketData): boolean {
    return marketData.correlation != null;
  }

  async analyze(signal: EnrichedSignal, marketData: MarketData): Promise<AgentOutput> {
    const corr = marketData.correlation;
    if (!corr) {
      return this.buildOutput('neutral', 50, ['correlation_data_unavailable'], false, {
        agentType: 'core',
      });
    }

    const reasons: string[] = [];
    let blockTrade = false;
    let confidence = 60;

    const {
      directionalExposure,
      correlatedPositionCount,
      maxPairCorrelation,
      portfolioBeta,
      sectorConcentration,
    } = corr;

    if (directionalExposure != null && Number.isFinite(directionalExposure)) {
      const wouldIncrease =
        (signal.direction === 'long' && directionalExposure > 0) ||
        (signal.direction === 'short' && directionalExposure < 0);

      if (Math.abs(directionalExposure) >= MAX_DIRECTIONAL_EXPOSURE && wouldIncrease) {
        blockTrade = true;
        reasons.push(`directional_exposure_${Math.round(directionalExposure * 100)}pct`);
      } else if (Math.abs(directionalExposure) >= 0.50 && wouldIncrease) {
        confidence = Math.max(confidence - 15, 25);
        reasons.push('elevated_directional_exposure');
      } else if (!wouldIncrease && Math.abs(directionalExposure) > 0.3) {
        confidence = Math.min(confidence + 5, 80);
        reasons.push('trade_reduces_exposure');
      }
    }

    if (correlatedPositionCount != null) {
      if (correlatedPositionCount >= MAX_CORRELATED_SAME_DIR) {
        blockTrade = true;
        reasons.push(`${correlatedPositionCount}_correlated_positions_same_dir`);
      } else if (correlatedPositionCount >= 1) {
        confidence = Math.max(confidence - 10, 30);
        reasons.push('correlated_position_exists');
      }
    }

    if (maxPairCorrelation != null && maxPairCorrelation > HIGH_CORRELATION_THRESHOLD) {
      confidence = Math.max(confidence - 10, 25);
      reasons.push(`high_pair_correlation_${Math.round(maxPairCorrelation * 100)}`);
    }

    if (portfolioBeta != null && Number.isFinite(portfolioBeta)) {
      if (Math.abs(portfolioBeta) > 3) {
        confidence = Math.max(confidence - 10, 20);
        reasons.push('extreme_portfolio_beta');
      }
    }

    if (sectorConcentration) {
      const maxSector = Math.max(...Object.values(sectorConcentration));
      if (maxSector > 0.6) {
        confidence = Math.max(confidence - 10, 25);
        reasons.push('sector_concentration_risk');
      }
    }

    if (reasons.length === 0) {
      reasons.push('correlation_risk_acceptable');
    }

    confidence = Math.max(10, Math.min(85, confidence));

    return this.buildOutput('neutral', confidence, reasons, blockTrade, {
      agentType: 'core',
      directionalExposure: directionalExposure ?? null,
      correlatedPositionCount: correlatedPositionCount ?? null,
      maxPairCorrelation: maxPairCorrelation ?? null,
      portfolioBeta: portfolioBeta ?? null,
      blocked: blockTrade,
    });
  }
}
