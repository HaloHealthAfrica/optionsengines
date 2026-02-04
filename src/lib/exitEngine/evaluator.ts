import { randomUUID } from 'crypto';
import type { ExitDecisionInput, ExitDecisionOutput, RuleResult } from './types.js';
import { logAuditEvent } from '../shared/audit-logger.js';
import { evaluateTier1Rules } from './rules/tier1HardFail.js';
import { evaluateTier2Rules } from './rules/tier2Protection.js';
import { evaluateTier3Rules } from './rules/tier3Profit.js';
import { evaluateTier4Rules } from './rules/tier4Degradation.js';
import { analyzeGreeks } from './greeksAnalyzer.js';

function calculateMetrics(input: ExitDecisionInput): ExitDecisionOutput['metrics'] {
  const timeInTradeMinutes = Math.max(0, (input.liveMarket.timestamp - input.entryData.timestamp) / 60000);
  const optionPnLPercent =
    input.entryData.optionEntryPrice > 0
      ? ((input.liveMarket.optionMid - input.entryData.optionEntryPrice) / input.entryData.optionEntryPrice) * 100
      : 0;
  const underlyingMovePercent =
    input.entryData.underlyingEntryPrice > 0
      ? ((input.liveMarket.underlyingPrice - input.entryData.underlyingEntryPrice) / input.entryData.underlyingEntryPrice) * 100
      : 0;
  const thetaBurnEstimate = input.entryData.optionEntryPrice
    ? (Math.abs(input.liveMarket.currentGreeks.theta) * (timeInTradeMinutes / (60 * 24)) / input.entryData.optionEntryPrice) * 100
    : 0;
  const deltaChange = input.liveMarket.currentGreeks.delta - input.contractDetails.greeksAtEntry.delta;
  const ivAtEntry = input.contractDetails.ivAtEntry ?? input.liveMarket.currentIV;
  const ivChange = input.liveMarket.currentIV - ivAtEntry;

  return {
    timeInTradeMinutes,
    optionPnLPercent,
    underlyingMovePercent,
    thetaBurnEstimate,
    deltaChange,
    ivChange,
    spreadPercent: input.liveMarket.spreadPercent,
  };
}

function selectMostConservativeAction(triggeredRules: RuleResult[]): ExitDecisionOutput['action'] {
  if (triggeredRules.length === 0) return 'HOLD';
  const sorted = [...triggeredRules].sort((a, b) => a.tier - b.tier);
  const highestTier = sorted[0].tier;
  const tierRules = sorted.filter((rule) => rule.tier === highestTier);

  if (highestTier === 1) return 'FULL_EXIT';
  if (highestTier === 2) {
    const severeRules = new Set(['LIQUIDITY_DETERIORATION', 'REGIME_FLIP']);
    return tierRules.some((rule) => severeRules.has(rule.rule)) ? 'FULL_EXIT' : 'PARTIAL_EXIT';
  }
  if (highestTier === 3) return 'PARTIAL_EXIT';
  if (highestTier === 4) {
    const tightenRules = new Set(['DELTA_DECAY', 'THETA_ACCELERATION']);
    return tierRules.some((rule) => tightenRules.has(rule.rule)) ? 'TIGHTEN_STOP' : 'PARTIAL_EXIT';
  }
  return 'HOLD';
}

function buildRationale(triggeredRules: RuleResult[]): string[] {
  return triggeredRules.map((rule) => rule.message);
}

export function evaluateExitDecision(input: ExitDecisionInput): ExitDecisionOutput {
  const requestId = randomUUID();
  const metrics = calculateMetrics(input);
  const timestamp = input.liveMarket.timestamp;

  const tier1Rules = evaluateTier1Rules(input, metrics);
  if (tier1Rules.length > 0) {
    const output: ExitDecisionOutput = {
      action: 'FULL_EXIT',
      urgency: 'HIGH',
      triggeredRules: tier1Rules,
      rationale: buildRationale(tier1Rules),
      metrics,
      timestamp,
    };
    logAuditEvent({ engine: 'exit-decision', requestId, timestamp, input, output, triggeredRules: tier1Rules, metrics });
    return output;
  }

  const tier2Rules = evaluateTier2Rules(input, metrics);
  if (tier2Rules.length > 0) {
    const action = selectMostConservativeAction(tier2Rules);
    const output: ExitDecisionOutput = {
      action,
      urgency: action === 'FULL_EXIT' ? 'HIGH' : 'MEDIUM',
      sizePercent: action === 'PARTIAL_EXIT' ? 50 : undefined,
      triggeredRules: tier2Rules,
      rationale: buildRationale(tier2Rules),
      metrics,
      timestamp,
    };
    logAuditEvent({ engine: 'exit-decision', requestId, timestamp, input, output, triggeredRules: tier2Rules, metrics });
    return output;
  }

  const tier3Result = evaluateTier3Rules(input, metrics);
  if (tier3Result.rules.length > 0) {
    const output: ExitDecisionOutput = {
      action: 'PARTIAL_EXIT',
      urgency: 'LOW',
      sizePercent: tier3Result.exitPercent ?? 25,
      triggeredRules: tier3Result.rules,
      rationale: buildRationale(tier3Result.rules),
      metrics,
      timestamp,
    };
    logAuditEvent({
      engine: 'exit-decision',
      requestId,
      timestamp,
      input,
      output,
      triggeredRules: tier3Result.rules,
      metrics,
    });
    return output;
  }

  const greekRules = analyzeGreeks(
    input.contractDetails.greeksAtEntry,
    input.liveMarket.currentGreeks,
    input.contractDetails.dteAtEntry,
    input.liveMarket.currentDTE,
    input.tradePosition.setupType,
    input.contractDetails.ivAtEntry ?? input.liveMarket.currentIV,
    input.liveMarket.currentIV
  );
  const tier4Rules = evaluateTier4Rules(input, metrics, greekRules);
  if (tier4Rules.length > 0) {
    const action = selectMostConservativeAction(tier4Rules);
    const output: ExitDecisionOutput = {
      action,
      urgency: 'LOW',
      sizePercent: action === 'PARTIAL_EXIT' ? 25 : undefined,
      newStopLevel: action === 'TIGHTEN_STOP' ? input.liveMarket.optionMid * 0.9 : undefined,
      triggeredRules: tier4Rules,
      rationale: buildRationale(tier4Rules),
      metrics,
      timestamp,
    };
    logAuditEvent({ engine: 'exit-decision', requestId, timestamp, input, output, triggeredRules: tier4Rules, metrics });
    return output;
  }

  const output: ExitDecisionOutput = {
    action: 'HOLD',
    urgency: 'LOW',
    triggeredRules: [],
    rationale: ['No exit conditions met'],
    metrics,
    timestamp,
  };
  logAuditEvent({ engine: 'exit-decision', requestId, timestamp, input, output, metrics });
  return output;
}
