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
  private readonly now: () => number;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  canRequest(): boolean {
    if (this.state === 'open') {
      if (this.now() - this.lastFailure >= this.options.resetTimeoutMs) {
        this.state = 'half-open';
        return true;
      }
      return false;
    }
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures += 1;
    this.lastFailure = this.now();
    if (this.failures >= this.options.maxFailures) {
      this.state = 'open';
    }
  }

  getStatus(): { state: CircuitBreakerState; failures: number; lastFailure: number } {
    return {
      state: this.state,
      failures: this.failures,
      lastFailure: this.lastFailure,
    };
  }
}
