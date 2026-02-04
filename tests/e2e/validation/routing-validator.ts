/**
 * Routing Validator
 * 
 * Validates A/B routing behavior including:
 * - Deterministic variant assignment
 * - Feature flag behavior
 * - Variant distribution
 * - Routing logging completeness
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
 */

import { SystemState } from '../orchestration/test-orchestrator';
import { ValidationResult, RoutingExpectation } from './validation-framework';

/**
 * Validate routing behavior
 * 
 * @param state - Captured system state
 * @param expected - Expected routing behavior
 * @returns Validation result
 */
export function validateRouting(
  state: SystemState,
  expected: RoutingExpectation
): ValidationResult {
  const errors: string[] = [];
  const details: any = {};
  
  // Validate variant assignment (Requirements 4.1, 4.2)
  if (state.routerDecisions.length > 0) {
    const variantValid = validateVariantAssignment(state, expected);
    if (!variantValid.valid) {
      errors.push(variantValid.error!);
      details.variantAssignment = variantValid.details;
    }
  }
  
  // Validate determinism (Requirement 4.2)
  if (expected.expectedDeterminism) {
    const determinismValid = validateRoutingDeterminism(state);
    if (!determinismValid.valid) {
      errors.push(determinismValid.error!);
      details.determinism = determinismValid.details;
    }
  }
  
  // Validate feature flag behavior (Requirement 4.3)
  if (expected.expectedFeatureFlagBehavior) {
    const featureFlagValid = validateFeatureFlagBehavior(state);
    if (!featureFlagValid.valid) {
      errors.push(featureFlagValid.error!);
      details.featureFlags = featureFlagValid.details;
    }
  }
  
  // Validate logging completeness (Requirement 4.4)
  if (expected.expectedLoggingFields) {
    const loggingValid = validateRoutingLogging(state, expected.expectedLoggingFields);
    if (!loggingValid.valid) {
      errors.push(loggingValid.error!);
      details.logging = loggingValid.details;
    }
  }
  
  // Validate variant distribution (Requirement 4.5)
  if (expected.expectedDistribution) {
    const distributionValid = validateVariantDistribution(state, expected.expectedDistribution);
    if (!distributionValid.valid) {
      errors.push(distributionValid.error!);
      details.distribution = distributionValid.details;
    }
  }
  
  const passed = errors.length === 0;
  
  return {
    passed,
    phase: 'Strategy Router',
    requirement: 'Requirements 4.1, 4.2, 4.3, 4.4, 4.5',
    message: passed
      ? 'Routing validation passed'
      : `Routing validation failed: ${errors.join('; ')}`,
    details: Object.keys(details).length > 0 ? details : undefined,
    expected: passed ? undefined : expected,
    actual: passed ? undefined : {
      routerDecisions: state.routerDecisions,
      variantCounts: countVariants(state)
    }
  };
}

/**
 * Validate variant assignment matches expected
 * 
 * @param state - System state
 * @param expected - Expected routing behavior
 * @returns Validation result with details
 */
function validateVariantAssignment(
  state: SystemState,
  expected: RoutingExpectation
): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  // Check if all assignments match expected variant (for single-variant tests)
  const unexpectedVariants = state.routerDecisions.filter(
    d => d.variant !== expected.expectedVariant
  );
  
  if (unexpectedVariants.length > 0 && expected.expectedDistribution === undefined) {
    return {
      valid: false,
      error: `Unexpected variant assignments: expected all ${expected.expectedVariant}, found ${unexpectedVariants.length} mismatches`,
      details: {
        expectedVariant: expected.expectedVariant,
        unexpectedAssignments: unexpectedVariants.map(d => ({
          signalId: d.signalId,
          variant: d.variant,
          reason: d.reason
        }))
      }
    };
  }
  
  return { valid: true };
}

/**
 * Validate routing determinism
 * 
 * @param state - System state
 * @returns Validation result with details
 */
function validateRoutingDeterminism(state: SystemState): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  // Check that each signal has exactly one routing decision
  const signalCounts = new Map<string, number>();
  
  for (const decision of state.routerDecisions) {
    const count = signalCounts.get(decision.signalId) || 0;
    signalCounts.set(decision.signalId, count + 1);
  }
  
  const duplicates = Array.from(signalCounts.entries())
    .filter(([_, count]) => count > 1);
  
  if (duplicates.length > 0) {
    return {
      valid: false,
      error: 'Routing determinism validation failed: duplicate routing decisions found',
      details: {
        duplicates: duplicates.map(([signalId, count]) => ({
          signalId,
          count
        }))
      }
    };
  }
  
  return { valid: true };
}

