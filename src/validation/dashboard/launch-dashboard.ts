/**
 * Launch Readiness Dashboard for GTM Validation
 * 
 * Provides visualization and reporting of validation status:
 * - Displays pass/fail status for each validation category
 * - Shows failure details with remediation steps
 * - Calculates weighted readiness score
 * - Displays blocking issues and warnings
 * - Shows historical trends
 */

import {
  ValidationReport,
  ValidationCategory,
  ValidationResult,
  Issue,
} from '../types/index.js';

/**
 * Dashboard display output
 */
export interface DashboardDisplay {
  categoryStatuses: CategoryStatus[];
  failureDetails: FailureDetail[];
  readinessScore: number;
  blockingIssues: Issue[];
  launchReadiness: LaunchReadinessStatus;
  historicalTrends?: HistoricalTrend[];
}

/**
 * Category status for display
 */
export interface CategoryStatus {
  category: ValidationCategory;
  status: 'PASS' | 'FAIL' | 'PARTIAL';
  testsPassed: number;
  testsFailed: number;
  executionTime: number;
}

/**
 * Failure detail with remediation
 */
export interface FailureDetail {
  category: ValidationCategory;
  failureReason: string;
  remediationSteps: string[];
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

/**
 * Launch readiness status
 */
export interface LaunchReadinessStatus {
  isReady: boolean;
  status: 'GREEN' | 'YELLOW' | 'RED';
  message: string;
  estimatedReadiness?: Date;
}

/**
 * Historical trend data
 */
export interface HistoricalTrend {
  timestamp: Date;
  readinessScore: number;
  passRate: number;
  failedCategories: ValidationCategory[];
}

/**
 * Launch Dashboard
 */
export class LaunchDashboard {
  private historicalData: HistoricalTrend[] = [];

  /**
   * Display validation status for all categories
   * Requirements: 13.1
   */
  displayValidationStatus(report: ValidationReport): CategoryStatus[] {
    const statuses: CategoryStatus[] = [];

    report.categoryResults.forEach((result, category) => {
      statuses.push({
        category,
        status: result.status,
        testsPassed: result.testsPassed,
        testsFailed: result.testsFailed,
        executionTime: result.executionTime,
      });
    });

    return statuses;
  }

  /**
   * Display failure details with remediation steps
   * Requirements: 13.2
   */
  displayFailureDetails(report: ValidationReport): FailureDetail[] {
    const details: FailureDetail[] = [];

    report.categoryResults.forEach((result, category) => {
      if (result.status === 'FAIL' && result.failures.length > 0) {
        const failureReason = result.failures.map(f => f.errorMessage).join('; ');
        const remediationSteps = this.generateRemediationSteps(category, result);

        details.push({
          category,
          failureReason,
          remediationSteps,
          severity: this.determineSeverity(category),
        });
      }
    });

    return details;
  }

  /**
   * Calculate weighted readiness score
   * Requirements: 13.3
   */
  displayReadinessScore(report: ValidationReport): number {
    const weights = this.getCategoryWeights();
    let weightedScore = 0;
    let totalWeight = 0;

    report.categoryResults.forEach((result, category) => {
      const weight = weights.get(category) || 1;
      const categoryScore = result.testsPassed / (result.testsPassed + result.testsFailed);
      weightedScore += categoryScore * weight;
      totalWeight += weight;
    });

    return totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;
  }

  /**
   * Display blocking issues when readiness is below threshold
   * Requirements: 13.4
   */
  displayBlockingIssues(report: ValidationReport): Issue[] {
    const readinessScore = this.displayReadinessScore(report);
    
    if (readinessScore >= 95) {
      return [];
    }

    return report.blockingIssues.filter(issue => issue.blocking);
  }

  /**
   * Display launch readiness status
   * Requirements: 13.5
   */
  displayLaunchReadiness(report: ValidationReport): LaunchReadinessStatus {
    const readinessScore = this.displayReadinessScore(report);
    const blockingIssues = this.displayBlockingIssues(report);
    const criticalFailures = Array.from(report.categoryResults.values())
      .filter(r => r.status === 'FAIL' && this.isCriticalCategory(r.category));

    if (readinessScore >= 95 && blockingIssues.length === 0 && criticalFailures.length === 0) {
      return {
        isReady: true,
        status: 'GREEN',
        message: 'All critical validations passing - system ready for launch',
        estimatedReadiness: new Date(),
      };
    } else if (readinessScore >= 80 && criticalFailures.length === 0) {
      return {
        isReady: false,
        status: 'YELLOW',
        message: `Readiness score ${readinessScore}% - address ${blockingIssues.length} blocking issues before launch`,
      };
    } else {
      return {
        isReady: false,
        status: 'RED',
        message: `Readiness score ${readinessScore}% - critical failures detected, not ready for launch`,
      };
    }
  }

  /**
   * Display historical trends
   * Requirements: 13.6
   */
  displayHistoricalTrends(): HistoricalTrend[] {
    return [...this.historicalData].sort((a, b) => 
      b.timestamp.getTime() - a.timestamp.getTime()
    );
  }

  /**
   * Record validation result for historical tracking
   */
  recordValidationResult(report: ValidationReport): void {
    const readinessScore = this.displayReadinessScore(report);
    const totalTests = Array.from(report.categoryResults.values()).reduce(
      (sum, r) => sum + r.testsPassed + r.testsFailed,
      0
    );
    const passedTests = Array.from(report.categoryResults.values()).reduce(
      (sum, r) => sum + r.testsPassed,
      0
    );
    const passRate = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;
    const failedCategories = Array.from(report.categoryResults.entries())
      .filter(([_, r]) => r.status === 'FAIL')
      .map(([cat, _]) => cat);

    this.historicalData.push({
      timestamp: report.timestamp,
      readinessScore,
      passRate,
      failedCategories,
    });

    // Keep only last 100 entries
    if (this.historicalData.length > 100) {
      this.historicalData = this.historicalData.slice(-100);
    }
  }

