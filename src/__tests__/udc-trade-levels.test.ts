/**
 * Unit tests for UDC trade-levels route and trade-level logic.
 * Tests the PATCH /snapshots/:id/trade-levels handler and field validation.
 */

import express, { Express } from 'express';
import request from 'supertest';
import nock from 'nock';

const mockQuery = jest.fn();

jest.mock('../services/database.service.js', () => ({
  db: { query: mockQuery },
}));

jest.mock('../services/auth.service.js', () => ({
  authService: {
    extractTokenFromHeader: (h: string | undefined) => h?.replace('Bearer ', '') || null,
    verifyToken: (t: string) => t === 'valid-token' ? { userId: '1', email: 'a@b.com', role: 'admin' } : null,
  },
}));

jest.mock('../utils/logger.js', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

jest.mock('../config/trading-mode.js', () => ({
  getTradingMode: () => 'LEGACY_ONLY',
  setTradingMode: jest.fn(),
}));

import udcRouter from '../routes/udc.js';

let app: Express;

beforeAll(() => {
  nock.enableNetConnect('127.0.0.1');
  app = express();
  app.use(express.json());
  app.use('/api/udc', udcRouter);
});

afterEach(() => {
  mockQuery.mockReset();
});

const AUTH = { Authorization: 'Bearer valid-token' };

describe('GET /api/udc/snapshots', () => {
  test('returns trade-level fields in snapshot rows', async () => {
    const row = {
      id: 'snap-1',
      signal_id: 'sig-1',
      decision_id: 'dec-1',
      status: 'PLAN_CREATED',
      reason: null,
      order_plan_json: null,
      strategy_json: null,
      entry_price_low: 693,
      entry_price_high: 694,
      exit_price_partial: 695,
      exit_price_full: 698,
      invalidation_price: 690,
      option_stop_pct: 50,
      created_at: '2026-02-24T00:00:00Z',
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const res = await request(app).get('/api/udc/snapshots').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].entry_price_low).toBe(693);
    expect(res.body.data[0].exit_price_full).toBe(698);
    expect(res.body.data[0].invalidation_price).toBe(690);
    expect(res.body.data[0].option_stop_pct).toBe(50);
  });

  test('returns null trade-level fields when not set', async () => {
    const row = {
      id: 'snap-2',
      signal_id: 'sig-2',
      decision_id: null,
      status: 'NO_STRATEGY',
      reason: null,
      order_plan_json: null,
      strategy_json: null,
      entry_price_low: null,
      entry_price_high: null,
      exit_price_partial: null,
      exit_price_full: null,
      invalidation_price: null,
      option_stop_pct: 50,
      created_at: '2026-02-24T00:00:00Z',
    };

    mockQuery
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });

    const res = await request(app).get('/api/udc/snapshots').set(AUTH);

    expect(res.status).toBe(200);
    expect(res.body.data[0].entry_price_low).toBeNull();
    expect(res.body.data[0].exit_price_full).toBeNull();
    expect(res.body.data[0].invalidation_price).toBeNull();
  });
});

