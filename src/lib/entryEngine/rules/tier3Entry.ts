import type { EntryDecisionInput, EntryInstructions, RuleResult } from '../types.js';

function resolveUrgency(confidence: number): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (confidence >= 85) return 'HIGH';
  if (confidence >= 70) return 'MEDIUM';
  return 'LOW';
}

function buildEntryInstructions(input: EntryDecisionInput): EntryInstructions {
  const confidence = input.signal.confidence;
  switch (input.setupType) {
    case 'SCALP_GUARDED':
      return {
        entryType: 'LIMIT',
        confirmationRequired: true,
        maxWaitMinutes: 10,
      };
    case 'SWING':
      return {
        entryType: confidence >= 80 ? 'MARKET' : 'LIMIT',
        confirmationRequired: confidence < 70,
        maxWaitMinutes: 60,
      };
    case 'POSITION':
      return {
        entryType: 'LIMIT',
        confirmationRequired: true,
        maxWaitMinutes: 240,
      };
    case 'LEAPS':
      return {
        entryType: 'LIMIT',
        confirmationRequired: false,
        maxWaitMinutes: 1440,
      };
    default:
      return {
        entryType: 'LIMIT',
        confirmationRequired: true,
        maxWaitMinutes: 60,
      };
  }
}

export function evaluateTier3Rules(input: EntryDecisionInput): { instructions: EntryInstructions; rule: RuleResult } {
  const instructions = buildEntryInstructions(input);
  const urgency = resolveUrgency(input.signal.confidence);

  return {
    instructions,
    rule: {
      tier: 3,
      rule: 'ENTRY_APPROVED',
      triggered: true,
      message: `Entry approved with ${instructions.entryType} order`,
      severity: urgency,
    },
  };
}
