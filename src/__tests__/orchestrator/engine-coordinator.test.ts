/**
 * Unit Tests: Engine Coordinator Errors
 */

import { EngineCoordinator } from '../../orchestrator/engine-coordinator.js';
import { MarketContext, Signal } from '../../orchestrator/types.js';

const signal: Signal = {
  signal_id: '00000000-0000-0000-0000-000000000000',
  symbol: 'SPY',
  direction: 'long',
  timeframe: '5m',
  timestamp: new Date(),
  signal_hash: 'a'.repeat(64),
  raw_payload: {},
  processed: false,
};

const context: MarketContext = {
  signal_id: signal.signal_id,
  timestamp: new Date(),
  symbol: 'SPY',
  current_price: 100,
  bid: 99,
  ask: 101,
  volume: 1000,
  indicators: {},
  context_hash: 'b'.repeat(64),
};

describe('EngineCoordinator - Invocation Errors', () => {
  test('Engine A invocation error is surfaced', async () => {
    const coordinator = new EngineCoordinator(
      async () => {
        throw new Error('Engine A down');
      },
      async () => null
    );

    await expect(coordinator.invokeEngineA(signal, context)).rejects.toThrow('Engine A down');
  });

  test('Engine B invocation error is surfaced', async () => {
    const coordinator = new EngineCoordinator(
      async () => null,
      async () => {
        throw new Error('Engine B down');
      }
    );

    await expect(coordinator.invokeEngineB(signal, context)).rejects.toThrow('Engine B down');
  });

  test('invokeBoth surfaces rejection from either engine', async () => {
    const coordinator = new EngineCoordinator(
      async () => null,
      async () => {
        throw new Error('Engine B down');
      }
    );

    await expect(coordinator.invokeBoth(signal, context)).rejects.toThrow('Engine B down');
  });
});
