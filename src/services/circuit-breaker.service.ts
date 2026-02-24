export type CircuitBreakerState = 'closed' | 'open' | 'half-open';

export type CircuitBreakerOptions = {
  maxFailures: number;
  resetTimeoutMs: number;
  now?: () => number;
};

export class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: CircuitBreakerState = 'closed';
  private overrideResetMs: number | null = null;
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  canRequest(): boolean {
    if (this.state === 'open') {
      const resetMs = this.overrideResetMs ?? this.options.resetTimeoutMs;
      if (this.now() - this.lastFailure >= resetMs) {
        this.state = 'half-open';
        this.overrideResetMs = null;
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
    this.overrideResetMs = null;
  }

  recordFailure(): void {
    this.failures += 1;
    this.lastFailure = this.now();
    if (this.failures >= this.options.maxFailures) {
      this.state = 'open';
    }
  }

  /**
   * Immediately open the circuit breaker with a custom cooldown duration.
   * Used for non-transient errors (e.g. 403 entitlement) where retrying is pointless.
   */
  forceOpen(durationMs: number): void {
    this.state = 'open';
    this.failures = this.options.maxFailures;
    this.lastFailure = this.now();
    this.overrideResetMs = durationMs;
  }

  getStatus(): { state: CircuitBreakerState; failures: number; lastFailure: number } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailure: this.lastFailure,
    };
  }
}
