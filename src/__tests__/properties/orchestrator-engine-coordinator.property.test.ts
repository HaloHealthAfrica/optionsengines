/**
 * Property-Based Tests: Engine Coordinator Inputs and Sync
 * Properties 3 and 15
 */

import fc from 'fast-check';
import { EngineCoordinator } from '../../orchestrator/engine-coordinator.js';
import { MarketContext, Signal } from '../../orchestrator/types.js';

describe('EngineCoordinator - Property Tests', () => {
  const signalArb = fc.record({
    signal_id: fc.uuid(),
    symbol: fc.constantFrom('SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT'),
    direction: fc.constantFrom('long', 'short'),
    timeframe: fc.constantFrom('1m', '5m', '15m', '1h', '1d'),
    timestamp: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
    signal_hash: fc.hexaString({ minLength: 64, maxLength: 64 }),
    raw_payload: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 12 }),
      fc.oneof(
        fc.string({ maxLength: 20 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.boolean()
      )
    ),
    processed: fc.boolean(),
  });

  const contextArb = fc.record({
    signal_id: fc.uuid(),
    timestamp: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
    symbol: fc.constantFrom('SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT'),
    current_price: fc.float({ min: 1, max: 1000, noNaN: true }),
    bid: fc.float({ min: 1, max: 1000, noNaN: true }),
    ask: fc.float({ min: 1, max: 1000, noNaN: true }),
    volume: fc.integer({ min: 0, max: 1_000_000 }),
    indicators: fc.dictionary(
      fc.string({ minLength: 1, maxLength: 12 }),
      fc.float({ min: -1000, max: 1000, noNaN: true })
    ),
    context_hash: fc.hexaString({ minLength: 64, maxLength: 64 }),
  });

  test('Property 3: Identical inputs to both engines', async () => {
    await fc.assert(
      fc.asyncProperty(signalArb, contextArb, async (signalData, contextData) => {
        const signal = signalData as Signal;
        const context = contextData as MarketContext;

        const captured: Array<{ signal: Signal; context: MarketContext }> = [];

        const coordinator = new EngineCoordinator(
          async (s, c) => {
            captured.push({ signal: s, context: c });
            return null;
          },
          async (s, c) => {
            captured.push({ signal: s, context: c });
            return null;
          }
        );

        await coordinator.invokeBoth(signal, context);

        expect(captured.length).toBe(2);
        expect(captured[0].signal).toEqual(captured[1].signal);
        expect(captured[0].context).toEqual(captured[1].context);
      }),
      { numRuns: 100 }
    );
  });

  test('Property 15: Exit synchronization accepts any valid exit', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
        fc.float({ min: 1, max: 1000, noNaN: true }),
        fc.string({ minLength: 1, maxLength: 20 }),
        async (experimentId, exitTime, exitPrice, reason) => {
          const coordinator = new EngineCoordinator(async () => null, async () => null);
          await expect(
            coordinator.synchronizeExits(experimentId, exitTime, exitPrice, reason)
          ).resolves.not.toThrow();
        }
      ),
      { numRuns: 50 }
    );
  });
});
