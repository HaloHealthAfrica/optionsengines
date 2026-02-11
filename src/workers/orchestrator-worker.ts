/**
 * Orchestrator Worker - polls unprocessed signals and runs orchestrator
 */

import { OrchestratorService } from '../orchestrator/orchestrator-service.js';
import { logger } from '../utils/logger.js';

export class OrchestratorWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isShuttingDown = false;
  private backoffMs = 0;

  constructor(private orchestrator: OrchestratorService, private intervalMs: number) {}

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.run().catch((error) => {
        logger.error('Orchestrator worker failed', error);
      });
    }, this.intervalMs);

    this.run().catch((error) => {
      logger.error('Orchestrator worker failed on startup', error);
    });

    logger.info('Orchestrator worker started', { intervalMs: this.intervalMs });
  }

  stop(): void {
    this.isShuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Orchestrator worker stopped');
    }
  }

  async stopAndDrain(timeoutMs: number): Promise<void> {
    this.stop();
    const startedAt = Date.now();
    while (this.isRunning && Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (this.isRunning) {
      logger.warn('Orchestrator worker did not stop before timeout');
    }
  }

  async run(): Promise<void> {
    if (this.isRunning || this.isShuttingDown) {
      return;
    }

    this.isRunning = true;
    try {
      if (this.backoffMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.backoffMs));
      }
      await this.orchestrator.processSignals(10);
      this.backoffMs = 0;
    } catch (error) {
      this.backoffMs = Math.min(this.backoffMs * 2 || 500, 10_000);
      logger.error('Orchestrator worker error', error, { backoffMs: this.backoffMs });
      throw error;
    } finally {
      this.isRunning = false;
    }
  }
}
