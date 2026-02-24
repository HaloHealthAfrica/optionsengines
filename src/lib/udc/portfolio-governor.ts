import type { GovernorResult, TradeIntent, PortfolioState } from './types.js';

const DRAWDOWN_LIMIT_PCT = 5;
const POSITION_LIMIT = 5;
const COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Supreme gate for all UDC trades.
 * Enforces: daily loss cap, max open positions, delta/gamma caps,
 * DTE concentration, and cooldown logic.
 */
export function portfolioGovernor(
  intent: TradeIntent,
  portfolio: PortfolioState,
): GovernorResult {
  if (portfolio.risk.drawdownPct > DRAWDOWN_LIMIT_PCT) {
    return { allowed: false, reason: 'Drawdown limit exceeded' };
  }

  const maxPositions = portfolio.risk.maxOpenPositions ?? POSITION_LIMIT;
  if (portfolio.risk.positionCount >= maxPositions) {
    return { allowed: false, reason: 'Position limit exceeded' };
  }

  if (
    portfolio.risk.maxDailyLoss > 0 &&
    Math.abs(portfolio.risk.dailyPnL) >= portfolio.risk.maxDailyLoss
  ) {
    return { allowed: false, reason: 'Daily loss cap reached' };
  }

  if (Math.abs(portfolio.risk.portfolioDelta) > 50) {
    return { allowed: false, reason: 'Portfolio delta cap exceeded' };
  }

  if (Math.abs(portfolio.risk.portfolioGamma) > 20) {
    return { allowed: false, reason: 'Portfolio gamma cap exceeded' };
  }

  const dteKey = `${intent.dteMin}-${intent.dteMax}`;
  const dteCount = portfolio.risk.dteConcentration[dteKey] ?? 0;
  if (dteCount >= 3) {
    return { allowed: false, reason: 'DTE concentration limit reached' };
  }

  if (
    portfolio.risk.lastEntryTimestamp &&
    Date.now() - portfolio.risk.lastEntryTimestamp < COOLDOWN_MS
  ) {
    return { allowed: false, reason: 'Cooldown period active' };
  }

  return { allowed: true };
}
