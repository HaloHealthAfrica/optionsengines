/**
 * Property-Based Test: Webhook logging completeness
 * Property 5: Webhook requests are logged with payload and validation outcome
 * Validates: Requirements 1.6
 */

import fc from 'fast-check';

jest.mock('../../services/database.service.js', () => ({
  db: {
    query: jest.fn(),
  },
}));

import { handleWebhook } from '../../routes/webhook.js';
import { db } from '../../services/database.service.js';
import { authService } from '../../services/auth.service.js';
import { logger } from '../../utils/logger.js';

function createMockResponse() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

function createMockRequest(body: Record<string, any>) {
  const rawBody = JSON.stringify(body);
  const signature = authService.generateHmacSignature(rawBody);

  return {
    body,
    headers: {
      'x-webhook-signature': signature,
    },
    ip: '127.0.0.1',
    rawBody: Buffer.from(rawBody, 'utf8'),
  } as any;
}

describe('Property 5: Webhook logging completeness', () => {
  const symbolArb = fc.constantFrom('SPY', 'QQQ', 'AAPL');
  const timeframeArb = fc.constantFrom('1m', '5m', '15m');

  const payloadArb = fc.record({
    symbol: symbolArb,
    action: fc.constantFrom('BUY', 'SELL'),
    direction: fc.constantFrom('CALL', 'PUT'),
    timeframe: timeframeArb,
    timestamp: fc.date().map((d) => d.toISOString()),
  });

  test('Property: Requests are logged with payload and validation result', async () => {
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => {});

    await fc.assert(
      fc.asyncProperty(payloadArb, async (payload) => {
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [] });
        (db.query as jest.Mock).mockResolvedValueOnce({ rows: [{ signal_id: 'test-signal' }] });

        const req = createMockRequest(payload);
        const res = createMockResponse();
        await handleWebhook(req as any, res as any);

        expect(infoSpy).toHaveBeenCalledWith(
          'Webhook received',
          expect.objectContaining({
            ip: '127.0.0.1',
            body: payload,
            requestId: expect.any(String),
          })
        );

        expect(infoSpy).toHaveBeenCalledWith(
          'Signal stored successfully',
          expect.objectContaining({
            signalId: 'test-signal',
            ticker: payload.symbol,
          })
        );

        infoSpy.mockClear();
        (db.query as jest.Mock).mockClear();
      }),
      { numRuns: 20 }
    );

    infoSpy.mockRestore();
  });
});
