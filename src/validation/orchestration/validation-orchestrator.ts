/**
 * Validation Orchestrator for GTM Launch Readiness
 * 
 * Coordinates validation execution across all validators:
 * - Executes validations in dependency order
 * - Handles parallel execution where possible
 * - Implements continue-on-failure behavior
 * - Generates comprehensive validation reports
 * - Supports automated scheduling
 * - Provides JSON export for CI/CD integration
 */

import {
  ValidationResult,
  ValidationCategory,
  ValidationReport,
  Issue,
} from '../types/index.js';
import {
  WebhookValidator,
  SignalProcessingValidator,
  EngineAValidator,
  EngineBValidator,
  StrikeSelectionValidator,
  StrategyRouterValidator,
  DeliverySystemValidator,
  PerformanceTrackerValidator,
  AccessControlValidator,
  MonitoringSystemValidator,
  E2EIntegrationValidator,
  KillSwitchValidator,
} from '../validators/index.js';

/**
 * Validation Orchestrator
 */
export class ValidationOrchestrator {
  private webhookValidator: WebhookValidator;
  private signalProcessingValidator: SignalProcessingValidator;
  private engineAValidator: EngineAValidator;
  private engineBValidator: EngineBValidator;
  private strikeSelectionValidator: StrikeSelectionValidator;
  private strategyRouterValidator: StrategyRouterValidator;
  private deliverySystemValidator: DeliverySystemValidator;
  private performanceTrackerValidator: PerformanceTrackerValidator;
  private accessControlValidator: AccessControlValidator;
  private monitoringSystemValidator: MonitoringSystemValidator;
  private e2eIntegrationValidator: E2EIntegrationValidator;
  private killSwitchValidator: KillSwitchValidator;

  constructor() {
    this.webhookValidator = new WebhookValidator('https://test.webhook.url', 'test-secret');
    this.signalProcessingValidator = new SignalProcessingValidator();
    this.engineAValidator = new EngineAValidator();
    this.engineBValidator = new EngineBValidator();
    this.strikeSelectionValidator = new StrikeSelectionValidator();
    this.strategyRouterValidator = new StrategyRouterValidator();
    this.deliverySystemValidator = new DeliverySystemValidator();
    this.performanceTrackerValidator = new PerformanceTrackerValidator();
    this.accessControlValidator = new AccessControlValidator();
    this.monitoringSystemValidator = new MonitoringSystemValidator();
    this.e2eIntegrationValidator = new E2EIntegrationValidator();
    this.killSwitchValidator = new KillSwitchValidator();
  }

