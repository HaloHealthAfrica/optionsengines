/**
 * Determinism Validator
 * 
 * Validates determinism across multiple test runs including:
 * - Identical outputs for identical inputs
 * - Engine A determinism
 * - Engine B determinism
 * - Routing determinism
 * - Replay determinism
 * 
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5
 */

import { SystemState, Decision, VariantAssignment, AgentActivation } from '../orchestration/test-orchestrator';
import { ValidationResult } from './validation-framework';

/**
 * Validate determinism across multiple runs
 * 
 * @param states - Multiple system states from identical test runs
 * @returns Validation result
 */
export function validateDeterminism(states: SystemState[]): ValidationResult {
  if (states.length < 2) {
    return {
      passed: false,
      phase: 'Determinism',
      requirement: 'Requirements 13.1, 13.2, 13.3, 13.4, 13.5',
      message: 'Determinism validation requires at least 2 test runs',
      details: { stateCount: states.length }
    };
  }
  
  const errors: string[] = [];
  const details: any = {};
  
  // Validate Engine A determinism (Requirement 13.1)
  const engineAValid = validateEngineADeterminism(states);
  if (!engineAValid.valid) {
    errors.push(engineAValid.error!);
    details.engineA = engineAValid.details;
  }
  
  // Validate Engine B determinism (Requirements 13.2, 13.4)
  const engineBValid = validateEngineBDeterminism(states);
  if (!engineBValid.valid) {
    errors.push(engineBValid.error!);
    details.engineB = engineBValid.details;
  }
  
  // Validate routing determinism (Requirement 13.3)
  const routingValid = validateRoutingDeterminism(states);
  if (!routingValid.valid) {
    errors.push(routingValid.error!);
    details.routing = routingValid.details;
  }
  
  const passed = errors.length === 0;
  
  return {
    passed,
    phase: 'Determinism',
    requirement: 'Requirements 13.1, 13.2, 13.3, 13.4, 13.5',
    message: passed
      ? `Determinism validation passed across ${states.length} runs`
      : `Determinism validation failed: ${errors.join('; ')}`,
    details: Object.keys(details).length > 0 ? details : undefined,
    expected: passed ? undefined : 'identical outputs across all runs',
    actual: passed ? undefined : { runCount: states.length, ...details }
  };
}

/**
 * Validate Engine A determinism
 * 
 * @param states - Multiple system states
 * @returns Validation result with details
 */
function validateEngineADeterminism(states: SystemState[]): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  const baselineState = states[0];
  const mismatches: Array<{
    runIndex: number;
    signalId: string;
    field: string;
    baseline: any;
    actual: any;
  }> = [];
  
  for (let i = 1; i < states.length; i++) {
    const currentState = states[i];
    
    // Compare Engine A decisions
    const decisionMismatches = compareDecisions(
      baselineState.engineADecisions,
      currentState.engineADecisions,
      i
    );
    
    mismatches.push(...decisionMismatches);
  }
  
  if (mismatches.length > 0) {
    return {
      valid: false,
      error: 'Engine A determinism validation failed: non-deterministic behavior detected',
      details: { mismatches }
    };
  }
  
  return { valid: true };
}

/**
 * Validate Engine B determinism
 * 
 * @param states - Multiple system states
 * @returns Validation result with details
 */
function validateEngineBDeterminism(states: SystemState[]): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  const baselineState = states[0];
  const mismatches: Array<{
    runIndex: number;
    signalId: string;
    field: string;
    baseline: any;
    actual: any;
  }> = [];
  
  for (let i = 1; i < states.length; i++) {
    const currentState = states[i];
    
    // Compare Engine B decisions
    const decisionMismatches = compareDecisions(
      baselineState.engineBDecisions,
      currentState.engineBDecisions,
      i
    );
    
    mismatches.push(...decisionMismatches);
    
    // Compare agent activations
    const activationMismatches = compareAgentActivations(
      baselineState.agentActivations,
      currentState.agentActivations,
      i
    );
    
    mismatches.push(...activationMismatches);
  }
  
  if (mismatches.length > 0) {
    return {
      valid: false,
      error: 'Engine B determinism validation failed: non-deterministic behavior detected',
      details: { mismatches }
    };
  }
  
  return { valid: true };
}

