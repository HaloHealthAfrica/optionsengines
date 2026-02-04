/**
 * Engine B Validator
 * 
 * Validates Engine B multi-agent behavior including:
 * - Conditional agent activation
 * - Data source isolation (no external API calls)
 * - Shadow execution only
 * - Multi-agent interaction
 * - Meta-decision aggregation
 * 
 * Requirements: 6.1-6.9, 8.1-8.5, 9.1-9.5
 */

import { SystemState } from '../orchestration/test-orchestrator';
import { ValidationResult, EngineBExpectation } from './validation-framework';

/**
 * Validate Engine B behavior
 * 
 * @param state - Captured system state
 * @param expected - Expected Engine B behavior
 * @returns Validation result
 */
export function validateEngineB(
  state: SystemState,
  expected: EngineBExpectation
): ValidationResult {
  const errors: string[] = [];
  const details: any = {};
  
  // Validate agent activation (Requirements 6.1, 6.4-6.8)
  const activationValid = validateAgentActivation(state, expected);
  if (!activationValid.valid) {
    errors.push(activationValid.error!);
    details.agentActivation = activationValid.details;
  }
  
  // Validate data source isolation (Requirements 6.2, 6.3)
  const dataSourceValid = validateDataSourceIsolation(state, expected);
  if (!dataSourceValid.valid) {
    errors.push(dataSourceValid.error!);
    details.dataSourceIsolation = dataSourceValid.details;
  }
  
  // Validate shadow execution (Requirements 8.1-8.5)
  const shadowValid = validateShadowExecution(state);
  if (!shadowValid.valid) {
    errors.push(shadowValid.error!);
    details.shadowExecution = shadowValid.details;
  }
  
  // Validate meta-decision aggregation (Requirement 6.9)
  if (expected.expectedMetaDecisionAggregation) {
    const metaValid = validateMetaDecisionAggregation(state);
    if (!metaValid.valid) {
      errors.push(metaValid.error!);
      details.metaDecisionAggregation = metaValid.details;
    }
  }
  
  // Validate confidence adjustments (Requirements 9.1-9.5)
  if (expected.expectedConfidenceAdjustments) {
    const confidenceValid = validateConfidenceAdjustments(
      state,
      expected.expectedConfidenceAdjustments
    );
    if (!confidenceValid.valid) {
      errors.push(confidenceValid.error!);
      details.confidenceAdjustments = confidenceValid.details;
    }
  }
  
  const passed = errors.length === 0;
  
  return {
    passed,
    phase: 'Engine B Multi-Agent',
    requirement: 'Requirements 6.1-6.9, 8.1-8.5, 9.1-9.5',
    message: passed
      ? 'Engine B validation passed'
      : `Engine B validation failed: ${errors.join('; ')}`,
    details: Object.keys(details).length > 0 ? details : undefined,
    expected: passed ? undefined : expected,
    actual: passed ? undefined : {
      agentActivations: state.agentActivations,
      engineBDecisions: state.engineBDecisions,
      shadowExecutions: state.shadowExecutions
    }
  };
}

/**
 * Validate agent activation matches expected
 * 
 * @param state - System state
 * @param expected - Expected Engine B behavior
 * @returns Validation result with details
 */
function validateAgentActivation(
  state: SystemState,
  expected: EngineBExpectation
): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  const activatedAgents = new Set(
    state.agentActivations
      .filter(a => a.activated)
      .map(a => a.agentName)
  );
  
  // Check for missing agents
  const missingAgents = expected.expectedAgentActivations.filter(
    agent => !activatedAgents.has(agent as any)
  );
  
  if (missingAgents.length > 0) {
    return {
      valid: false,
      error: 'Agent activation validation failed: activation mismatch',
      details: {
        expected: expected.expectedAgentActivations,
        actual: Array.from(activatedAgents),
        missing: missingAgents
      }
    };
  }
  
  return { valid: true };
}

/**
 * Validate data source isolation (no external API calls during agent execution)
 * 
 * @param state - System state
 * @param expected - Expected Engine B behavior
 * @returns Validation result with details
 */
function validateDataSourceIsolation(
  state: SystemState,
  expected: EngineBExpectation
): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  // Check that all agents use shared snapshot
  const agentsWithoutSnapshot = state.agentActivations.filter(
    a => a.activated && !a.input
  );
  
  if (agentsWithoutSnapshot.length > 0) {
    return {
      valid: false,
      error: 'Data source isolation validation failed: agents without snapshot input',
      details: {
        agentsWithoutSnapshot: agentsWithoutSnapshot.map(a => ({
          signalId: a.signalId,
          agent: a.agentName
        }))
      }
    };
  }
  
  // Check external API call count
  // During Engine B execution, external API calls should be 0
  // (enrichment happens before routing, so those calls are separate)
  const ignoredServices = new Set(['TwelveData', 'Alpaca', 'MarketData', 'MarketDataApp']);
  const totalAPICalls = Object.entries(state.externalAPICalls).reduce((sum, [service, count]) => {
    if (ignoredServices.has(service)) {
      return sum;
    }
    return sum + count;
  }, 0);
  
  if (totalAPICalls !== expected.expectedExternalAPICalls) {
    return {
      valid: false,
      error: 'Data source isolation validation failed: unexpected external API calls',
      details: {
        expected: expected.expectedExternalAPICalls,
        actual: totalAPICalls,
        breakdown: state.externalAPICalls
      }
    };
  }
  
  return { valid: true };
}