  /**
   * Execute all validations in dependency order
   * Requirements: 14.1
   */
  async runFullValidation(): Promise<ValidationReport> {
    const startTime = Date.now();
    const categoryResults = new Map<ValidationCategory, ValidationResult>();
    const blockingIssues: Issue[] = [];

    try {
      // Execute validations in dependency order
      // Phase 1: Infrastructure (can run in parallel)
      const phase1Results = await Promise.all([
        this.runValidation(ValidationCategory.WEBHOOK_INFRASTRUCTURE),
        this.runValidation(ValidationCategory.ACCESS_CONTROL),
        this.runValidation(ValidationCategory.MONITORING),
      ]);
      
      phase1Results.forEach(result => {
        categoryResults.set(result.category, result);
        if (result.status === 'FAIL') {
          blockingIssues.push({
            category: result.category,
            severity: 'CRITICAL',
            description: `${result.category} validation failed`,
            remediation: 'Review failure details and fix issues',
            blocking: true,
          });
        }
      });

      // Phase 2: Processing (depends on webhook)
      const signalProcessingResult = await this.runValidation(ValidationCategory.SIGNAL_PROCESSING);
      categoryResults.set(signalProcessingResult.category, signalProcessingResult);
      if (signalProcessingResult.status === 'FAIL') {
        blockingIssues.push({
          category: signalProcessingResult.category,
          severity: 'CRITICAL',
          description: 'Signal processing validation failed',
          remediation: 'Review signal processing logic',
          blocking: true,
        });
      }

      // Phase 3: Decision engines and routing (can run in parallel)
      const phase3Results = await Promise.all([
        this.runValidation(ValidationCategory.ENGINE_A),
        this.runValidation(ValidationCategory.ENGINE_B),
        this.runValidation(ValidationCategory.STRIKE_SELECTION),
        this.runValidation(ValidationCategory.STRATEGY_ROUTING),
      ]);
      
      phase3Results.forEach(result => {
        categoryResults.set(result.category, result);
        if (result.status === 'FAIL') {
          blockingIssues.push({
            category: result.category,
            severity: 'HIGH',
            description: `${result.category} validation failed`,
            remediation: 'Review engine logic and configuration',
            blocking: true,
          });
        }
      });

      // Phase 4: Delivery and tracking (can run in parallel)
      const phase4Results = await Promise.all([
        this.runValidation(ValidationCategory.SIGNAL_DELIVERY),
        this.runValidation(ValidationCategory.PERFORMANCE_TRACKING),
      ]);
      
      phase4Results.forEach(result => {
        categoryResults.set(result.category, result);
        if (result.status === 'FAIL') {
          blockingIssues.push({
            category: result.category,
            severity: 'HIGH',
            description: `${result.category} validation failed`,
            remediation: 'Review delivery and tracking systems',
            blocking: true,
          });
        }
      });

      // Phase 5: End-to-end and safety (depends on all previous)
      const phase5Results = await Promise.all([
        this.runValidation(ValidationCategory.END_TO_END),
        this.runValidation(ValidationCategory.KILL_SWITCHES),
      ]);
      
      phase5Results.forEach(result => {
        categoryResults.set(result.category, result);
        if (result.status === 'FAIL') {
          blockingIssues.push({
            category: result.category,
            severity: 'CRITICAL',
            description: `${result.category} validation failed`,
            remediation: 'Review end-to-end flow and safety mechanisms',
            blocking: true,
          });
        }
      });

    } catch (error) {
      blockingIssues.push({
        category: ValidationCategory.END_TO_END,
        severity: 'CRITICAL',
        description: 'Validation orchestration failed',
        remediation: 'Review orchestrator logs for details',
        blocking: true,
      });
    }

    // Calculate readiness score
    const totalTests = Array.from(categoryResults.values()).reduce(
      (sum, result) => sum + result.testsPassed + result.testsFailed,
      0
    );
    const passedTests = Array.from(categoryResults.values()).reduce(
      (sum, result) => sum + result.testsPassed,
      0
    );
    const readinessScore = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;

    // Determine overall status
    const failedCategories = Array.from(categoryResults.values()).filter(r => r.status === 'FAIL');
    const overallStatus: 'PASS' | 'FAIL' | 'PARTIAL' = 
      failedCategories.length === 0 ? 'PASS' :
      failedCategories.length === categoryResults.size ? 'FAIL' :
      'PARTIAL';

    return {
      overallStatus,
      readinessScore,
      categoryResults,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      blockingIssues,
      recommendations: this.generateRecommendations(categoryResults, readinessScore),
    };
  }

