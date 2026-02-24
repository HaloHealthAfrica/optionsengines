import type { TradeIntent, MarketSnapshot, StrikeSelectionResult, OptionLeg } from './types.js';

/**
 * Pure function for strike selection.
 * Selects contracts based on DTE and delta from the options chain.
 * Never calls broker. Fails if chain unavailable.
 */
export function strikeSelection(
  intent: TradeIntent,
  snapshot: MarketSnapshot,
): StrikeSelectionResult {
  if (!snapshot.chain || snapshot.chain.length === 0) {
    throw new Error(`Options chain unavailable for ${intent.symbol}`);
  }

  if (snapshot.stale) {
    throw new Error(`Market snapshot stale for ${intent.symbol}`);
  }

  const optionType = intent.direction === 'BULL' ? 'CALL' : 'PUT';

  const filtered = snapshot.chain.filter((c) => {
    if (c.type !== optionType) return false;
    if (c.dte < intent.dteMin || c.dte > intent.dteMax) return false;
    const absDelta = Math.abs(c.delta);
    if (absDelta < 0.2 || absDelta > 0.5) return false;
    if (c.bid <= 0 || c.ask <= 0) return false;
    return true;
  });

  if (filtered.length === 0) {
    throw new Error(
      `No valid contracts found for ${intent.symbol} (${optionType}, DTE ${intent.dteMin}-${intent.dteMax})`,
    );
  }

  filtered.sort((a, b) => {
    const aDeltaDist = Math.abs(Math.abs(a.delta) - 0.35);
    const bDeltaDist = Math.abs(Math.abs(b.delta) - 0.35);
    return aDeltaDist - bDeltaDist;
  });

  const best = filtered[0];

  const leg: OptionLeg = {
    symbol: best.symbol,
    expiry: best.expiry,
    strike: best.strike,
    type: optionType,
    side: 'BUY',
    quantity: 1,
  };

  return {
    symbol: intent.symbol,
    structure: intent.structure,
    legs: [leg],
  };
}