describe('PATCH /api/udc/snapshots/:id/trade-levels', () => {
  test('saves valid trade levels and returns updated row', async () => {
    const returned = {
      id: 'snap-1',
      entry_price_low: 693,
      entry_price_high: 694,
      exit_price_partial: 695,
      exit_price_full: 698,
      invalidation_price: 690,
      option_stop_pct: 50,
    };
    mockQuery.mockResolvedValueOnce({ rows: [returned] });

    const res = await request(app)
      .patch('/api/udc/snapshots/snap-1/trade-levels')
      .set(AUTH)
      .send({
        entry_price_low: 693,
        entry_price_high: 694,
        exit_price_partial: 695,
        exit_price_full: 698,
        invalidation_price: 690,
        option_stop_pct: 50,
      });

    expect(res.status).toBe(200);
    expect(res.body.entry_price_low).toBe(693);
    expect(res.body.exit_price_full).toBe(698);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('UPDATE decision_snapshots');
    expect(sql).toContain('entry_price_low');
    expect(params).toContain(693);
    expect(params).toContain('snap-1');
  });

  test('accepts partial updates (only some fields)', async () => {
    const returned = {
      id: 'snap-1',
      entry_price_low: 693,
      entry_price_high: null,
      exit_price_partial: null,
      exit_price_full: null,
      invalidation_price: 690,
      option_stop_pct: 50,
    };
    mockQuery.mockResolvedValueOnce({ rows: [returned] });

    const res = await request(app)
      .patch('/api/udc/snapshots/snap-1/trade-levels')
      .set(AUTH)
      .send({ entry_price_low: 693, invalidation_price: 690 });

    expect(res.status).toBe(200);
    const [sql, params] = mockQuery.mock.calls[0];
    const setClause = sql.split('SET')[1].split('WHERE')[0];
    expect(setClause).toContain('entry_price_low');
    expect(setClause).toContain('invalidation_price');
    expect(setClause).not.toContain('exit_price_full');
    expect(params).toHaveLength(3); // 2 fields + id
  });

  test('sets field to null when empty string is sent', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'snap-1', entry_price_low: null, entry_price_high: null,
        exit_price_partial: null, exit_price_full: null,
        invalidation_price: null, option_stop_pct: 50,
      }],
    });

    const res = await request(app)
      .patch('/api/udc/snapshots/snap-1/trade-levels')
      .set(AUTH)
      .send({ entry_price_low: '', invalidation_price: null });

    expect(res.status).toBe(200);
    const [, params] = mockQuery.mock.calls[0];
    expect(params[0]).toBeNull();
    expect(params[1]).toBeNull();
  });

  test('returns 400 when no valid fields provided', async () => {
    const res = await request(app)
      .patch('/api/udc/snapshots/snap-1/trade-levels')
      .set(AUTH)
      .send({ bogus_field: 123 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No valid fields');
  });

  test('returns 404 when snapshot not found', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const res = await request(app)
      .patch('/api/udc/snapshots/nonexistent/trade-levels')
      .set(AUTH)
      .send({ entry_price_low: 100 });

    expect(res.status).toBe(404);
  });

  test('returns 401 when not authenticated', async () => {
    const res = await request(app)
      .patch('/api/udc/snapshots/snap-1/trade-levels')
      .send({ entry_price_low: 100 });

    expect(res.status).toBe(401);
  });

  test('ignores unknown fields and only processes whitelisted ones', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        id: 'snap-1', entry_price_low: 500, entry_price_high: null,
        exit_price_partial: null, exit_price_full: null,
        invalidation_price: null, option_stop_pct: 50,
      }],
    });

    const res = await request(app)
      .patch('/api/udc/snapshots/snap-1/trade-levels')
      .set(AUTH)
      .send({ entry_price_low: 500, sql_injection: 'DROP TABLE' });

    expect(res.status).toBe(200);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('sql_injection');
  });
});

describe('Risk/Reward calculation logic', () => {
  function calcRR(entryLow: number | null, exitFull: number | null, inv: number | null): string {
    const reward = entryLow != null && exitFull != null ? exitFull - entryLow : null;
    const risk = entryLow != null && inv != null ? entryLow - inv : null;
    return risk != null && reward != null && risk > 0 && reward > 0 ? (reward / risk).toFixed(1) : '—';
  }

  test('calculates correctly with all values present', () => {
    expect(calcRR(693, 698, 690)).toBe('1.7');
  });

  test('returns dash when entry is null', () => {
    expect(calcRR(null, 698, 690)).toBe('—');
  });

  test('returns dash when exit is null', () => {
    expect(calcRR(693, null, 690)).toBe('—');
  });

  test('returns dash when invalidation is null', () => {
    expect(calcRR(693, 698, null)).toBe('—');
  });

  test('returns dash when risk is zero (entry equals invalidation)', () => {
    expect(calcRR(690, 695, 690)).toBe('—');
  });

  test('returns dash when reward is negative (exit below entry)', () => {
    expect(calcRR(693, 690, 688)).toBe('—');
  });

  test('handles very favorable risk/reward', () => {
    expect(calcRR(500, 510, 499)).toBe('10.0');
  });

  test('handles 1:1 risk/reward', () => {
    expect(calcRR(500, 505, 495)).toBe('1.0');
  });
});
