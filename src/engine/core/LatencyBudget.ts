import * as Sentry from '@sentry/node';
import { LatencyMode } from '../types/enums.js';
import { LatencyBudgetExceededError } from '../types/errors.js';
import type { LatencyBudgetResult } from '../types/index.js';
import { getEngineConfig } from '../config/loader.js';

/**
 * Monotonic clock-based latency tracker for the decision cycle.
 * Uses performance.now() (monotonic) instead of Date.now() (wall-clock).
 */
export class LatencyBudget {
  private readonly startNs: number;
  private mode: LatencyMode = LatencyMode.COLD;
  private stageDurations: Record<string, number> = {};
  private currentStage: string | null = null;
  private currentStageStart: number | null = null;

  constructor() {
    this.startNs = performance.now();
  }

  setMode(mode: LatencyMode): void {
    this.mode = mode;
  }

  startStage(name: string): void {
    this.endCurrentStage();
    this.currentStage = name;
    this.currentStageStart = performance.now();
  }

  endCurrentStage(): void {
    if (this.currentStage && this.currentStageStart !== null) {
      const duration = performance.now() - this.currentStageStart;
      this.stageDurations[this.currentStage] = Math.round(duration);
      this.currentStage = null;
      this.currentStageStart = null;
    }
  }

  getElapsedMs(): number {
    return Math.round(performance.now() - this.startNs);
  }

  getBudgetMs(): number {
    const config = getEngineConfig();
    return this.mode === LatencyMode.CACHED
      ? config.latency.maxTotalDecisionCycleMs_cached
      : config.latency.maxTotalDecisionCycleMs_cold;
  }

  /**
   * Check if the budget has been exceeded. If so, throw LatencyBudgetExceededError.
   */
  check(): void {
    this.endCurrentStage();
    const elapsed = this.getElapsedMs();
    const budget = this.getBudgetMs();

    if (elapsed > budget) {
      Sentry.addBreadcrumb({
        category: 'engine',
        message: `Latency budget exceeded: ${elapsed}ms > ${budget}ms`,
        level: 'warning',
        data: { elapsed, budget, mode: this.mode, stageDurations: this.stageDurations },
      });
      throw new LatencyBudgetExceededError(elapsed, budget, this.mode);
    }
  }

  /**
   * Check a per-stage budget (e.g., construction must be < 400ms).
   */
  checkStageBudget(stageName: string, maxMs: number): void {
    const duration = this.stageDurations[stageName];
    if (duration !== undefined && duration > maxMs) {
      Sentry.addBreadcrumb({
        category: 'engine',
        message: `Stage budget exceeded: ${stageName} took ${duration}ms > ${maxMs}ms`,
        level: 'warning',
        data: { stageName, duration, maxMs, mode: this.mode },
      });
      throw new LatencyBudgetExceededError(duration, maxMs, `${this.mode}:${stageName}`);
    }
  }

  /**
   * Build the result object for DecisionTrace.
   */
  toResult(): LatencyBudgetResult {
    this.endCurrentStage();
    const elapsed = this.getElapsedMs();
    const budget = this.getBudgetMs();

    return {
      latencyMode: this.mode,
      stageDurations: { ...this.stageDurations },
      totalElapsedMs: elapsed,
      budgetMs: budget,
      passed: elapsed <= budget,
    };
  }
}
