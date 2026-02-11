/**
 * Configuration for GTM Launch Readiness Validation Framework
 */

import { ValidationCategory, CriticalityLevel } from './types/index.js';

/**
 * Validation configuration
 */
export interface ValidationConfig {
  // Minimum readiness score required for launch (0-100)
  minReadinessScore: number;
  
  // Property-based test iterations
  propertyTestIterations: number;
  
  // Timeout for individual validations (ms)
  validationTimeout: number;
  
  // Timeout for complete validation suite (ms)
  suiteTimeout: number;
  
  // Category criticality weights for readiness score calculation
  categoryWeights: Map<ValidationCategory, number>;
  
  // Category criticality levels
  categoryCriticality: Map<ValidationCategory, CriticalityLevel>;
  
  // Enable parallel validation execution
  enableParallelExecution: boolean;
  
  // Maximum concurrent validations
  maxConcurrentValidations: number;
}

/**
 * Default validation configuration
 */
export const defaultValidationConfig: ValidationConfig = {
  minReadinessScore: 95,
  propertyTestIterations: 100,
  validationTimeout: 30000, // 30 seconds
  suiteTimeout: 300000, // 5 minutes
  
  // Criticality weights (higher = more important)
  categoryWeights: new Map([
    [ValidationCategory.WEBHOOK_INFRASTRUCTURE, 10],
    [ValidationCategory.SIGNAL_PROCESSING, 10],
    [ValidationCategory.ENGINE_A, 9],
    [ValidationCategory.ENGINE_B, 9],
    [ValidationCategory.STRIKE_SELECTION, 8],
    [ValidationCategory.STRATEGY_ROUTING, 9],
    [ValidationCategory.SIGNAL_DELIVERY, 10],
    [ValidationCategory.PERFORMANCE_TRACKING, 7],
    [ValidationCategory.ACCESS_CONTROL, 10],
    [ValidationCategory.MONITORING, 8],
    [ValidationCategory.END_TO_END, 10],
    [ValidationCategory.KILL_SWITCHES, 10],
  ]),
  
  // Criticality levels
  categoryCriticality: new Map([
    [ValidationCategory.WEBHOOK_INFRASTRUCTURE, 'CRITICAL'],
    [ValidationCategory.SIGNAL_PROCESSING, 'CRITICAL'],
    [ValidationCategory.ENGINE_A, 'HIGH'],
    [ValidationCategory.ENGINE_B, 'HIGH'],
    [ValidationCategory.STRIKE_SELECTION, 'HIGH'],
    [ValidationCategory.STRATEGY_ROUTING, 'HIGH'],
    [ValidationCategory.SIGNAL_DELIVERY, 'CRITICAL'],
    [ValidationCategory.PERFORMANCE_TRACKING, 'MEDIUM'],
    [ValidationCategory.ACCESS_CONTROL, 'CRITICAL'],
    [ValidationCategory.MONITORING, 'HIGH'],
    [ValidationCategory.END_TO_END, 'CRITICAL'],
    [ValidationCategory.KILL_SWITCHES, 'CRITICAL'],
  ]),
  
  enableParallelExecution: true,
  maxConcurrentValidations: 4,
};

/**
 * Get validation configuration
 * Can be overridden via environment variables
 */
export function getValidationConfig(): ValidationConfig {
  return {
    ...defaultValidationConfig,
    minReadinessScore: parseInt(process.env.MIN_READINESS_SCORE || '95', 10),
    propertyTestIterations: parseInt(process.env.PROPERTY_TEST_ITERATIONS || '100', 10),
    validationTimeout: parseInt(process.env.VALIDATION_TIMEOUT || '30000', 10),
    suiteTimeout: parseInt(process.env.SUITE_TIMEOUT || '300000', 10),
    enableParallelExecution: process.env.ENABLE_PARALLEL_VALIDATION !== 'false',
    maxConcurrentValidations: parseInt(process.env.MAX_CONCURRENT_VALIDATIONS || '4', 10),
  };
}
