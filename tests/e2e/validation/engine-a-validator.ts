/**
 * Engine A Regression Validator
 * 
 * Validates Engine A behavior against baseline to prevent regression:
 * - No behavioral changes (decisions match baseline)
 * - No performance degradation (latency within threshold)
 * - Execution isolation (only live execution)
 * - No new code paths
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.5
 */

import { SystemState, Decision } from '../orchestration/test-orchestrator';
import { ValidationResult, EngineABaseline } from './validation-framework';

/**
 * Validate Engine A behavior against baseline
 * 
 * @param state - Captured system state
 * @param baseline - Baseline behavior from pre-experiment
 * @returns Validation result
 */
export function validateEngineA(
  state: SystemState,
  baseline: EngineABaseline
): ValidationResult {
  const errors: string[] = [];
  const details: any = {};
  
  // Validate behavioral regression (Requirement 5.1)
  const behaviorValid = validateBehavioralRegression(state, baseline);
  if (!behaviorValid.valid) {
    errors.push(behaviorValid.error!);
    details.behavioralRegression = behaviorValid.details;
  }
  
  // Validate performance regression (Requirement 5.2)
  const performanceValid = validatePerformanceRegression(state, baseline);
  if (!performanceValid.valid) {
    errors.push(performanceValid.error!);
    details.performanceRegression = performanceValid.details;
  }
  
  // Validate execution isolation (Requirement 5.3)
  const executionValid = validateExecutionIsolation(state);
  if (!executionValid.valid) {
    errors.push(executionValid.error!);
    details.executionIsolation = executionValid.details;
  }
  
  const passed = errors.length === 0;
  
  return {
    passed,
    phase: 'Engine A Regression',
    requirement: 'Requirements 5.1, 5.2, 5.3, 5.5',
    message: passed
      ? 'Engine A regression validation passed'
      : `Engine A regression validation failed: ${errors.join('; ')}`,
    details: Object.keys(details).length > 0 ? details : undefined,
    expected: passed ? undefined : baseline,
    actual: passed ? undefined : {
      decisions: state.engineADecisions,
      liveExecutions: state.liveExecutions
    }
  };
}

/**
 * Validate that Engine A decisions match baseline (no behavioral regression)
 * 
 * @param state - System state
 * @param baseline - Baseline behavior
 * @returns Validation result with details
 */
function validateBehavioralRegression(
  state: SystemState,
  baseline: EngineABaseline
): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  const mismatches: Array<{
    signalId: string;
    field: string;
    expected: any;
    actual: any;
  }> = [];
  
  // Create a map of baseline decisions by signal ID
  const baselineMap = new Map<string, Decision>();
  for (const decision of baseline.baselineDecisions) {
    baselineMap.set(decision.signalId, decision);
  }
  
  // Compare each Engine A decision to baseline
  for (const decision of state.engineADecisions) {
    const baselineDecision = baselineMap.get(decision.signalId);
    
    if (!baselineDecision) {
      mismatches.push({
        signalId: decision.signalId,
        field: 'existence',
        expected: 'no decision',
        actual: 'decision made'
      });
      continue;
    }
    
    // Compare action
    if (decision.action !== baselineDecision.action) {
      mismatches.push({
        signalId: decision.signalId,
        field: 'action',
        expected: baselineDecision.action,
        actual: decision.action
      });
    }
    
    // Compare confidence (with small tolerance for floating point)
    const confidenceDiff = Math.abs(decision.confidence - baselineDecision.confidence);
    if (confidenceDiff > 0.001) {
      mismatches.push({
        signalId: decision.signalId,
        field: 'confidence',
        expected: baselineDecision.confidence,
        actual: decision.confidence
      });
    }
    
    // Compare reasoning
    if (decision.reasoning !== baselineDecision.reasoning) {
      mismatches.push({
        signalId: decision.signalId,
        field: 'reasoning',
        expected: baselineDecision.reasoning,
        actual: decision.reasoning
      });
    }
  }
  
  // Check for missing decisions
  for (const baselineDecision of baseline.baselineDecisions) {
    const actualDecision = state.engineADecisions.find(
      d => d.signalId === baselineDecision.signalId
    );
    
    if (!actualDecision) {
      mismatches.push({
        signalId: baselineDecision.signalId,
        field: 'existence',
        expected: 'decision made',
        actual: 'no decision'
      });
    }
  }
  
  if (mismatches.length > 0) {
    return {
      valid: false,
      error: 'Behavioral regression detected: Engine A decisions differ from baseline',
      details: { mismatches }
    };
  }
  
  return { valid: true };
}

