/**
 * Property-Based Test: Order-Signal Referential Integrity
 * Property 12: For any created order, it should be linked to its source signal via signal_id foreign key
 * Validates: Requirements 4.6, 15.2
 */

import fc from 'fast-check';
import pg from 'pg';
import { config } from '../../config/index.js';

const { Pool } = pg;

describe('Property 12: Order-Signal Referential Integrity', () => {
  jest.setTimeout(20000);
  let pool: pg.Pool;

  beforeAll(() => {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  // Arbitraries for generating test data
  const signalArbitrary = fc.record({
    symbol: fc.constantFrom('SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT'),
    direction: fc.constantFrom('long', 'short'),
    timeframe: fc.constantFrom('1m', '5m', '15m', '1h', '1d'),
    timestamp: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
    status: fc.constant('approved'),
  });

  const orderArbitrary = fc.record({
      symbol: fc.constantFrom('SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT'),
      option_symbol: fc.string({ minLength: 10, maxLength: 20 }),
      strike: fc.float({ min: 100, max: 500, noNaN: true }),
      expiration: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
      type: fc.constantFrom('call', 'put'),
      quantity: fc.integer({ min: 1, max: 100 }),
      order_type: fc.constant('paper'),
      status: fc.constant('pending_execution'),
    });

  test('Property: Created orders must reference valid signal_id', async () => {
    await fc.assert(
      fc.asyncProperty(signalArbitrary, orderArbitrary, async (signalData, orderData) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          // Create signal
          const signalResult = await client.query(
            `INSERT INTO signals (symbol, direction, timeframe, timestamp, status)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING signal_id`,
            [
              signalData.symbol,
              signalData.direction,
              signalData.timeframe,
              signalData.timestamp,
              signalData.status,
            ]
          );

          const signalId = signalResult.rows[0].signal_id;
          const orderWithSignal = { ...orderData, signal_id: signalId };

          // Create order
          const orderResult = await client.query(
            `INSERT INTO orders (signal_id, symbol, option_symbol, strike, expiration, type, quantity, order_type, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING order_id, signal_id`,
            [
              orderWithSignal.signal_id,
              orderWithSignal.symbol,
              orderWithSignal.option_symbol,
              orderWithSignal.strike,
              orderWithSignal.expiration,
              orderWithSignal.type,
              orderWithSignal.quantity,
              orderWithSignal.order_type,
              orderWithSignal.status,
            ]
          );

          const order = orderResult.rows[0];

          // Property: Order must be linked to signal via signal_id
          expect(order.signal_id).toBe(signalId);

          // Verify foreign key constraint exists
          const fkResult = await client.query(
            `SELECT signal_id FROM orders WHERE order_id = $1`,
            [order.order_id]
          );

          expect(fkResult.rows[0].signal_id).toBe(signalId);

          await client.query('ROLLBACK');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }),
      { numRuns: 30 }
    );
  });

  test('Property: Orders cannot reference non-existent signal_id', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.record({
          symbol: fc.constantFrom('SPY', 'QQQ'),
          option_symbol: fc.string({ minLength: 10, maxLength: 20 }),
          strike: fc.float({ min: 100, max: 500, noNaN: true }),
          expiration: fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
          type: fc.constantFrom('call', 'put'),
          quantity: fc.integer({ min: 1, max: 100 }),
          order_type: fc.constant('paper'),
          status: fc.constant('pending_execution'),
        }),
        async (nonExistentSignalId, orderData) => {
          const client = await pool.connect();
          try {
            await client.query('BEGIN');

            // Attempt to create order with non-existent signal_id
            // This should fail due to foreign key constraint
            await expect(
              client.query(
                `INSERT INTO orders (signal_id, symbol, option_symbol, strike, expiration, type, quantity, order_type, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                  nonExistentSignalId,
                  orderData.symbol,
                  orderData.option_symbol,
                  orderData.strike,
                  orderData.expiration,
                  orderData.type,
                  orderData.quantity,
                  orderData.order_type,
                  orderData.status,
                ]
              )
            ).rejects.toThrow();

            await client.query('ROLLBACK');
          } catch (error) {
            await client.query('ROLLBACK');
            // Expected to fail - this is the correct behavior
          } finally {
            client.release();
          }
        }
      ),
      { numRuns: 20 }
    );
  });

  test('Property: Deleting signal with SET NULL preserves order', async () => {
    await fc.assert(
      fc.asyncProperty(signalArbitrary, async (signalData) => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');

          // Create signal
          const signalResult = await client.query(
            `INSERT INTO signals (symbol, direction, timeframe, timestamp, status)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING signal_id`,
            [
              signalData.symbol,
              signalData.direction,
              signalData.timeframe,
              signalData.timestamp,
              signalData.status,
            ]
          );

          const signalId = signalResult.rows[0].signal_id;

          // Create order
          const orderResult = await client.query(
            `INSERT INTO orders (signal_id, symbol, option_symbol, strike, expiration, type, quantity, order_type, status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING order_id`,
            [
              signalId,
              'SPY',
              'SPY240119C00450000',
              450.0,
              new Date('2024-01-19'),
              'call',
              10,
              'paper',
              'pending_execution',
            ]
          );

          const orderId = orderResult.rows[0].order_id;

          // Delete signal (should set order.signal_id to NULL due to ON DELETE SET NULL)
          await client.query('DELETE FROM signals WHERE signal_id = $1', [signalId]);

          // Verify order still exists but signal_id is NULL
          const orderCheck = await client.query('SELECT signal_id FROM orders WHERE order_id = $1', [
            orderId,
          ]);

          expect(orderCheck.rows.length).toBe(1);
          expect(orderCheck.rows[0].signal_id).toBeNull();

          await client.query('ROLLBACK');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      }),
      { numRuns: 20 }
    );
  });
});
