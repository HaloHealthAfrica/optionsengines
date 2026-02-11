/**
 * Logging and Attribution Validator
 * 
 * Validates logging and attribution including:
 * - Backend logging completeness
 * - All required fields present
 * - Correct attribution
 * - GEX regime logging
 * - Frontend-backend consistency
 * 
 * Requirements: 11.1-11.9, 10.5
 */

import { SystemState } from '../orchestration/test-orchestrator';
import { ValidationResult, LoggingExpectation, FrontendState, GEXRegimeExpectation } from './validation-framework';

/**
 * Validate logging and attribution
 * 
 * @param state - Captured system state
 * @param expected - Expected logging behavior
 * @returns Validation result
 */
export function validateLogging(
  state: SystemState,
  expected: LoggingExpectation
): ValidationResult {
  const errors: string[] = [];
  const details: any = {};
  
  // Validate logging completeness (Requirements 11.1-11.5)
  const completenessValid = validateLoggingCompleteness(state, expected);
  if (!completenessValid.valid) {
    errors.push(completenessValid.error!);
    details.completeness = completenessValid.details;
  }
  
  // Validate required fields (Requirements 11.1-11.5)
  const fieldsValid = validateRequiredFields(state, expected);
  if (!fieldsValid.valid) {
    errors.push(fieldsValid.error!);
    details.requiredFields = fieldsValid.details;
  }
  
  // Validate attribution (Requirements 11.1-11.5)
  const attributionValid = validateAttribution(state, expected);
  if (!attributionValid.valid) {
    errors.push(attributionValid.error!);
    details.attribution = attributionValid.details;
  }
  
  // Validate GEX regime logging (Requirement 10.5)
  if (expected.expectedGEXRegime) {
    const gexValid = validateGEXLogging(state, expected);
    if (!gexValid.valid) {
      errors.push(gexValid.error!);
      details.gexLogging = gexValid.details;
    }
  }
  
  const passed = errors.length === 0;
  
  return {
    passed,
    phase: 'Logging and Attribution',
    requirement: 'Requirements 11.1-11.5, 10.5',
    message: passed
      ? 'Logging validation passed'
      : `Logging validation failed: ${errors.join('; ')}`,
    details: Object.keys(details).length > 0 ? details : undefined,
    expected: passed ? undefined : expected,
    actual: passed ? undefined : {
      logCount: state.logs.length,
      sampleLogs: state.logs.slice(0, 3)
    }
  };
}

/**
 * Validate frontend-backend consistency
 * 
 * @param frontendState - Captured frontend state
 * @param backendState - Captured backend state
 * @returns Validation result
 */
export function validateFrontend(
  frontendState: FrontendState,
  backendState: SystemState
): ValidationResult {
  const errors: string[] = [];
  const details: any = {};
  
  // Validate that frontend displays match backend logs (Requirements 11.6-11.9)
  const consistencyValid = validateFrontendBackendConsistency(frontendState, backendState);
  if (!consistencyValid.valid) {
    errors.push(consistencyValid.error!);
    details.consistency = consistencyValid.details;
  }
  
  const passed = errors.length === 0;
  
  return {
    passed,
    phase: 'Frontend-Backend Consistency',
    requirement: 'Requirements 11.6-11.9',
    message: passed
      ? 'Frontend validation passed'
      : `Frontend validation failed: ${errors.join('; ')}`,
    details: Object.keys(details).length > 0 ? details : undefined,
    expected: passed ? undefined : { backendState },
    actual: passed ? undefined : { frontendState }
  };
}

/**
 * Validate GEX regime attribution and logging
 * 
 * @param state - System state
 * @param expected - Expected GEX regime behavior
 * @returns Validation result
 */
