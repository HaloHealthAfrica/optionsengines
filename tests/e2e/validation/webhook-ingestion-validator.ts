/**
 * Webhook Ingestion Validator
 * 
 * Validates webhook ingestion behavior including:
 * - Single processing of identical webhooks
 * - Single enrichment call per webhook
 * - Snapshot sharing between engines
 * - No duplicate external API calls
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

import { SystemState } from '../orchestration/test-orchestrator';
import { ValidationResult, WebhookIngestionExpectation } from './validation-framework';

/**
 * Validate webhook ingestion behavior
 * 
 * @param state - Captured system state
 * @param expected - Expected ingestion behavior
 * @returns Validation result
 */
export function validateWebhookIngestion(
  state: SystemState,
  expected: WebhookIngestionExpectation
): ValidationResult {
  const errors: string[] = [];
  const details: any = {};
  
  // Validate processing count (Requirement 3.1)
  if (state.webhookProcessingCount !== expected.expectedProcessingCount) {
    errors.push(
      `Processing count mismatch: expected ${expected.expectedProcessingCount}, got ${state.webhookProcessingCount}`
    );
    details.processingCount = {
      expected: expected.expectedProcessingCount,
      actual: state.webhookProcessingCount
    };
  }
  
  // Validate enrichment count (Requirement 3.2)
  if (state.enrichmentCallCount !== expected.expectedEnrichmentCount) {
    errors.push(
      `Enrichment count mismatch: expected ${expected.expectedEnrichmentCount}, got ${state.enrichmentCallCount}`
    );
    details.enrichmentCount = {
      expected: expected.expectedEnrichmentCount,
      actual: state.enrichmentCallCount
    };
  }
  
  // Validate snapshot sharing (Requirement 3.3)
  if (expected.expectedSnapshotSharing) {
    const snapshotSharingValid = validateSnapshotSharing(state);
    if (!snapshotSharingValid.valid) {
      errors.push(snapshotSharingValid.error!);
      details.snapshotSharing = snapshotSharingValid.details;
    }
  }
  
  // Validate external API calls (Requirement 3.4)
  if (expected.expectedAPICalls) {
    const apiCallsValid = validateExternalAPICalls(state, expected.expectedAPICalls);
    if (!apiCallsValid.valid) {
      errors.push(apiCallsValid.error!);
      details.externalAPICalls = apiCallsValid.details;
    }
  }
  
  const passed = errors.length === 0;
  
  return {
    passed,
    phase: 'Webhook Ingestion',
    requirement: 'Requirements 3.1, 3.2, 3.3, 3.4',
    message: passed
      ? 'Webhook ingestion validation passed'
      : `Webhook ingestion validation failed: ${errors.join('; ')}`,
    details: Object.keys(details).length > 0 ? details : undefined,
    expected: passed ? undefined : expected,
    actual: passed ? undefined : {
      processingCount: state.webhookProcessingCount,
      enrichmentCount: state.enrichmentCallCount,
      externalAPICalls: state.externalAPICalls
    }
  };
}

/**
 * Validate that the same snapshot is shared between Engine A and Engine B
 * 
 * @param state - System state
 * @returns Validation result with details
 */
function validateSnapshotSharing(state: SystemState): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  // Group decisions by signal ID
  const signalIds = new Set<string>();
  state.engineADecisions.forEach(d => signalIds.add(d.signalId));
  state.engineBDecisions.forEach(d => signalIds.add(d.signalId));
  
  // For each signal, verify that both engines received the same snapshot
  // This is validated by checking that agent activations reference the same enrichedAt timestamp
  const snapshotMismatches: string[] = [];
  
  for (const signalId of signalIds) {
    const engineADecision = state.engineADecisions.find(d => d.signalId === signalId);
    const engineBDecision = state.engineBDecisions.find(d => d.signalId === signalId);
    
    if (engineADecision && engineBDecision) {
      // Check if agent activations for this signal all reference the same snapshot
      const agentActivations = state.agentActivations.filter(a => a.signalId === signalId);
      
      if (agentActivations.length > 0) {
        const enrichedAtTimestamps = new Set(
          agentActivations.map(a => a.input.enrichedAt)
        );
        
        if (enrichedAtTimestamps.size > 1) {
          snapshotMismatches.push(
            `Signal ${signalId} has multiple enrichedAt timestamps: ${Array.from(enrichedAtTimestamps).join(', ')}`
          );
        }
      }
    }
  }
  
  if (snapshotMismatches.length > 0) {
    return {
      valid: false,
      error: 'Snapshot sharing validation failed: different snapshots used for same signal',
      details: { mismatches: snapshotMismatches }
    };
  }
  
  return { valid: true };
}

/**
 * Validate external API call counts
 * 
 * @param state - System state
 * @param expectedCalls - Expected API call counts by service
 * @returns Validation result with details
 */
function validateExternalAPICalls(
  state: SystemState,
  expectedCalls: Record<string, number>
): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  const mismatches: Record<string, { expected: number; actual: number }> = {};
  
  // Check each expected service
  for (const [service, expectedCount] of Object.entries(expectedCalls)) {
    const actualCount = state.externalAPICalls[service] || 0;
    
    if (actualCount !== expectedCount) {
      mismatches[service] = {
        expected: expectedCount,
        actual: actualCount
      };
    }
  }
  
  // Check for unexpected services
  for (const service of Object.keys(state.externalAPICalls)) {
    if (!(service in expectedCalls)) {
      mismatches[service] = {
        expected: 0,
        actual: state.externalAPICalls[service]
      };
    }
  }
  
  if (Object.keys(mismatches).length > 0) {
    return {
      valid: false,
      error: 'External API call count validation failed',
      details: { mismatches }
    };
  }
  
  return { valid: true };
}