  /**
   * Generate complete dashboard display
   */
  generateDashboard(report: ValidationReport): DashboardDisplay {
    this.recordValidationResult(report);

    return {
      categoryStatuses: this.displayValidationStatus(report),
      failureDetails: this.displayFailureDetails(report),
      readinessScore: this.displayReadinessScore(report),
      blockingIssues: this.displayBlockingIssues(report),
      launchReadiness: this.displayLaunchReadiness(report),
      historicalTrends: this.displayHistoricalTrends(),
    };
  }

  /**
   * Get category weights for readiness score calculation
   */
  private getCategoryWeights(): Map<ValidationCategory, number> {
    return new Map([
      [ValidationCategory.WEBHOOK_INFRASTRUCTURE, 2.0],
      [ValidationCategory.SIGNAL_PROCESSING, 2.0],
      [ValidationCategory.ENGINE_A, 1.5],
      [ValidationCategory.ENGINE_B, 1.5],
      [ValidationCategory.STRIKE_SELECTION, 1.5],
      [ValidationCategory.STRATEGY_ROUTING, 1.5],
      [ValidationCategory.SIGNAL_DELIVERY, 2.0],
      [ValidationCategory.PERFORMANCE_TRACKING, 1.0],
      [ValidationCategory.ACCESS_CONTROL, 2.0],
      [ValidationCategory.MONITORING, 1.5],
      [ValidationCategory.END_TO_END, 2.5],
      [ValidationCategory.KILL_SWITCHES, 2.0],
    ]);
  }

  /**
   * Determine if category is critical for launch
   */
  private isCriticalCategory(category: ValidationCategory): boolean {
    const criticalCategories = [
      ValidationCategory.WEBHOOK_INFRASTRUCTURE,
      ValidationCategory.SIGNAL_PROCESSING,
      ValidationCategory.SIGNAL_DELIVERY,
      ValidationCategory.ACCESS_CONTROL,
      ValidationCategory.END_TO_END,
      ValidationCategory.KILL_SWITCHES,
    ];
    return criticalCategories.includes(category);
  }

  /**
   * Determine severity based on category
   */
  private determineSeverity(category: ValidationCategory): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
    if (this.isCriticalCategory(category)) {
      return 'CRITICAL';
    }
    
    const highPriorityCategories = [
      ValidationCategory.ENGINE_A,
      ValidationCategory.ENGINE_B,
      ValidationCategory.STRIKE_SELECTION,
      ValidationCategory.STRATEGY_ROUTING,
      ValidationCategory.MONITORING,
    ];
    
    if (highPriorityCategories.includes(category)) {
      return 'HIGH';
    }
    
    return 'MEDIUM';
  }

  /**
   * Generate remediation steps for failed category
   */
  private generateRemediationSteps(category: ValidationCategory, _result: ValidationResult): string[] {
    const steps: string[] = [];

    switch (category) {
      case ValidationCategory.WEBHOOK_INFRASTRUCTURE:
        steps.push('Verify webhook URL is configured and accessible');
        steps.push('Check webhook authentication credentials');
        steps.push('Review webhook processing logs for errors');
        break;
      case ValidationCategory.SIGNAL_PROCESSING:
        steps.push('Verify signal normalization logic');
        steps.push('Check market data enrichment sources');
        steps.push('Review field extraction mappings');
        break;
      case ValidationCategory.ENGINE_A:
        steps.push('Review tier evaluation rules');
        steps.push('Verify hard block conditions');
        steps.push('Check delay queue configuration');
        break;
      case ValidationCategory.ENGINE_B:
        steps.push('Verify agent orchestration logic');
        steps.push('Check agent context data');
        steps.push('Review weighted voting calculation');
        break;
      case ValidationCategory.STRIKE_SELECTION:
        steps.push('Verify strike filtering criteria');
        steps.push('Check Greeks calculation accuracy');
        steps.push('Review liquidity thresholds');
        break;
      case ValidationCategory.STRATEGY_ROUTING:
        steps.push('Verify feature flag configuration');
        steps.push('Check routing assignment logic');
        steps.push('Review shadow execution setup');
        break;
      case ValidationCategory.SIGNAL_DELIVERY:
        steps.push('Verify delivery queue configuration');
        steps.push('Check notification channels');
        steps.push('Review retry logic and backoff');
        break;
      case ValidationCategory.PERFORMANCE_TRACKING:
        steps.push('Verify trade record creation');
        steps.push('Check P&L calculation logic');
        steps.push('Review metrics aggregation');
        break;
      case ValidationCategory.ACCESS_CONTROL:
        steps.push('Verify authentication system');
        steps.push('Check subscription tier enforcement');
        steps.push('Review usage limit tracking');
        break;
      case ValidationCategory.MONITORING:
        steps.push('Verify health check endpoints');
        steps.push('Check latency tracking');
        steps.push('Review error capture and alerting');
        break;
      case ValidationCategory.END_TO_END:
        steps.push('Review complete pipeline flow');
        steps.push('Check integration points');
        steps.push('Verify error handling and retries');
        break;
      case ValidationCategory.KILL_SWITCHES:
        steps.push('Verify kill switch activation logic');
        steps.push('Check emergency stop procedures');
        steps.push('Review circuit breaker thresholds');
        break;
      default:
        steps.push('Review validation logs for details');
        steps.push('Contact platform team for assistance');
    }

    return steps;
  }
}