/**
 * Validate routing determinism
 * 
 * @param states - Multiple system states
 * @returns Validation result with details
 */
function validateRoutingDeterminism(states: SystemState[]): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  const baselineState = states[0];
  const mismatches: Array<{
    runIndex: number;
    signalId: string;
    field: string;
    baseline: any;
    actual: any;
  }> = [];
  
  for (let i = 1; i < states.length; i++) {
    const currentState = states[i];
    
    // Compare routing decisions
    const routingMismatches = compareRoutingDecisions(
      baselineState.routerDecisions,
      currentState.routerDecisions,
      i
    );
    
    mismatches.push(...routingMismatches);
  }
  
  if (mismatches.length > 0) {
    return {
      valid: false,
      error: 'Routing determinism validation failed: non-deterministic routing detected',
      details: { mismatches }
    };
  }
  
  return { valid: true };
}

/**
 * Compare decisions between two runs
 * 
 * @param baseline - Baseline decisions
 * @param actual - Actual decisions
 * @param runIndex - Index of the current run
 * @returns Array of mismatches
 */
function compareDecisions(
  baseline: Decision[],
  actual: Decision[],
  runIndex: number
): Array<{
  runIndex: number;
  signalId: string;
  field: string;
  baseline: any;
  actual: any;
}> {
  const mismatches: Array<{
    runIndex: number;
    signalId: string;
    field: string;
    baseline: any;
    actual: any;
  }> = [];
  
  // Create maps for easier comparison
  const baselineMap = new Map<string, Decision>();
  for (const decision of baseline) {
    baselineMap.set(decision.signalId, decision);
  }
  
  const actualMap = new Map<string, Decision>();
  for (const decision of actual) {
    actualMap.set(decision.signalId, decision);
  }
  
  // Check for missing or extra decisions
  for (const signalId of baselineMap.keys()) {
    if (!actualMap.has(signalId)) {
      mismatches.push({
        runIndex,
        signalId,
        field: 'existence',
        baseline: 'present',
        actual: 'missing'
      });
    }
  }
  
  for (const signalId of actualMap.keys()) {
    if (!baselineMap.has(signalId)) {
      mismatches.push({
        runIndex,
        signalId,
        field: 'existence',
        baseline: 'missing',
        actual: 'present'
      });
    }
  }
  
  // Compare matching decisions
  for (const [signalId, baselineDecision] of baselineMap.entries()) {
    const actualDecision = actualMap.get(signalId);
    
    if (!actualDecision) continue;
    
    // Compare action
    if (baselineDecision.action !== actualDecision.action) {
      mismatches.push({
        runIndex,
        signalId,
        field: 'action',
        baseline: baselineDecision.action,
        actual: actualDecision.action
      });
    }
    
    // Compare confidence (with small tolerance for floating point)
    const confidenceDiff = Math.abs(baselineDecision.confidence - actualDecision.confidence);
    if (confidenceDiff > 0.0001) {
      mismatches.push({
        runIndex,
        signalId,
        field: 'confidence',
        baseline: baselineDecision.confidence,
        actual: actualDecision.confidence
      });
    }
    
    // Compare reasoning
    if (baselineDecision.reasoning !== actualDecision.reasoning) {
      mismatches.push({
        runIndex,
        signalId,
        field: 'reasoning',
        baseline: baselineDecision.reasoning,
        actual: actualDecision.reasoning
      });
    }
  }
  
  return mismatches;
}

/**
 * Compare agent activations between two runs
 * 
 * @param baseline - Baseline activations
 * @param actual - Actual activations
 * @param runIndex - Index of the current run
 * @returns Array of mismatches
 */
