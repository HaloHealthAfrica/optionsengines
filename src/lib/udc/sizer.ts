import type { StrikeSelectionResult, PortfolioState, SizedSelection } from './types.js';

const DEFAULT_MAX_LOSS = 250;
const DEFAULT_QUANTITY = 1;

/**
 * Position sizer using portfolio risk budget.
 * Currently uses fixed sizing; Kelly logic can be plugged in later.
 */
export function sizer(
  selection: StrikeSelectionResult,
  _portfolio: PortfolioState,
): SizedSelection {
  return {
    ...selection,
    quantity: DEFAULT_QUANTITY,
    maxLoss: DEFAULT_MAX_LOSS,
  };
}
