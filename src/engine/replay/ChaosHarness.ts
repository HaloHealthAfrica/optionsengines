import { logger } from '../../utils/logger.js';

export type ChaosScenario =
  | 'MISSING_GREEKS'
  | 'STALE_SNAPSHOT'
  | 'LOCK_TIMEOUT'
  | 'BROKER_MISMATCH'
  | 'DOUBLE_RESERVATION'
  | 'LATENCY_SPIKE'
  | 'DB_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'CORRUPT_QUOTE'
  | 'IV_SPIKE'
  | 'ZERO_LIQUIDITY';

export interface ChaosConfig {
  enabled: boolean;
  activeScenarios: Set<ChaosScenario>;
  failureProbability: number;
  latencySpikeMs: number;
}

export interface ChaosInjectionResult {
  scenario: ChaosScenario;
  triggered: boolean;
  details: string;
}

/**
 * Chaos Harness for testing fail-closed behavior under adverse conditions.
 * Integrates with services to inject controlled failures during testing.
 * MUST NEVER be enabled in production.
 */
export class ChaosHarness {
  private config: ChaosConfig;

  constructor(config?: Partial<ChaosConfig>) {
    this.config = {
      enabled: config?.enabled ?? false,
      activeScenarios: config?.activeScenarios ?? new Set(),
      failureProbability: config?.failureProbability ?? 0.5,
      latencySpikeMs: config?.latencySpikeMs ?? 3000,
    };
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  enable(scenarios?: ChaosScenario[]): void {
    this.config.enabled = true;
    if (scenarios) {
      this.config.activeScenarios = new Set(scenarios);
    }
    logger.warn('ChaosHarness ENABLED', { scenarios: Array.from(this.config.activeScenarios) });
  }

  disable(): void {
    this.config.enabled = false;
    this.config.activeScenarios.clear();
    logger.info('ChaosHarness DISABLED');
  }

  setFailureProbability(probability: number): void {
    this.config.failureProbability = Math.max(0, Math.min(1, probability));
  }

  /**
   * Check if a chaos scenario should trigger. Returns injection result.
   * Called by services at key points to allow controlled failure injection.
   */
  shouldInject(scenario: ChaosScenario): ChaosInjectionResult {
    if (!this.config.enabled || !this.config.activeScenarios.has(scenario)) {
      return { scenario, triggered: false, details: 'Chaos not active for scenario' };
    }

    const triggered = Math.random() < this.config.failureProbability;
    const details = triggered
      ? `Chaos injection: ${scenario}`
      : `Chaos skip (probability miss): ${scenario}`;

    if (triggered) {
      logger.warn('Chaos scenario triggered', { scenario });
    }

    return { scenario, triggered, details };
  }

  /**
   * Force-trigger a specific scenario (always fires, ignores probability).
   */
  forceInject(scenario: ChaosScenario): ChaosInjectionResult {
    if (!this.config.enabled) {
      return { scenario, triggered: false, details: 'Chaos not enabled' };
    }

    logger.warn('Chaos scenario force-triggered', { scenario });
    return { scenario, triggered: true, details: `Forced chaos injection: ${scenario}` };
  }

  // ─── Scenario-specific generators ───

  /**
   * Generate a corrupt/missing-greeks option quote for testing.
   */
  generateMissingGreeksQuote(): Record<string, unknown> {
    return {
      delta: null,
      gamma: null,
      vega: null,
      iv: null,
      greekSource: 'MISSING',
    };
  }

  /**
   * Generate a stale snapshot (timestamp > 30s old).
   */
  generateStaleTimestamp(): Date {
    return new Date(Date.now() - 120_000); // 2 minutes old
  }

  /**
   * Generate a corrupt quote with bid > ask.
   */
  generateCorruptQuote(): { bid: number; ask: number; mid: number } {
    return { bid: 5.20, ask: 4.80, mid: 5.00 }; // bid > ask
  }

  /**
   * Generate zero-liquidity data.
   */
  generateZeroLiquidity(): { volume: number; oi: number } {
    return { volume: 0, oi: 0 };
  }

  /**
   * Simulate a latency spike by returning a delay duration.
   */
  getLatencySpikeMs(): number {
    return this.config.latencySpikeMs;
  }

  /**
   * Generate a broker mismatch scenario.
   */
  generateBrokerMismatch(actualCash: number): { brokerCash: number; mismatchPct: number } {
    const mismatchPct = 0.08; // 8% mismatch (exceeds 5% freeze threshold)
    const brokerCash = actualCash * (1 + mismatchPct);
    return { brokerCash, mismatchPct };
  }

  /**
   * Generate an IV spike scenario.
   */
  generateIVSpike(): { previousIVPercentile: number; currentIVPercentile: number } {
    return { previousIVPercentile: 0.45, currentIVPercentile: 0.92 };
  }

  /**
   * Get all currently active scenarios.
   */
  getActiveScenarios(): ChaosScenario[] {
    return Array.from(this.config.activeScenarios);
  }

  /**
   * Reset to clean state.
   */
  reset(): void {
    this.config.enabled = false;
    this.config.activeScenarios.clear();
    this.config.failureProbability = 0.5;
    this.config.latencySpikeMs = 3000;
  }
}

export const chaosHarness = new ChaosHarness();
