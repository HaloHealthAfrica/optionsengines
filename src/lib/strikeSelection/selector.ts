import type { Guardrails } from '../shared/types.js';
import type { OptionContract, StrikeSelectionInput, StrikeSelectionOutput } from './types.js';
import { filterByDTE } from './filters/dteFilter.js';
import { filterByLiquidity } from './filters/liquidityFilter.js';
import { filterByGreeks } from './filters/greeksFilter.js';
import { scoreContract } from './scoring/scorer.js';
import { SCORING_WEIGHTS } from '../shared/constants.js';
import { logAuditEvent } from '../shared/audit-logger.js';
import { randomUUID } from 'crypto';

function generateGuardrails(
  setupType: StrikeSelectionInput['setupType']
): Guardrails {
  const guardrails: Guardrails = {
    maxHoldTime: 0,
    timeStops: [],
    progressChecks: [],
    thetaBurnLimit: 0,
    invalidationLevels: { stopLoss: 0, thesisInvalidation: 0 },
  };

  switch (setupType) {
    case 'SCALP_GUARDED':
      guardrails.maxHoldTime = 90;
      guardrails.progressChecks = [
        { atMinute: 15, minProfitPercent: 5 },
        { atMinute: 30, minProfitPercent: 10 },
      ];
      guardrails.thetaBurnLimit = 20;
      guardrails.invalidationLevels = { stopLoss: -15, thesisInvalidation: -10 };
      break;
    case 'SWING':
      guardrails.maxHoldTime = 14 * 24 * 60;
      guardrails.timeStops = [7 * 24 * 60, 10 * 24 * 60];
      guardrails.progressChecks = [
        { atMinute: 3 * 24 * 60, minProfitPercent: 10 },
        { atMinute: 7 * 24 * 60, minProfitPercent: 15 },
      ];
      guardrails.thetaBurnLimit = 30;
      guardrails.invalidationLevels = { stopLoss: -25, thesisInvalidation: -20 };
      break;
    case 'POSITION':
      guardrails.maxHoldTime = 60 * 24 * 60;
      guardrails.timeStops = [30 * 24 * 60, 45 * 24 * 60];
      guardrails.progressChecks = [
        { atMinute: 14 * 24 * 60, minProfitPercent: 15 },
        { atMinute: 30 * 24 * 60, minProfitPercent: 20 },
      ];
      guardrails.thetaBurnLimit = 40;
      guardrails.invalidationLevels = { stopLoss: -30, thesisInvalidation: -25 };
      break;
    case 'LEAPS':
      guardrails.maxHoldTime = 365 * 24 * 60;
      guardrails.timeStops = [90 * 24 * 60, 180 * 24 * 60];
      guardrails.progressChecks = [
        { atMinute: 60 * 24 * 60, minProfitPercent: 20 },
        { atMinute: 120 * 24 * 60, minProfitPercent: 30 },
      ];
      guardrails.thetaBurnLimit = 50;
      guardrails.invalidationLevels = { stopLoss: -40, thesisInvalidation: -35 };
      break;
  }

  return guardrails;
}

function tieBreakContracts(a: OptionContract, b: OptionContract, direction: 'CALL' | 'PUT'): number {
  if (a.dte !== b.dte) {
    return a.dte - b.dte;
  }
  if (direction === 'CALL') {
    return a.strike - b.strike;
  }
  return b.strike - a.strike;
}

export function selectStrike(input: StrikeSelectionInput): StrikeSelectionOutput {
  const requestId = randomUUID();
  const failedChecks: string[] = [];

  const dteFiltered = filterByDTE(input);
  if (dteFiltered.length === 0) {
    failedChecks.push('DTE_POLICY');
  }

  const liquidityFiltered = filterByLiquidity(input, dteFiltered);
  if (liquidityFiltered.length === 0) {
    failedChecks.push('LIQUIDITY_GATES');
  }

  const greeksFiltered = filterByGreeks(input, liquidityFiltered);
  if (greeksFiltered.length === 0) {
    failedChecks.push('GREEKS_FILTERS');
  }

  if (greeksFiltered.length === 0) {
    const output: StrikeSelectionOutput = {
      success: false,
      failureReason: 'NO_VALID_STRIKE',
      failedChecks,
    };
    logAuditEvent({
      engine: 'strike-selection',
      requestId,
      timestamp: Date.now(),
      input,
      output,
    });
    return output;
  }

  const scored = greeksFiltered.map((contract) => {
    const score = scoreContract(contract, input);
    return { contract, score };
  });

  scored.sort((a, b) => {
    if (b.score.overall !== a.score.overall) {
      return b.score.overall - a.score.overall;
    }
    return tieBreakContracts(a.contract, b.contract, input.direction);
  });

  const top = scored[0];
  const guardrails = generateGuardrails(input.setupType);
  const output: StrikeSelectionOutput = {
    success: true,
    tradeContract: {
      symbol: input.symbol,
      direction: input.direction,
      setupType: input.setupType,
      expiry: top.contract.expiry,
      dte: top.contract.dte,
      strike: top.contract.strike,
      midPrice: top.contract.mid,
      greeksSnapshot: top.contract.greeks,
    },
    scores: {
      overall: top.score.overall,
      breakdown: top.score.breakdown,
      weights: SCORING_WEIGHTS[input.setupType],
    },
    guardrails,
    rationale: [
      `Selected strike with score ${top.score.overall}`,
      `Filtered ${greeksFiltered.length} contracts from ${input.optionChain.length}`,
    ],
  };

  logAuditEvent({
    engine: 'strike-selection',
    requestId,
    timestamp: Date.now(),
    input,
    output,
  });

  return output;
}
