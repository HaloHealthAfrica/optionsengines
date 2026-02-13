/**
 * GammaDealerStrategy unit tests
 * Set ENABLE_GAMMA_STRATEGY before config loads
 */
process.env.ENABLE_GAMMA_STRATEGY = 'true';

import { gammaDealerStrategy } from '../../strategies/GammaDealerStrategy.js';
import type { GammaContext } from '../../services/providers/unusualwhales-gamma.js';

describe('GammaDealerStrategy', () => {
  const mockSignal = {
    signal_id: 'test-id',
    symbol: 'SPY',
    direction: 'long' as const,
    timeframe: '5m',
  };

  const createGammaContext = (overrides: Partial<GammaContext>): GammaContext => ({
    symbol: 'SPY',
    net_gamma: 0,
    gamma_flip: null,
    call_gamma: null,
    put_gamma: null,
    gamma_by_strike: [],
    zero_dte_gamma: null,
    total_call_oi: null,
    total_put_oi: null,
    dealer_bias: 'neutral',
    top_gamma_strikes: [],
    timestamp: new Date(),
    ...overrides,
  });

  describe('classifyRegime', () => {
    it('returns LONG_GAMMA when net_gamma > threshold', () => {
      expect(gammaDealerStrategy.classifyRegime(150_000_000)).toBe('LONG_GAMMA');
    });

    it('returns SHORT_GAMMA when net_gamma < -threshold', () => {
      expect(gammaDealerStrategy.classifyRegime(-150_000_000)).toBe('SHORT_GAMMA');
    });

    it('returns NEUTRAL when |net_gamma| < threshold', () => {
      expect(gammaDealerStrategy.classifyRegime(50_000_000)).toBe('NEUTRAL');
      expect(gammaDealerStrategy.classifyRegime(-50_000_000)).toBe('NEUTRAL');
      expect(gammaDealerStrategy.classifyRegime(0)).toBe('NEUTRAL');
    });
  });

  describe('evaluate', () => {
    it('returns null when gammaContext is null', async () => {
      const result = await gammaDealerStrategy.evaluate(mockSignal, {}, null);
      expect(result).toBeNull();
    });

    it('returns decision with SHORT_GAMMA regime when net_gamma is negative', async () => {
      const ctx = createGammaContext({
        net_gamma: -200_000_000,
        gamma_flip: 450,
        dealer_bias: 'short',
        top_gamma_strikes: [{ strike: 450, netGamma: -50_000_000 }],
      });
      const result = await gammaDealerStrategy.evaluate(mockSignal, {}, ctx);
      expect(result).not.toBeNull();
      expect(result?.regime).toBe('SHORT_GAMMA');
      expect(result?.position_size_multiplier).toBe(1.2);
      expect(result?.exit_profile).toBe('TREND');
    });

    it('returns decision with LONG_GAMMA regime when net_gamma is positive', async () => {
      const ctx = createGammaContext({
        net_gamma: 200_000_000,
        gamma_flip: 455,
        dealer_bias: 'long',
        top_gamma_strikes: [{ strike: 455, netGamma: 80_000_000 }],
      });
      const result = await gammaDealerStrategy.evaluate(mockSignal, {}, ctx);
      expect(result).not.toBeNull();
      expect(result?.regime).toBe('LONG_GAMMA');
      expect(result?.position_size_multiplier).toBe(0.7);
      expect(result?.exit_profile).toBe('MEAN_REVERT');
    });

    it('includes gamma_context in decision', async () => {
      const ctx = createGammaContext({
        net_gamma: -100_000_000,
        gamma_flip: 450,
        dealer_bias: 'short',
        top_gamma_strikes: [{ strike: 450, netGamma: -30_000_000 }],
      });
      const result = await gammaDealerStrategy.evaluate(mockSignal, {}, ctx);
      expect(result?.gamma_context).toBeDefined();
      expect(result?.gamma_context.net_gamma).toBe(-100_000_000);
      expect(result?.gamma_context.gamma_flip).toBe(450);
      expect(result?.gamma_context.dealer_bias).toBe('short');
    });

    it('includes strike_adjustment when gamma_flip present in SHORT_GAMMA', async () => {
      const ctx = createGammaContext({
        net_gamma: -200_000_000,
        gamma_flip: 452,
        dealer_bias: 'short',
      });
      const result = await gammaDealerStrategy.evaluate(mockSignal, {}, ctx);
      expect(result?.strike_adjustment.gammaInfluencedStrike).toBe(true);
      expect(result?.strike_adjustment.gammaTargetStrike).toBe(452);
    });
  });
});
