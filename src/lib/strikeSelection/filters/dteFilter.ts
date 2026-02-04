import type { OptionContract, StrikeSelectionInput } from '../types.js';
import { DTE_POLICY } from '../../shared/constants.js';

export function filterByDTE(input: StrikeSelectionInput): OptionContract[] {
  const policy = DTE_POLICY[input.setupType];
  return input.optionChain.filter((contract) => contract.dte >= policy.min && contract.dte <= policy.max);
}
