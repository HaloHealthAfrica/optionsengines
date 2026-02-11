import { evaluateTier1Rules } from './rules/tier1HardBlocks.js';
import { evaluateTier2Rules } from './rules/tier2Delays.js';
import { evaluateTier3Rules } from './rules/tier3Entry.js';
import type { EntryDecisionInput, EntryDecisionOutput, RuleResult } from './types.js';
import { logAuditEvent } from '../shared/audit-logger.js';
import { randomUUID } from 'crypto';

function compileRationale(triggeredRules: RuleResult[]): string[] {
  return triggeredRules.map((rule) => rule.message);
}

export function evaluateEntryDecision(input: EntryDecisionInput): EntryDecisionOutput {
  const requestId = randomUUID();
  const timestamp = input.timestamp;

  const tier1Rules = evaluateTier1Rules(input);
  if (tier1Rules.length > 0) {
    const output: EntryDecisionOutput = {
      action: 'BLOCK',
      urgency: 'HIGH',
      triggeredRules: tier1Rules,
      rationale: compileRationale(tier1Rules),
      timestamp,
    };
    logAuditEvent({ engine: 'entry-decision', requestId, timestamp, input, output, triggeredRules: tier1Rules });
    return output;
  }

  const tier2Rules = evaluateTier2Rules(input);
  if (tier2Rules.length > 0) {
    const output: EntryDecisionOutput = {
      action: 'WAIT',
      urgency: 'MEDIUM',
      triggeredRules: tier2Rules,
      rationale: compileRationale(tier2Rules),
      timestamp,
    };
    logAuditEvent({ engine: 'entry-decision', requestId, timestamp, input, output, triggeredRules: tier2Rules });
    return output;
  }

  const { instructions, rule } = evaluateTier3Rules(input);
  const output: EntryDecisionOutput = {
    action: 'ENTER',
    urgency: rule.severity === 'HIGH' ? 'HIGH' : rule.severity === 'MEDIUM' ? 'MEDIUM' : 'LOW',
    entryInstructions: instructions,
    triggeredRules: [rule],
    rationale: compileRationale([rule]),
    timestamp,
  };

  logAuditEvent({ engine: 'entry-decision', requestId, timestamp, input, output, triggeredRules: [rule] });
  return output;
}
