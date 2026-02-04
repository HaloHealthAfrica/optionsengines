import type { OptionContract, StrikeSelectionInput } from '../types.js';
import { LIQUIDITY_GATES } from '../../shared/constants.js';

function spreadPercent(contract: OptionContract): number {
  const mid = contract.mid || (contract.bid + contract.ask) / 2;
  if (!mid) return 100;
  return ((contract.ask - contract.bid) / mid) * 100;
}

export function filterByLiquidity(input: StrikeSelectionInput, contracts: OptionContract[]): OptionContract[] {
  const gate = LIQUIDITY_GATES[input.setupType];
  return contracts.filter((contract) => {
    const spread = spreadPercent(contract);
    return (
      spread <= gate.maxSpreadPercent &&
      contract.openInterest >= gate.minOpenInterest &&
      contract.volume >= gate.minVolume
    );
  });
}

export function getSpreadPercent(contract: OptionContract): number {
  return spreadPercent(contract);
}