function compareAgentActivations(
  baseline: AgentActivation[],
  actual: AgentActivation[],
  runIndex: number
): Array<{
  runIndex: number;
  signalId: string;
  field: string;
  baseline: any;
  actual: any;
}> {
  const mismatches: Array<{
    runIndex: number;
    signalId: string;
    field: string;
    baseline: any;
    actual: any;
  }> = [];
  
  // Group by signal ID and agent name
  const baselineMap = new Map<string, AgentActivation>();
  for (const activation of baseline) {
    const key = `${activation.signalId}-${activation.agentName}`;
    baselineMap.set(key, activation);
  }
  
  const actualMap = new Map<string, AgentActivation>();
  for (const activation of actual) {
    const key = `${activation.signalId}-${activation.agentName}`;
    actualMap.set(key, activation);
  }
  
  // Compare activations
  for (const [key, baselineActivation] of baselineMap.entries()) {
    const actualActivation = actualMap.get(key);
    
    if (!actualActivation) {
      mismatches.push({
        runIndex,
        signalId: baselineActivation.signalId,
        field: `agent-${baselineActivation.agentName}`,
        baseline: 'activated',
        actual: 'not activated'
      });
      continue;
    }
    
    // Compare activated status
    if (baselineActivation.activated !== actualActivation.activated) {
      mismatches.push({
        runIndex,
        signalId: baselineActivation.signalId,
        field: `agent-${baselineActivation.agentName}-activated`,
        baseline: baselineActivation.activated,
        actual: actualActivation.activated
      });
    }
    
    // Compare output recommendation
    if (baselineActivation.output.recommendation !== actualActivation.output.recommendation) {
      mismatches.push({
        runIndex,
        signalId: baselineActivation.signalId,
        field: `agent-${baselineActivation.agentName}-recommendation`,
        baseline: baselineActivation.output.recommendation,
        actual: actualActivation.output.recommendation
      });
    }
    
    // Compare output confidence
    const confidenceDiff = Math.abs(
      baselineActivation.output.confidence - actualActivation.output.confidence
    );
    if (confidenceDiff > 0.0001) {
      mismatches.push({
        runIndex,
        signalId: baselineActivation.signalId,
        field: `agent-${baselineActivation.agentName}-confidence`,
        baseline: baselineActivation.output.confidence,
        actual: actualActivation.output.confidence
      });
    }
  }
  
  return mismatches;
}

/**
 * Compare routing decisions between two runs
 * 
 * @param baseline - Baseline routing decisions
 * @param actual - Actual routing decisions
 * @param runIndex - Index of the current run
 * @returns Array of mismatches
 */
function compareRoutingDecisions(
  baseline: VariantAssignment[],
  actual: VariantAssignment[],
  runIndex: number
): Array<{
  runIndex: number;
  signalId: string;
  field: string;
  baseline: any;
  actual: any;
}> {
  const mismatches: Array<{
    runIndex: number;
    signalId: string;
    field: string;
    baseline: any;
    actual: any;
  }> = [];
  
  // Create maps for easier comparison
  const baselineMap = new Map<string, VariantAssignment>();
  for (const assignment of baseline) {
    baselineMap.set(assignment.signalId, assignment);
  }
  
  const actualMap = new Map<string, VariantAssignment>();
  for (const assignment of actual) {
    actualMap.set(assignment.signalId, assignment);
  }
  
  // Compare assignments
  for (const [signalId, baselineAssignment] of baselineMap.entries()) {
    const actualAssignment = actualMap.get(signalId);
    
    if (!actualAssignment) {
      mismatches.push({
        runIndex,
        signalId,
        field: 'routing-existence',
        baseline: 'present',
        actual: 'missing'
      });
      continue;
    }
    
    // Compare variant
    if (baselineAssignment.variant !== actualAssignment.variant) {
      mismatches.push({
        runIndex,
        signalId,
        field: 'routing-variant',
        baseline: baselineAssignment.variant,
        actual: actualAssignment.variant
      });
    }
  }
  
  return mismatches;
}