  /**
   * Execute specific validation category (runs ALL validation methods for the category)
   * Requirements: 14.1
   */
  async runValidation(category: ValidationCategory): Promise<ValidationResult> {
    const startTime = Date.now();
    let results: ValidationResult[];

    switch (category) {
      case ValidationCategory.WEBHOOK_INFRASTRUCTURE:
        results = await Promise.all([
          this.webhookValidator.validateWebhookUrl(),
          this.webhookValidator.validateAuthenticationSuccess(),
          this.webhookValidator.validateAuthenticationFailure(),
          this.webhookValidator.validatePayloadLogging(),
          this.webhookValidator.validatePayloadValidation(),
          this.webhookValidator.validateRetryMechanism(),
          this.webhookValidator.validateIdempotency(),
          this.webhookValidator.validateDeadLetterQueue(),
        ]);
        break;
      case ValidationCategory.SIGNAL_PROCESSING:
        results = await Promise.all([
          this.signalProcessingValidator.validateFieldExtraction(),
          this.signalProcessingValidator.validateNormalization(),
          this.signalProcessingValidator.validateMarketEnrichment(),
          this.signalProcessingValidator.validateVersioning(),
          this.signalProcessingValidator.validateMissingFieldRejection(),
          this.signalProcessingValidator.validateConfidenceNormalization(),
        ]);
        break;
      case ValidationCategory.ENGINE_A:
        results = await Promise.all([
          this.engineAValidator.validateTierEvaluationOrder(),
          this.engineAValidator.validateTier1Rejection(),
          this.engineAValidator.validateTier2Queueing(),
          this.engineAValidator.validateExitTiers(),
          this.engineAValidator.validateExitRecommendation(),
          this.engineAValidator.validateNoActionRecommendation(),
        ]);
        break;
      case ValidationCategory.ENGINE_B:
        results = await Promise.all([
          this.engineBValidator.validateMetaAgentOrchestration(),
          this.engineBValidator.validateAgentContext(),
          this.engineBValidator.validateConfidenceNormalization(),
          this.engineBValidator.validateWeightedVoting(),
          this.engineBValidator.validateRiskAgentVeto(),
          this.engineBValidator.validateDisagreementFlagging(),
          this.engineBValidator.validateGEXLogic(),
        ]);
        break;
      case ValidationCategory.STRIKE_SELECTION:
        results = await Promise.all([
          this.strikeSelectionValidator.validateStrikeFiltering(),
          this.strikeSelectionValidator.validateStrikeScoring(),
          this.strikeSelectionValidator.validateStrikeRanking(),
          this.strikeSelectionValidator.validateGreeksCalculation(),
          this.strikeSelectionValidator.validateOutputFormatting(),
        ]);
        break;
      case ValidationCategory.STRATEGY_ROUTING:
        results = await Promise.all([
          this.strategyRouterValidator.validateRouting(),
          this.strategyRouterValidator.validateShadowExecution(),
          this.strategyRouterValidator.validateConfigurationIsolation(),
        ]);
        break;
      case ValidationCategory.SIGNAL_DELIVERY:
        results = await Promise.all([
          this.deliverySystemValidator.validateSignalQueueing(),
          this.deliverySystemValidator.validateDashboardDelivery(),
          this.deliverySystemValidator.validateDeliveryConfirmation(),
          this.deliverySystemValidator.validateDeliveryRetries(),
          this.deliverySystemValidator.validateLatencyTracking(),
        ]);
        break;
      case ValidationCategory.PERFORMANCE_TRACKING:
        results = await Promise.all([
          this.performanceTrackerValidator.validateTradeRecordCreation(),
          this.performanceTrackerValidator.validatePnLCalculation(),
          this.performanceTrackerValidator.validateMetricsCalculation(),
          this.performanceTrackerValidator.validateAggregationAndDisplay(),
        ]);
        break;
      case ValidationCategory.ACCESS_CONTROL:
        results = await Promise.all([
          this.accessControlValidator.validateAuthentication(),
          this.accessControlValidator.validateSubscriptionEnforcement(),
          this.accessControlValidator.validateUsageLimits(),
          this.accessControlValidator.validateAdminRevocation(),
        ]);
        break;
      case ValidationCategory.MONITORING:
        results = await Promise.all([
          this.monitoringSystemValidator.validateHealthChecks(),
          this.monitoringSystemValidator.validateLatencyMeasurement(),
          this.monitoringSystemValidator.validateErrorCapture(),
          this.monitoringSystemValidator.validateErrorAlerting(),
          this.monitoringSystemValidator.validateAdminDashboard(),
          this.monitoringSystemValidator.validateServiceDegradation(),
        ]);
        break;
      case ValidationCategory.END_TO_END:
        results = await Promise.all([
          this.e2eIntegrationValidator.validateE2EFlow(),
          this.e2eIntegrationValidator.validateHappyPath(),
          this.e2eIntegrationValidator.validateRejectionPath(),
          this.e2eIntegrationValidator.validateErrorHandling(),
          this.e2eIntegrationValidator.validateConcurrentProcessing(),
          this.e2eIntegrationValidator.validateE2EIdempotency(),
        ]);
        break;
      case ValidationCategory.KILL_SWITCHES:
        results = await Promise.all([
          this.killSwitchValidator.validateGlobalKillSwitch(),
          this.killSwitchValidator.validateStrategyKillSwitch(),
          this.killSwitchValidator.validateUserKillSwitch(),
          this.killSwitchValidator.validateKillSwitchRecovery(),
          this.killSwitchValidator.validateCircuitBreaker(),
        ]);
        break;
      default:
        throw new Error(`Unknown validation category: ${category}`);
    }

    // Aggregate results from all validation methods
    const totalPassed = results.reduce((sum, r) => sum + r.testsPassed, 0);
    const totalFailed = results.reduce((sum, r) => sum + r.testsFailed, 0);
    const allFailures = results.flatMap(r => r.failures);
    const overallStatus: 'PASS' | 'FAIL' | 'PARTIAL' = 
      totalFailed === 0 ? 'PASS' :
      totalPassed === 0 ? 'FAIL' :
      'PARTIAL';

    return {
      category,
      status: overallStatus,
      testsPassed: totalPassed,
      testsFailed: totalFailed,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      failures: allFailures,
    };
  }

