/**
 * Deterministic, direction-aware P&L calculation for portfolio accounting integrity.
 * Root cause fix: short positions were incorrectly using long formula (exit - entry).
 *
 * LONG:  profit when exit > entry  => (exit - entry) * qty * multiplier
 * SHORT: profit when entry > exit  => (entry - exit) * qty * multiplier
 */

export type PositionSide = 'LONG' | 'SHORT';

export interface PositionForPnL {
  entry_price: number;
  exit_price: number;
  quantity: number;
  multiplier?: number;
  position_side?: PositionSide | string | null;
}

const OPTIONS_MULTIPLIER = 100;

/**
 * Calculate realized P&L for a closed position.
 * Direction must be stored at OPEN; do NOT infer at close time.
 *
 * @throws Error if position_side is invalid
 */
export function calculateRealizedPnL(position: PositionForPnL): number {
  const {
    entry_price,
    exit_price,
    quantity,
    multiplier = OPTIONS_MULTIPLIER,
    position_side = 'LONG',
  } = position;

  const side = String(position_side).toUpperCase() as PositionSide;
  if (side !== 'LONG' && side !== 'SHORT') {
    throw new Error(`Invalid position_side: ${position_side}. Must be LONG or SHORT.`);
  }

  if (side === 'LONG') {
    return (exit_price - entry_price) * quantity * multiplier;
  }

  // SHORT: profit when we sold high and bought back low
  return (entry_price - exit_price) * quantity * multiplier;
}

/**
 * Calculate unrealized P&L for an open position.
 */
export function calculateUnrealizedPnL(
  position: Pick<PositionForPnL, 'entry_price' | 'quantity' | 'multiplier' | 'position_side'> & {
    current_price: number;
  }
): number {
  const {
    entry_price,
    current_price,
    quantity,
    multiplier = OPTIONS_MULTIPLIER,
    position_side = 'LONG',
  } = position;

  const side = String(position_side).toUpperCase() as PositionSide;
  if (side !== 'LONG' && side !== 'SHORT') {
    throw new Error(`Invalid position_side: ${position_side}. Must be LONG or SHORT.`);
  }

  if (side === 'LONG') {
    return (current_price - entry_price) * quantity * multiplier;
  }

  return (entry_price - current_price) * quantity * multiplier;
}

/**
 * Cost basis for P&L percentage (always positive for long, represents capital at risk)
 */
export function costBasis(entryPrice: number, quantity: number, multiplier = OPTIONS_MULTIPLIER): number {
  return entryPrice * quantity * multiplier;
}
