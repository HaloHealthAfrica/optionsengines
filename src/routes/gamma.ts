/**
 * Gamma API - Unusual Whales gamma exposure for GammaDealerStrategy panel
 */
import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { gammaDealerStrategy } from '../strategies/GammaDealerStrategy.js';
import { unusualWhalesGammaProvider } from '../services/providers/unusualwhales-gamma.js';

const router = Router();

type AuthPayload = {
  userId: string;
  email: string;
  role: 'admin' | 'researcher' | 'user';
};

function requireAuth(req: Request, res: Response, next: NextFunction): Response | void {
  const token = authService.extractTokenFromHeader(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const payload = authService.verifyToken(token) as AuthPayload | null;
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  (req as Request & { user?: AuthPayload }).user = payload;
  return next();
}

function formatNotional(value: number): string {
  if (!Number.isFinite(value)) return '--';
  const absValue = Math.abs(value);
  const sign = value >= 0 ? '' : '-';
  if (absValue >= 1e9) return `${sign}$${(absValue / 1e9).toFixed(1)}B`;
  if (absValue >= 1e6) return `${sign}$${(absValue / 1e6).toFixed(1)}M`;
  if (absValue >= 1e3) return `${sign}$${(absValue / 1e3).toFixed(1)}K`;
  return `${sign}$${absValue.toFixed(0)}`;
}

/** GET /gamma/:symbol - Gamma context for Gamma Panel */
router.get('/:symbol', requireAuth, async (req: Request, res: Response) => {
  const symbol = String(req.params.symbol || 'SPY').toUpperCase();

  try {
    const gammaContext = await unusualWhalesGammaProvider.getGammaContext(symbol);
    if (!gammaContext) {
      return res.json({
        symbol,
        available: false,
        regime: 'NEUTRAL',
        netGamma: null,
        gammaFlip: null,
        dealerBias: 'neutral',
        topGammaWalls: [],
        formatted: { netGamma: '--', gammaFlip: '--' },
      });
    }

    const regime = gammaDealerStrategy.classifyRegime(gammaContext.net_gamma);
    const topGammaWalls = gammaContext.top_gamma_strikes.slice(0, 3).map((s) => ({
      strike: s.strike,
      netGamma: s.netGamma,
      formatted: formatNotional(s.netGamma),
    }));

    return res.json({
      symbol,
      available: true,
      regime,
      netGamma: gammaContext.net_gamma,
      gammaFlip: gammaContext.gamma_flip,
      dealerBias: gammaContext.dealer_bias,
      topGammaWalls,
      formatted: {
        netGamma: formatNotional(gammaContext.net_gamma),
        gammaFlip: gammaContext.gamma_flip != null ? `$${gammaContext.gamma_flip.toFixed(2)}` : '--',
      },
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch gamma context', symbol });
  }
});

export default router;
