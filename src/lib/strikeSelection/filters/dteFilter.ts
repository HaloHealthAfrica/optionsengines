import type { OptionContract, StrikeSelectionInput } from '../types.js';
import { DTE_POLICY } from '../../shared/constants.js';

export function filterByDTE(input: StrikeSelectionInput): OptionContract[] {
  const policy = DTE_POLICY[input.setupType];
  const effectiveMin = input.minDteOverride != null && input.minDteOverride > 0
    ? Math.max(policy.min, input.minDteOverride)
    : policy.min;
  return input.optionChain.filter((contract) => contract.dte >= effectiveMin && contract.dte <= policy.max);
}