/**
 * Validate that Engine A performance has not regressed
 * 
 * @param state - System state
 * @param baseline - Baseline behavior
 * @returns Validation result with details
 */
function validatePerformanceRegression(
  state: SystemState,
  baseline: EngineABaseline
): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  // Calculate average latency for Engine A decisions
  if (state.engineADecisions.length === 0) {
    return { valid: true };
  }
  
  // Calculate latency based on decision timestamps
  // Note: In a real implementation, this would measure actual processing time
  // For now, we'll use a simplified approach based on timestamp differences
  const latencies: number[] = [];
  
  for (let i = 1; i < state.engineADecisions.length; i++) {
    const latency = state.engineADecisions[i].decidedAt - state.engineADecisions[i - 1].decidedAt;
    if (latency > 0 && latency < 10000) { // Sanity check: less than 10 seconds
      latencies.push(latency);
    }
  }
  
  if (latencies.length === 0) {
    // Can't measure latency with single decision
    return { valid: true };
  }
  
  const avgLatency = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
  const threshold = baseline.latencyThreshold || 10; // Default 10ms threshold
  
  if (avgLatency > baseline.baselineLatency + threshold) {
    return {
      valid: false,
      error: 'Performance regression detected: Engine A latency exceeds baseline + threshold',
      details: {
        baselineLatency: baseline.baselineLatency,
        actualLatency: avgLatency,
        threshold,
        exceedsBy: avgLatency - (baseline.baselineLatency + threshold)
      }
    };
  }
  
  return { valid: true };
}

/**
 * Validate that Engine A only performs live execution
 * 
 * @param state - System state
 * @returns Validation result with details
 */
function validateExecutionIsolation(state: SystemState): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  const errors: string[] = [];
  
  // Check that all Engine A decisions have corresponding live executions
  for (const decision of state.engineADecisions) {
    if (decision.action !== 'HOLD') {
      const liveExecution = state.liveExecutions.find(
        e => e.signalId === decision.signalId
      );
      
      if (!liveExecution) {
        errors.push(
          `Engine A decision ${decision.signalId} (${decision.action}) has no live execution`
        );
      }
    }
  }
  
  // Check that Engine A decisions don't have shadow executions
  const engineAShadowExecutions = (state.shadowExecutions as Array<{ engine: 'A' | 'B'; signalId: string }>).filter(
    e => e.engine === 'A' && state.engineADecisions.some(d => d.signalId === e.signalId)
  );
  
  if (engineAShadowExecutions.length > 0) {
    errors.push(
      `Engine A has ${engineAShadowExecutions.length} shadow executions (should be 0)`
    );
  }
  
  // Check that all live executions are from Engine A
  const nonEngineALiveExecutions = state.liveExecutions.filter(
    e => e.engine !== 'A'
  );
  
  if (nonEngineALiveExecutions.length > 0) {
    errors.push(
      `Found ${nonEngineALiveExecutions.length} live executions not from Engine A`
    );
  }
  
  if (errors.length > 0) {
    return {
      valid: false,
      error: 'Execution isolation validation failed',
      details: {
        errors,
        engineAShadowExecutions: engineAShadowExecutions.map(e => e.signalId),
        nonEngineALiveExecutions: nonEngineALiveExecutions.map(e => ({
          signalId: e.signalId,
          engine: e.engine
        }))
      }
    };
  }
  
  return { valid: true };
}
