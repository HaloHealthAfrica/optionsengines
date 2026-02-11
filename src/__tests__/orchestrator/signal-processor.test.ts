/**
 * Unit Tests: Signal Processor Edge Cases
 * Tests specific scenarios and error conditions
 */

import pg from 'pg';
import { config } from '../../config/index.js';
import { SignalProcessor } from '../../orchestrator/signal-processor.js';

const { Pool } = pg;

describe('SignalProcessor - Edge Cases', () => {
  jest.setTimeout(20000);
  let pool: pg.Pool;
  let processor: SignalProcessor;

  beforeAll(() => {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
    });
    processor = new SignalProcessor(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`UPDATE signals SET processing_lock = TRUE WHERE processed = FALSE`);
  });

  describe('getUnprocessedSignals', () => {
    test('should return empty array when no unprocessed signals exist', async () => {
      const result = await pool.query(
        `INSERT INTO signals (symbol, direction, timeframe, timestamp, status, raw_payload, signal_hash, processed, processing_lock)
         VALUES ('SPY', 'long', '5m', NOW(), 'pending', '{}', $1, TRUE, FALSE)
         RETURNING signal_id`,
        ['a'.repeat(64)]
      );

      const signalId = result.rows[0].signal_id;
      try {
        await lockOtherSignals(pool, []);
        const signals = await processor.getUnprocessedSignals(10, [
          '00000000-0000-0000-0000-000000000000',
        ]);
        expect(signals).toEqual([]);
      } finally {
        await pool.query(`DELETE FROM signals WHERE signal_id = $1`, [signalId]);
      }
    });

    test('should respect limit parameter', async () => {
      const signalIds: string[] = [];
      try {
        for (let i = 0; i < 5; i++) {
          const result = await pool.query(
            `INSERT INTO signals (symbol, direction, timeframe, timestamp, status, raw_payload, signal_hash, processed, processing_lock)
             VALUES ('SPY', 'long', '5m', NOW(), 'pending', '{}', $1, FALSE, FALSE)
             RETURNING signal_id`,
            [`${i}`.repeat(64)]
          );
          signalIds.push(result.rows[0].signal_id);
        }

        await lockOtherSignals(pool, signalIds);
        await pool.query(
          `UPDATE signals SET processing_lock = FALSE WHERE signal_id = ANY($1::uuid[])`,
          [signalIds]
        );
        const signals = await processor.getUnprocessedSignals(3, signalIds);
        expect(signals.length).toBe(3);
      } finally {
        if (signalIds.length > 0) {
          await pool.query(`DELETE FROM signals WHERE signal_id = ANY($1::uuid[])`, [signalIds]);
        }
      }
    });

    test('should return signals ordered by timestamp ASC', async () => {
      const signalIds: string[] = [];
      try {
        const timestamps = [
          new Date('2024-01-03'),
          new Date('2024-01-01'),
          new Date('2024-01-02'),
        ];

        for (let i = 0; i < timestamps.length; i++) {
          const result = await pool.query(
            `INSERT INTO signals (symbol, direction, timeframe, timestamp, status, raw_payload, signal_hash, processed, processing_lock)
             VALUES ('SPY', 'long', '5m', $1, 'pending', '{}', $2, FALSE, FALSE)
             RETURNING signal_id`,
            [timestamps[i], `${i}`.repeat(64)]
          );
          signalIds.push(result.rows[0].signal_id);
        }

        await lockOtherSignals(pool, signalIds);
        await pool.query(
          `UPDATE signals SET processing_lock = FALSE WHERE signal_id = ANY($1::uuid[])`,
          [signalIds]
        );
        const signals = await processor.getUnprocessedSignals(10, signalIds);
        expect(signals.length).toBe(3);
        expect(signals[0].timestamp.getTime()).toBeLessThan(signals[1].timestamp.getTime());
        expect(signals[1].timestamp.getTime()).toBeLessThan(signals[2].timestamp.getTime());
      } finally {
        if (signalIds.length > 0) {
          await pool.query(`DELETE FROM signals WHERE signal_id = ANY($1::uuid[])`, [signalIds]);
        }
      }
    });
  });

  describe('createMarketContext', () => {
    test('should create context with valid hash', async () => {
      const insertResult = await pool.query(
        `INSERT INTO signals (symbol, direction, timeframe, timestamp, status, raw_payload, signal_hash, processed, processing_lock)
         VALUES ('SPY', 'long', '5m', NOW(), 'pending', '{}', $1, FALSE, FALSE)
         RETURNING signal_id, timestamp`,
        ['a'.repeat(64)]
      );

      const signal = {
        signal_id: insertResult.rows[0].signal_id,
        symbol: 'SPY',
        direction: 'long' as const,
        timeframe: '5m',
        timestamp: insertResult.rows[0].timestamp,
        signal_hash: 'a'.repeat(64),
        raw_payload: {},
        processed: false,
      };

      const context = await processor.createMarketContext(signal);

      expect(context.signal_id).toBe(signal.signal_id);
      expect(context.symbol).toBe(signal.symbol);
      expect(context.context_hash).toHaveLength(64);
      expect(context.context_id).toBeDefined();

      await pool.query(`DELETE FROM market_contexts WHERE signal_id = $1`, [signal.signal_id]);
      await pool.query(`DELETE FROM signals WHERE signal_id = $1`, [signal.signal_id]);
    });

    test('should handle missing signal gracefully', async () => {
      const signal = {
        signal_id: '00000000-0000-0000-0000-000000000000',
        symbol: 'SPY',
        direction: 'long' as const,
        timeframe: '5m',
        timestamp: new Date(),
        signal_hash: 'a'.repeat(64),
        raw_payload: {},
        processed: false,
      };

      await expect(processor.createMarketContext(signal)).rejects.toThrow();
    });
  });

  describe('markProcessed', () => {
    test('should update signal processed flag and experiment_id', async () => {
      const insertResult = await pool.query(
        `INSERT INTO signals (symbol, direction, timeframe, timestamp, status, raw_payload, signal_hash, processed, processing_lock)
         VALUES ('SPY', 'long', '5m', NOW(), 'pending', '{}', $1, FALSE, TRUE)
         RETURNING signal_id`,
        ['a'.repeat(64)]
      );

      const signalId = insertResult.rows[0].signal_id;
      const experimentId = '11111111-1111-1111-1111-111111111111';

      await processor.markProcessed(signalId, experimentId);

      const result = await pool.query(
        `SELECT processed, experiment_id, processing_lock FROM signals WHERE signal_id = $1`,
        [signalId]
      );

      expect(result.rows[0].processed).toBe(true);
      expect(result.rows[0].experiment_id).toBe(experimentId);
      expect(result.rows[0].processing_lock).toBe(false);

      await pool.query(`DELETE FROM signals WHERE signal_id = $1`, [signalId]);
    });

    test('should handle non-existent signal gracefully', async () => {
      const signalId = '00000000-0000-0000-0000-000000000000';
      const experimentId = '11111111-1111-1111-1111-111111111111';

      // Should not throw
      await expect(processor.markProcessed(signalId, experimentId)).resolves.not.toThrow();
    });
  });

  describe('getMarketContext', () => {
    test('should return null for non-existent signal', async () => {
      const signalId = '00000000-0000-0000-0000-000000000000';
      
      const context = await processor.getMarketContext(signalId);
      
      expect(context).toBeNull();
    });

    test('should retrieve existing market context', async () => {
      const insertResult = await pool.query(
        `INSERT INTO signals (symbol, direction, timeframe, timestamp, status, raw_payload, signal_hash, processed, processing_lock)
         VALUES ('SPY', 'long', '5m', NOW(), 'pending', '{}', $1, FALSE, FALSE)
         RETURNING signal_id, timestamp`,
        ['a'.repeat(64)]
      );

      const signal = {
        signal_id: insertResult.rows[0].signal_id,
        symbol: 'SPY',
        direction: 'long' as const,
        timeframe: '5m',
        timestamp: insertResult.rows[0].timestamp,
        signal_hash: 'a'.repeat(64),
        raw_payload: {},
        processed: false,
      };

      const createdContext = await processor.createMarketContext(signal);
      const retrievedContext = await processor.getMarketContext(signal.signal_id);

      expect(retrievedContext).not.toBeNull();
      expect(retrievedContext?.signal_id).toBe(signal.signal_id);
      expect(retrievedContext?.context_hash).toBe(createdContext.context_hash);

      await pool.query(`DELETE FROM market_contexts WHERE signal_id = $1`, [signal.signal_id]);
      await pool.query(`DELETE FROM signals WHERE signal_id = $1`, [signal.signal_id]);
    });
  });
});

async function lockOtherSignals(pool: pg.Pool, signalIds: string[]) {
  if (signalIds.length === 0) {
    await pool.query(`UPDATE signals SET processing_lock = TRUE WHERE processed = FALSE`);
    return;
  }

  await pool.query(
    `UPDATE signals
     SET processing_lock = TRUE
     WHERE processed = FALSE AND signal_id != ALL($1::uuid[])`,
    [signalIds]
  );
}
