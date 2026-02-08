/**
 * Unit Test: Webhook response time within 3 seconds
 */

import { handleWebhook } from '../../routes/webhook.js';

describe('Webhook Handler - Response Time', () => {
  test('returns HTTP 200 within 3 seconds', async () => {
    const payload = {
      symbol: 'SPY',
      direction: 'long',
      timeframe: '5m',
      timestamp: new Date().toISOString(),
    };

    const res = createMockResponse();
    const start = Date.now();
    await handleWebhook(createMockRequest(payload), res);
    const elapsed = Date.now() - start;

    expect(res.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(3000);
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