export function validateGEXRegime(
  state: SystemState,
  expected: GEXRegimeExpectation
): ValidationResult {
  const logsWithGex = state.logs.filter((log: any) => log.gexRegime);

  if (expected.expectedGEXAttribution && logsWithGex.length === 0) {
    return {
      passed: false,
      phase: 'GEX Regime',
      requirement: 'Requirements 10.1-10.5',
      message: 'GEX regime attribution missing from logs',
      details: { expectedRegime: expected.expectedRegime }
    };
  }

  const hasExpectedRegime = logsWithGex.some((log: any) => log.gexRegime === expected.expectedRegime);
  if (expected.expectedGEXAttribution && !hasExpectedRegime) {
    return {
      passed: false,
      phase: 'GEX Regime',
      requirement: 'Requirements 10.1-10.5',
      message: 'GEX regime logs do not match expected regime',
      details: {
        expectedRegime: expected.expectedRegime,
        sampleRegimes: logsWithGex.slice(0, 3).map((log: any) => log.gexRegime)
      }
    };
  }

  return {
    passed: true,
    phase: 'GEX Regime',
    requirement: 'Requirements 10.1-10.5',
    message: 'GEX regime validation passed'
  };
}

/**
 * Validate logging completeness
 * 
 * @param state - System state
 * @param expected - Expected logging behavior
 * @returns Validation result with details
 */
function validateLoggingCompleteness(
  state: SystemState,
  _expected: LoggingExpectation
): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  // Check that we have logs for all decisions
  const decisionCount = state.engineADecisions.length + state.engineBDecisions.length;
  
  if (state.logs.length === 0 && decisionCount > 0) {
    return {
      valid: false,
      error: 'Logging completeness validation failed: no logs found for decisions',
      details: {
        decisionCount,
        logCount: 0
      }
    };
  }
  
  return { valid: true };
}

/**
 * Validate required fields in log entries
 * 
 * @param state - System state
 * @param expected - Expected logging behavior
 * @returns Validation result with details
 */
function validateRequiredFields(
  state: SystemState,
  expected: LoggingExpectation
): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  const missingFields: Record<string, string[]> = {};
  
  for (const log of state.logs) {
    const missing: string[] = [];
    
    for (const field of expected.requiredFields) {
      if (!(field in log) || (log as any)[field] === undefined) {
        missing.push(field);
      }
    }
    
    if (missing.length > 0) {
      const logId = `${log.timestamp}-${log.signalId}`;
      missingFields[logId] = missing;
    }
  }
  
  if (Object.keys(missingFields).length > 0) {
    return {
      valid: false,
      error: 'Required fields validation failed: missing fields in log entries',
      details: {
        requiredFields: expected.requiredFields,
        missingFields
      }
    };
  }
  
  return { valid: true };
}

/**
 * Validate attribution in log entries
 * 
 * @param state - System state
 * @param expected - Expected logging behavior
 * @returns Validation result with details
 */
function validateAttribution(
  state: SystemState,
  expected: LoggingExpectation
): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  const mismatches: Array<{
    logId: string;
    field: string;
    expected: any;
    actual: any;
  }> = [];
  
  for (const log of state.logs) {
    // Validate variant
    if (log.variant !== expected.expectedVariant) {
      mismatches.push({
        logId: `${log.timestamp}-${log.signalId}`,
        field: 'variant',
        expected: expected.expectedVariant,
        actual: log.variant
      });
    }
    
    // Validate execution label
    if (log.executionLabel !== expected.expectedExecutionLabel) {
      mismatches.push({
        logId: `${log.timestamp}-${log.signalId}`,
        field: 'executionLabel',
        expected: expected.expectedExecutionLabel,
        actual: log.executionLabel
      });
    }
    
    // Validate agents (for Engine B)
    if (expected.expectedAgents && expected.expectedVariant === 'B') {
      if (!log.agents || log.agents.length === 0) {
        mismatches.push({
          logId: `${log.timestamp}-${log.signalId}`,
          field: 'agents',
          expected: expected.expectedAgents,
          actual: log.agents || []
        });
      } else {
        const missingAgents = expected.expectedAgents.filter(
          agent => !log.agents!.includes(agent)
        );
        
        if (missingAgents.length > 0) {
          mismatches.push({
            logId: `${log.timestamp}-${log.signalId}`,
            field: 'agents',
            expected: expected.expectedAgents,
            actual: log.agents
          });
        }
      }
    }
    
    // Validate confidence (with tolerance)
    if (expected.expectedConfidence !== undefined && log.confidence !== undefined) {
      const tolerance = expected.confidenceTolerance || 0.01;
      const diff = Math.abs(log.confidence - expected.expectedConfidence);
      
      if (diff > tolerance) {
        mismatches.push({
          logId: `${log.timestamp}-${log.signalId}`,
          field: 'confidence',
          expected: expected.expectedConfidence,
          actual: log.confidence
        });
      }
    }
  }
  
  if (mismatches.length > 0) {
    return {
      valid: false,
      error: 'Attribution validation failed: mismatches in log entries',
      details: { mismatches }
    };
  }
  
  return { valid: true };
}

