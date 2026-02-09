import {
  GammaRegime,
  GammaRegimeInsight,
  UnusualWhalesGammaSnapshot,
} from '../../types/index.js';

type GammaRegimeOptions = {
  currentPrice?: number;
  atr?: number;
  neutralThreshold?: number;
};

export class GammaRegimeService {
  classify(
    snapshot: UnusualWhalesGammaSnapshot,
    options: GammaRegimeOptions = {}
  ): GammaRegimeInsight {
    const threshold = options.neutralThreshold ?? 0;

    let regime: GammaRegime = 'NEUTRAL';
    if (snapshot.netGamma > threshold) {
      regime = 'LONG_GAMMA';
    } else if (snapshot.netGamma < -threshold) {
      regime = 'SHORT_GAMMA';
    }

    const expectedBehavior = regime === 'LONG_GAMMA' ? 'MEAN_REVERT' : 'EXPANSION';

    let distanceToZeroGammaATR: number | undefined;
    if (
      Number.isFinite(snapshot.zeroGammaLevel) &&
      Number.isFinite(options.currentPrice) &&
      Number.isFinite(options.atr) &&
      (options.atr ?? 0) > 0
    ) {
      const distance = (options.currentPrice as number) - (snapshot.zeroGammaLevel as number);
      distanceToZeroGammaATR = Math.round((distance / (options.atr as number)) * 100) / 100;
    }

    return {
      regime,
      zeroGammaLevel: snapshot.zeroGammaLevel,
      distanceToZeroGammaATR,
      expectedBehavior,
    };
  }
}

export const gammaRegimeService = new GammaRegimeService();