/**
 * Validate shadow execution isolation
 * 
 * @param state - System state
 * @returns Validation result with details
 */
function validateShadowExecution(state: SystemState): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  const errors: string[] = [];
  
  // Check that all Engine B decisions have shadow executions (not live)
  for (const decision of state.engineBDecisions) {
    if (decision.action !== 'HOLD') {
      const shadowExecution = state.shadowExecutions.find(
        e => e.signalId === decision.signalId
      );
      
      if (!shadowExecution) {
        errors.push(
          `Engine B decision ${decision.signalId} (${decision.action}) has no shadow execution`
        );
      }
    }
  }
  
  // Check that Engine B decisions don't have live executions
  const engineBLiveExecutions = (state.liveExecutions as Array<{ engine: 'A' | 'B'; signalId: string }>).filter(
    e => e.engine === 'B' && state.engineBDecisions.some(d => d.signalId === e.signalId)
  );
  
  if (engineBLiveExecutions.length > 0) {
    errors.push(
      `Engine B has ${engineBLiveExecutions.length} live executions (should be 0)`
    );
  }
  
  // Check that all shadow executions are from Engine B
  const nonEngineBShadowExecutions = state.shadowExecutions.filter(
    e => e.engine !== 'B'
  );
  
  if (nonEngineBShadowExecutions.length > 0) {
    errors.push(
      `Found ${nonEngineBShadowExecutions.length} shadow executions not from Engine B`
    );
  }
  
  // Check that shadow executions have brokerAPICalled = false
  const shadowWithAPICall = state.shadowExecutions.filter(
    e => e.brokerAPICalled !== false
  );
  
  if (shadowWithAPICall.length > 0) {
    errors.push(
      `Found ${shadowWithAPICall.length} shadow executions with brokerAPICalled = true`
    );
  }
  
  if (errors.length > 0) {
    return {
      valid: false,
      error: 'Shadow execution validation failed',
      details: {
        errors,
        engineBLiveExecutions: engineBLiveExecutions.map(e => e.signalId),
        shadowWithAPICall: shadowWithAPICall.map(e => e.signalId)
      }
    };
  }
  
  return { valid: true };
}

/**
 * Validate meta-decision aggregation
 * 
 * @param state - System state
 * @returns Validation result with details
 */
function validateMetaDecisionAggregation(state: SystemState): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  // Check that Meta-Decision agent is activated for Engine B decisions
  const metaActivations = state.agentActivations.filter(
    a => a.agentName === 'META_DECISION' && a.activated
  );
  
  if (metaActivations.length === 0) {
    return {
      valid: false,
      error: 'Meta-decision aggregation validation failed: META_DECISION agent not activated',
      details: {
        engineBDecisions: state.engineBDecisions.length,
        metaActivations: 0
      }
    };
  }
  
  // Check that Meta-Decision agent receives inputs from other agents
  for (const metaActivation of metaActivations) {
    const signalId = metaActivation.signalId;
    const otherAgentActivations = state.agentActivations.filter(
      a => a.signalId === signalId && a.agentName !== 'META_DECISION' && a.activated
    );
    
    if (otherAgentActivations.length === 0) {
      return {
        valid: false,
        error: 'Meta-decision aggregation validation failed: META_DECISION has no inputs from other agents',
        details: {
          signalId,
          otherAgentActivations: 0
        }
      };
    }
  }
  
  return { valid: true };
}

/**
 * Validate confidence adjustments
 * 
 * @param state - System state
 * @param expectedAdjustments - Expected confidence adjustments
 * @returns Validation result with details
 */
function validateConfidenceAdjustments(
  state: SystemState,
  expectedAdjustments: Array<{
    agent: string;
    adjustment: 'INCREASE' | 'DECREASE' | 'NEUTRAL';
    reason: string;
  }>
): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  // This is a simplified validation
  // In a real implementation, we would track confidence changes through the agent pipeline
  
  const mismatches: string[] = [];
  
  for (const expected of expectedAdjustments) {
    const agentActivations = state.agentActivations.filter(
      a => a.agentName === expected.agent as any && a.activated
    );
    
    if (agentActivations.length === 0) {
      mismatches.push(
        `Expected agent ${expected.agent} to be activated for confidence adjustment`
      );
      continue;
    }
    
    // Check if the agent's output reasoning mentions the expected reason
    const hasExpectedReason = agentActivations.some(
      a => a.output.reasoning.toLowerCase().includes(expected.reason.toLowerCase())
    );
    
    if (!hasExpectedReason) {
      mismatches.push(
        `Agent ${expected.agent} reasoning does not mention expected reason: ${expected.reason}`
      );
    }
  }
  
  if (mismatches.length > 0) {
    return {
      valid: false,
      error: 'Confidence adjustment validation failed',
      details: {
        expected: expectedAdjustments,
        mismatches
      }
    };
  }
  
  return { valid: true };
}