/**
 * Validate GEX regime logging
 * 
 * @param state - System state
 * @param expected - Expected logging behavior
 * @returns Validation result with details
 */
function validateGEXLogging(
  state: SystemState,
  expected: LoggingExpectation
): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  const logsWithoutGEX: string[] = [];
  
  for (const log of state.logs) {
    if (!log.gexRegime) {
      logsWithoutGEX.push(`${log.timestamp}-${log.signalId}`);
    } else if (log.gexRegime !== expected.expectedGEXRegime) {
      return {
        valid: false,
        error: 'GEX logging validation failed: incorrect GEX regime in logs',
        details: {
          expected: expected.expectedGEXRegime,
          actual: log.gexRegime,
          logId: `${log.timestamp}-${log.signalId}`
        }
      };
    }
  }
  
  if (logsWithoutGEX.length > 0) {
    return {
      valid: false,
      error: 'GEX logging validation failed: logs missing GEX regime',
      details: {
        logsWithoutGEX,
        expectedGEXRegime: expected.expectedGEXRegime
      }
    };
  }
  
  return { valid: true };
}

/**
 * Validate frontend-backend consistency
 * 
 * @param frontendState - Frontend state
 * @param backendState - Backend state
 * @returns Validation result with details
 */
function validateFrontendBackendConsistency(
  frontendState: FrontendState,
  backendState: SystemState
): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  const mismatches: Array<{
    signalId: string;
    field: string;
    frontend: any;
    backend: any;
  }> = [];
  
  for (const frontendSignal of frontendState.displayedSignals) {
    // Find corresponding backend log
    const backendLog = backendState.logs.find(
      log => log.signalId === frontendSignal.signalId
    );
    
    if (!backendLog) {
      mismatches.push({
        signalId: frontendSignal.signalId,
        field: 'existence',
        frontend: 'displayed',
        backend: 'not found in logs'
      });
      continue;
    }
    
    // Validate variant
    if (frontendSignal.variant !== backendLog.variant) {
      mismatches.push({
        signalId: frontendSignal.signalId,
        field: 'variant',
        frontend: frontendSignal.variant,
        backend: backendLog.variant
      });
    }
    
    // Validate execution label
    if (frontendSignal.executionLabel !== backendLog.executionLabel) {
      mismatches.push({
        signalId: frontendSignal.signalId,
        field: 'executionLabel',
        frontend: frontendSignal.executionLabel,
        backend: backendLog.executionLabel
      });
    }
    
    // Validate agents (for Engine B)
    if (frontendSignal.variant === 'B' && backendLog.agents) {
      const frontendAgents = new Set(frontendSignal.agents);
      const backendAgents = new Set(backendLog.agents);
      
      const agentsMatch = 
        frontendAgents.size === backendAgents.size &&
        Array.from(frontendAgents).every(a => backendAgents.has(a));
      
      if (!agentsMatch) {
        mismatches.push({
          signalId: frontendSignal.signalId,
          field: 'agents',
          frontend: frontendSignal.agents,
          backend: backendLog.agents
        });
      }
    }
    
    // Validate confidence (with tolerance)
    if (frontendSignal.confidence !== undefined && backendLog.confidence !== undefined) {
      const diff = Math.abs(frontendSignal.confidence - backendLog.confidence);
      
      if (diff > 0.01) {
        mismatches.push({
          signalId: frontendSignal.signalId,
          field: 'confidence',
          frontend: frontendSignal.confidence,
          backend: backendLog.confidence
        });
      }
    }
  }
  
  if (mismatches.length > 0) {
    return {
      valid: false,
      error: 'Frontend-backend consistency validation failed',
      details: { mismatches }
    };
  }
  
  return { valid: true };
}
