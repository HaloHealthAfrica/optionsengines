/**
 * Property-Based Tests: Webhook Payload Validation and Storage
 * Properties 22-23
 */

import fc from 'fast-check';
import pg from 'pg';
import { config } from '../../config/index.js';
import { handleWebhook } from '../../routes/webhook.js';

const { Pool } = pg;

describe('Webhook Handler - Property Tests', () => {
  jest.setTimeout(30000);
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

  const validPayloadArb = fc.record({
    symbol: fc.constantFrom('SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT'),
    direction: fc.constantFrom('long', 'short', 'LONG', 'SHORT', 'CALL', 'PUT', 'BUY', 'SELL'),
    timeframe: fc.constantFrom('1m', '5m', '15m', '1h', '1d'),
    timestamp: fc.oneof(
      fc.date({ min: new Date('2000-01-01'), max: new Date('2100-01-01') }).map((d) =>
        d.toISOString()
      ),
      fc.integer({ min: 1_700_000_000, max: 1_900_000_000 })
    ),
  });

  const invalidPayloadArb = fc.record({
    timeframe: fc.constantFrom('1m', '5m'),
    timestamp: fc.oneof(fc.string(), fc.integer({ min: 1, max: 10 })),
  });

  test('Property 22: Webhook payload validation rejects invalid payloads', async () => {
    await fc.assert(
      fc.asyncProperty(invalidPayloadArb, async (payload) => {
        const res = createMockResponse();
        await handleWebhook(createMockRequest(payload), res);
        expect(res.statusCode).toBe(400);
      }),
      { numRuns: 30 }
    );
  });

  test('Property 23: Valid signal storage', async () => {
    await fc.assert(
      fc.asyncProperty(validPayloadArb, async (payload) => {
        const res = createMockResponse();
        await handleWebhook(createMockRequest(payload), res);
        expect(res.statusCode).toBe(200);
        if (res.body?.status === 'DUPLICATE') {
          return;
        }

        const signalId = res.body?.signal_id;
        expect(signalId).toBeDefined();

        const result = await pool.query(`SELECT signal_id FROM signals WHERE signal_id = $1`, [
          signalId,
        ]);
        expect(result.rows.length).toBe(1);

        await pool.query(`DELETE FROM signals WHERE signal_id = $1`, [signalId]);
      }),
      { numRuns: 20 }
    );
  });
});

function createMockRequest(body: any) {
  return {
    body,
    headers: {},
    ip: '127.0.0.1',
  } as any;
}

function createMockResponse() {
  const res: any = {};
  res.statusCode = 200;
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: any) => {
    res.body = payload;
    return res;
  };
  return res;
}
