/**
 * Core types for GTM Launch Readiness Validation Framework
 * 
 * This module defines the foundational types used throughout the validation system.
 */

/**
 * Validation categories representing different system components to validate
 */
export enum ValidationCategory {
  WEBHOOK_INFRASTRUCTURE = 'WEBHOOK_INFRASTRUCTURE',
  SIGNAL_PROCESSING = 'SIGNAL_PROCESSING',
  ENGINE_A = 'ENGINE_A',
  ENGINE_B = 'ENGINE_B',
  STRIKE_SELECTION = 'STRIKE_SELECTION',
  STRATEGY_ROUTING = 'STRATEGY_ROUTING',
  SIGNAL_DELIVERY = 'SIGNAL_DELIVERY',
  PERFORMANCE_TRACKING = 'PERFORMANCE_TRACKING',
  ACCESS_CONTROL = 'ACCESS_CONTROL',
  MONITORING = 'MONITORING',
  END_TO_END = 'END_TO_END',
  KILL_SWITCHES = 'KILL_SWITCHES',
}

/**
 * Overall validation status
 */
export type ValidationStatus = 'PASS' | 'FAIL' | 'PARTIAL' | 'RUNNING';

/**
 * Issue severity levels
 */
export type IssueSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Criticality levels for validation categories
 */
export type CriticalityLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Represents a single validation failure
 */
export interface ValidationFailure {
  testName: string;
  expectedOutcome: string;
  actualOutcome: string;
  errorMessage: string;
  stackTrace?: string;
  context: Record<string, any>;
}

/**
 * Result of a single validation category
 */
export interface ValidationResult {
  category: ValidationCategory;
  status: Exclude<ValidationStatus, 'RUNNING'>;
  testsPassed: number;
  testsFailed: number;
  executionTime: number;
  timestamp: Date;
  failures: ValidationFailure[];
}

/**
 * Blocking issue that prevents launch
 */
export interface Issue {
  category: ValidationCategory;
  severity: IssueSeverity;
  description: string;
  remediation: string;
  blocking: boolean;
}

/**
 * Complete validation report
 */
export interface ValidationReport {
  overallStatus: Exclude<ValidationStatus, 'RUNNING'>;
  readinessScore: number; // 0-100
  categoryResults: Map<ValidationCategory, ValidationResult>;
  executionTime: number;
  timestamp: Date;
  blockingIssues: Issue[];
  recommendations: string[];
}

/**
 * Validation status display for dashboard
 */
export interface ValidationStatusDisplay {
  category: ValidationCategory;
  status: ValidationStatus;
  testsPassed: number;
  totalTests: number;
  lastRun: Date;
  criticality: CriticalityLevel;
}