/**
 * Validate feature flag behavior
 * 
 * @param state - System state
 * @returns Validation result with details
 */
function validateFeatureFlagBehavior(state: SystemState): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  // Check that feature flags are consistently applied
  const featureFlagSets = new Set<string>();
  
  for (const decision of state.routerDecisions) {
    const flagsJson = JSON.stringify(decision.featureFlags);
    featureFlagSets.add(flagsJson);
  }
  
  // All decisions should have the same feature flags in a single test run
  if (featureFlagSets.size > 1) {
    return {
      valid: false,
      error: 'Feature flag behavior validation failed: inconsistent feature flags across decisions',
      details: {
        uniqueFeatureFlagSets: Array.from(featureFlagSets).map(s => JSON.parse(s))
      }
    };
  }
  
  // If Engine B is disabled, all variants should be A
  if (state.routerDecisions.length > 0) {
    const firstDecision = state.routerDecisions[0];
    const engineBEnabled = firstDecision.featureFlags['engineB'] !== false;
    
    if (!engineBEnabled) {
      const nonAVariants = state.routerDecisions.filter(d => d.variant !== 'A');
      
      if (nonAVariants.length > 0) {
        return {
          valid: false,
          error: 'Feature flag behavior validation failed: Engine B disabled but variant B assigned',
          details: {
            engineBEnabled: false,
            variantBAssignments: nonAVariants.map(d => d.signalId)
          }
        };
      }
    }
  }
  
  return { valid: true };
}

/**
 * Validate routing logging completeness
 * 
 * @param state - System state
 * @param expectedFields - Expected fields in routing logs
 * @returns Validation result with details
 */
function validateRoutingLogging(
  state: SystemState,
  expectedFields: string[]
): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  const missingFields: Record<string, string[]> = {};
  
  for (const decision of state.routerDecisions) {
    const missing: string[] = [];
    
    for (const field of expectedFields) {
      if (!(field in decision) || (decision as any)[field] === undefined) {
        missing.push(field);
      }
    }
    
    if (missing.length > 0) {
      missingFields[decision.signalId] = missing;
    }
  }
  
  if (Object.keys(missingFields).length > 0) {
    return {
      valid: false,
      error: 'Routing logging validation failed: missing required fields',
      details: {
        expectedFields,
        missingFields
      }
    };
  }
  
  return { valid: true };
}

/**
 * Validate variant distribution
 * 
 * @param state - System state
 * @param expectedDistribution - Expected distribution
 * @returns Validation result with details
 */
function validateVariantDistribution(
  state: SystemState,
  expectedDistribution: {
    variantA: number;
    variantB: number;
    tolerance: number;
  }
): {
  valid: boolean;
  error?: string;
  details?: any;
} {
  const counts = countVariants(state);
  const total = counts.A + counts.B;
  
  if (total === 0) {
    return {
      valid: false,
      error: 'Variant distribution validation failed: no routing decisions found',
      details: { counts }
    };
  }
  
  const actualPercentageA = (counts.A / total) * 100;
  const actualPercentageB = (counts.B / total) * 100;
  
  const expectedPercentageA = expectedDistribution.variantA;
  const expectedPercentageB = expectedDistribution.variantB;
  const tolerance = expectedDistribution.tolerance;
  
  const aWithinTolerance = Math.abs(actualPercentageA - expectedPercentageA) <= tolerance;
  const bWithinTolerance = Math.abs(actualPercentageB - expectedPercentageB) <= tolerance;
  
  if (!aWithinTolerance || !bWithinTolerance) {
    return {
      valid: false,
      error: 'Variant distribution validation failed: distribution outside tolerance',
      details: {
        expected: {
          variantA: `${expectedPercentageA}%`,
          variantB: `${expectedPercentageB}%`,
          tolerance: `±${tolerance}%`
        },
        actual: {
          variantA: `${actualPercentageA.toFixed(2)}%`,
          variantB: `${actualPercentageB.toFixed(2)}%`,
          counts
        }
      }
    };
  }
  
  return { valid: true };
}

/**
 * Count variants in routing decisions
 * 
 * @param state - System state
 * @returns Variant counts
 */
function countVariants(state: SystemState): { A: number; B: number } {
  const counts = { A: 0, B: 0 };
  
  for (const decision of state.routerDecisions) {
    counts[decision.variant]++;
  }
  
  return counts;
}