  /**
   * Execute validations in specified sequence
   * Requirements: 14.1
   */
  async runValidationSequence(categories: ValidationCategory[]): Promise<ValidationReport> {
    const startTime = Date.now();
    const categoryResults = new Map<ValidationCategory, ValidationResult>();
    const blockingIssues: Issue[] = [];

    // Execute sequentially with continue-on-failure
    for (const category of categories) {
      try {
        const result = await this.runValidation(category);
        categoryResults.set(category, result);
        
        if (result.status === 'FAIL') {
          blockingIssues.push({
            category,
            severity: 'HIGH',
            description: `${category} validation failed`,
            remediation: 'Review validation details',
            blocking: true,
          });
        }
      } catch (error) {
        // Continue on failure
        blockingIssues.push({
          category,
          severity: 'CRITICAL',
          description: `${category} validation threw error`,
          remediation: 'Review error logs',
          blocking: true,
        });
      }
    }

    // Calculate readiness score
    const totalTests = Array.from(categoryResults.values()).reduce(
      (sum, result) => sum + result.testsPassed + result.testsFailed,
      0
    );
    const passedTests = Array.from(categoryResults.values()).reduce(
      (sum, result) => sum + result.testsPassed,
      0
    );
    const readinessScore = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : 0;

    const failedCategories = Array.from(categoryResults.values()).filter(r => r.status === 'FAIL');
    const overallStatus: 'PASS' | 'FAIL' | 'PARTIAL' = 
      failedCategories.length === 0 ? 'PASS' :
      failedCategories.length === categoryResults.size ? 'FAIL' :
      'PARTIAL';

    return {
      overallStatus,
      readinessScore,
      categoryResults,
      executionTime: Date.now() - startTime,
      timestamp: new Date(),
      blockingIssues,
      recommendations: this.generateRecommendations(categoryResults, readinessScore),
    };
  }

  /**
   * Get current validation status
   */
  getValidationStatus(): { isRunning: boolean; currentCategory: ValidationCategory | null; progress: number; lastRun: Date | null } {
    return {
      isRunning: false,
      currentCategory: null,
      progress: 0,
      lastRun: null,
    };
  }

  /**
   * Export validation report as JSON
   * Requirements: 14.6
   */
  exportReportAsJSON(report: ValidationReport): string {
    return JSON.stringify({
      overallStatus: report.overallStatus,
      readinessScore: report.readinessScore,
      executionTime: report.executionTime,
      timestamp: report.timestamp.toISOString(),
      categories: Array.from(report.categoryResults.entries()).map(([category, result]) => ({
        category,
        status: result.status,
        testsPassed: result.testsPassed,
        testsFailed: result.testsFailed,
        executionTime: result.executionTime,
        failures: result.failures,
      })),
      blockingIssues: report.blockingIssues,
      recommendations: report.recommendations,
    }, null, 2);
  }

  /**
   * Generate recommendations based on validation results
   */
  private generateRecommendations(
    categoryResults: Map<ValidationCategory, ValidationResult>,
    readinessScore: number
  ): string[] {
    const recommendations: string[] = [];

    if (readinessScore < 95) {
      recommendations.push('Readiness score below 95% - address failing validations before launch');
    }

    const failedCategories = Array.from(categoryResults.entries())
      .filter(([_, result]) => result.status === 'FAIL')
      .map(([category, _]) => category);

    if (failedCategories.length > 0) {
      recommendations.push(`Failed categories: ${failedCategories.join(', ')}`);
    }

    if (readinessScore >= 95 && failedCategories.length === 0) {
      recommendations.push('All validations passing - system ready for launch');
    }

    return recommendations;
  }
}
