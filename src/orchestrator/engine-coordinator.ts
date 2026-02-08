/**
 * Engine Coordinator - invokes Engine A and Engine B with identical inputs
 */

import { MarketContext, Signal, TradeRecommendation } from './types.js';
import { logger } from '../utils/logger.js';

export type EngineInvoker = (
  signal: Signal,
  context: MarketContext
) => Promise<TradeRecommendation | null>;

export class EngineCoordinator {
  private invokeA: EngineInvoker;
  private invokeB: EngineInvoker;

  constructor(engineAInvoker: EngineInvoker, engineBInvoker: EngineInvoker) {
    this.invokeA = engineAInvoker;
    this.invokeB = engineBInvoker;
  }

  async invokeEngineA(signal: Signal, context: MarketContext): Promise<TradeRecommendation | null> {
    return this.invokeA(signal, context);
  }

  async invokeEngineB(signal: Signal, context: MarketContext): Promise<TradeRecommendation | null> {
    return this.invokeB(signal, context);
  }

  /**
   * Invoke both engines using identical inputs
   */
  async invokeBoth(
    signal: Signal,
    context: MarketContext
  ): Promise<{ engineA: TradeRecommendation | null; engineB: TradeRecommendation | null }> {
    const [engineA, engineB] = await Promise.all([
      this.invokeEngineA(signal, context),
      this.invokeEngineB(signal, context),
    ]);

    return { engineA, engineB };
  }

  /**
   * Synchronize exits for shadow trades based on a real trade exit event
   */
  async synchronizeExits(
    experiment_id: string,
    exit_time: Date,
    exit_price: number,
    reason: string
  ): Promise<void> {
    logger.info('Synchronizing shadow exits', {
      experiment_id,
      exit_time: exit_time.toISOString(),
      exit_price,
      reason,
    });
  }
}
