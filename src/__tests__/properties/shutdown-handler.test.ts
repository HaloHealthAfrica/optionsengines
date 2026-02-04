/**
 * Property-Based Tests: Shutdown handling and resource cleanup
 * Property 47: Shutdown signal handling
 * Property 48: Resource cleanup on shutdown
 * Validates: Requirements 25.1, 25.2, 25.3, 25.5
 */

import fc from 'fast-check';
import { createShutdownHandler } from '../../utils/shutdown.js';

describe('Shutdown handler properties', () => {
  test('handles shutdown signals and exits cleanly', async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 3, maxLength: 10 }), async (signal) => {
        const serverClose = jest.fn((cb?: () => void) => cb?.());
        const stopWorkers = jest.fn(async () => undefined);
        const featureFlags = { stop: jest.fn() };
        const db = { close: jest.fn(async () => undefined) };
        const cache = { close: jest.fn() };
        const exit = jest.fn();

        const handler = createShutdownHandler({
          server: { close: serverClose },
          stopWorkers,
          featureFlags,
          db,
          cache,
          exit,
          timeoutMs: 10,
        });

        await handler(signal);

        expect(serverClose).toHaveBeenCalled();
        expect(stopWorkers).toHaveBeenCalled();
        expect(exit).toHaveBeenCalledWith(0);
      }),
      { numRuns: 20 }
    );
  });

  test('cleans up resources on shutdown', async () => {
    await fc.assert(
      fc.asyncProperty(fc.constant('SIGTERM'), async (signal) => {
        const serverClose = jest.fn((cb?: () => void) => cb?.());
        const stopWorkers = jest.fn(async () => undefined);
        const featureFlags = { stop: jest.fn() };
        const db = { close: jest.fn(async () => undefined) };
        const cache = { close: jest.fn() };
        const exit = jest.fn();

        const handler = createShutdownHandler({
          server: { close: serverClose },
          stopWorkers,
          featureFlags,
          db,
          cache,
          exit,
          timeoutMs: 10,
        });

        await handler(signal);

        expect(featureFlags.stop).toHaveBeenCalled();
        expect(db.close).toHaveBeenCalled();
        expect(cache.close).toHaveBeenCalled();
      }),
      { numRuns: 10 }
    );
  });
});
