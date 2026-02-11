/**
 * Property-Based Tests: Orchestrator Logger Completeness
 * Properties 27-31
 */

import fc from 'fast-check';

jest.mock('../../utils/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

import { orchestratorLogger } from '../../orchestrator/orchestrator-logger.js';
import { logger } from '../../utils/logger.js';

describe('OrchestratorLogger - Structured logging completeness', () => {
  const uuidArb = fc.uuid();
  const symbolArb = fc.constantFrom('SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT');
  const directionArb = fc.constantFrom('long', 'short');
  const hashArb = fc.hexaString({ minLength: 64, maxLength: 64 });

  afterEach(() => {
    (logger.info as jest.Mock).mockClear();
    (logger.error as jest.Mock).mockClear();
  });

  test('Property 27: Structured Logging for Signal Retrieval', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, symbolArb, directionArb, fc.date(), async (signal_id, symbol, direction, timestamp) => {
        orchestratorLogger.logSignalRetrieval({ signal_id, symbol, direction, timestamp });
        expect(logger.info).toHaveBeenCalled();
        const meta = (logger.info as jest.Mock).mock.calls.at(-1)?.[1];
        expect(meta).toEqual(
          expect.objectContaining({ signal_id, symbol, direction, timestamp: timestamp.toISOString() })
        );
      }),
      { numRuns: 50 }
    );
  });

  test('Property 28: Structured Logging for Experiment Creation', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, uuidArb, hashArb, async (experiment_id, signal_id, assignment_hash) => {
        orchestratorLogger.logExperimentCreation({
          experiment_id,
          signal_id,
          variant: 'A',
          assignment_hash,
        });
        const meta = (logger.info as jest.Mock).mock.calls.at(-1)?.[1];
        expect(meta).toEqual(
          expect.objectContaining({ experiment_id, signal_id, variant: 'A', assignment_hash })
        );
      }),
      { numRuns: 50 }
    );
  });

  test('Property 29: Structured Logging for Policy Application', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, async (experiment_id) => {
        orchestratorLogger.logPolicyApplication({
          experiment_id,
          execution_mode: 'ENGINE_A_PRIMARY',
          executed_engine: 'A',
          policy_version: 'v1.0',
        });
        const meta = (logger.info as jest.Mock).mock.calls.at(-1)?.[1];
        expect(meta).toEqual(
          expect.objectContaining({
            experiment_id,
            execution_mode: 'ENGINE_A_PRIMARY',
            executed_engine: 'A',
            policy_version: 'v1.0',
          })
        );
      }),
      { numRuns: 50 }
    );
  });

  test('Property 30: Structured Logging for Shadow Trade Creation', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, uuidArb, async (experiment_id, shadow_trade_id) => {
        orchestratorLogger.logShadowTradeCreation({
          experiment_id,
          engine: 'B',
          shadow_trade_id,
        });
        const meta = (logger.info as jest.Mock).mock.calls.at(-1)?.[1];
        expect(meta).toEqual(
          expect.objectContaining({ experiment_id, engine: 'B', shadow_trade_id })
        );
      }),
      { numRuns: 50 }
    );
  });

  test('Property 31: Error Logging with Context', async () => {
    await fc.assert(
      fc.asyncProperty(uuidArb, uuidArb, fc.string(), fc.string(), async (signal_id, experiment_id, error_type, error_message) => {
        orchestratorLogger.logError({
          signal_id,
          experiment_id,
          error_type,
          error_message,
          stack_trace: 'stack',
        });
        const meta = (logger.error as jest.Mock).mock.calls.at(-1)?.[2];
        expect(meta).toEqual(
          expect.objectContaining({
            signal_id,
            experiment_id,
            error_type,
            error_message,
            stack_trace: 'stack',
          })
        );
      }),
      { numRuns: 50 }
    );
  });
});
