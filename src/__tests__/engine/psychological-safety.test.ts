import { RejectionCode } from '../../engine/types/enums';
import type { TradingAccount } from '../../engine/types/index';
import { SafetyEventType } from '../../engine/risk/PsychologicalSafetySystem';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000 },
}));

const mockGetEngineConfig = jest.fn();
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => mockGetEngineConfig(),
}));

const mockDbQuery = jest.fn();
jest.mock('../../services/database.service', () => ({
  db: { query: (...args: any[]) => mockDbQuery(...args) },
}));

import { PsychologicalSafetySystem } from '../../engine/risk/PsychologicalSafetySystem';

describe('PsychologicalSafetySystem', () => {
  let safety: PsychologicalSafetySystem;

  const defaultPauseConfig = {
    losingStreakCount: 3,
    pauseDurationMinutes: 30,
    ivSpikeThresholdPct: 0.10,
    ivSpikeSizeReduction: 0.25,
  };

  const defaultAccount: TradingAccount = {
    id: 'acct-1', name: 'Test', initialCapital: 100000,
    currentCash: 95000, reservedCapital: 5000,
    realizedPnL: 0, unrealizedPnL: -500, totalEquity: 99500,
    maxDailyLoss: 2000, maxPortfolioRisk: 10000,
    peakEquity: 100000, intradayRealizedPnL: 0, intradayStartEquity: 100000,
    entryFrozen: false, brokerSyncWarning: false, brokerSyncFrozen: false,
    brokerSyncedAt: null, createdAt: new Date(),
  };

  beforeEach(() => {
    safety = new PsychologicalSafetySystem();
    mockGetEngineConfig.mockReturnValue({ pause: defaultPauseConfig });
    mockDbQuery.mockReset();
  });

  describe('check — no active events, no streak', () => {
    test('allows trade when all clear', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [] }) // getActiveEvents
        .mockResolvedValueOnce({ rows: [] }) // active pause check
        .mockResolvedValueOnce({ rows: [{ realized_pnl: '100' }, { realized_pnl: '50' }] }); // recent positions (2 wins)

      const result = await safety.check('acct-1', defaultAccount, 0.50, 0.45);

      expect(result.allowed).toBe(true);
      expect(result.sizeMultiplier).toBe(1.0);
    });
  });

  describe('check — losing streak', () => {
    test('triggers pause on 3 consecutive losses', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [] }) // getActiveEvents
        .mockResolvedValueOnce({ rows: [] }) // active pause check
        .mockResolvedValueOnce({
          rows: [
            { realized_pnl: '-100' },
            { realized_pnl: '-50' },
            { realized_pnl: '-75' },
          ],
        }) // 3 consecutive losses
        .mockResolvedValueOnce({ rows: [] }); // insert event

      const result = await safety.check('acct-1', defaultAccount, 0.50, 0.45);

      expect(result.allowed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.PSYCHOLOGICAL_PAUSE);
      expect(result.reason).toContain('3 consecutive losses');
    });

    test('does not trigger when streak broken by a win', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [] }) // getActiveEvents
        .mockResolvedValueOnce({ rows: [] }) // active pause check
        .mockResolvedValueOnce({
          rows: [
            { realized_pnl: '-100' },
            { realized_pnl: '50' },  // win breaks streak
            { realized_pnl: '-75' },
          ],
        });

      const result = await safety.check('acct-1', defaultAccount, 0.50, 0.45);

      expect(result.allowed).toBe(true);
    });
  });

  describe('check — active pause event', () => {
    test('blocks when unexpired losing streak pause is active', async () => {
      const futureExpiry = new Date(Date.now() + 15 * 60 * 1000); // 15min from now
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          id: 'event-1', account_id: 'acct-1',
          event_type: SafetyEventType.LOSING_STREAK_PAUSE,
          trigger_value: '3 losses', action_taken: 'Pause 30min',
          size_multiplier: null, started_at: new Date().toISOString(),
          expires_at: futureExpiry.toISOString(), resolved_at: null,
        }],
      });

      const result = await safety.check('acct-1', defaultAccount, 0.50, 0.45);

      expect(result.allowed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.PSYCHOLOGICAL_PAUSE);
    });

    test('auto-resolves expired pause and allows trade', async () => {
      const pastExpiry = new Date(Date.now() - 5 * 60 * 1000); // 5min ago
      mockDbQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 'event-1', account_id: 'acct-1',
            event_type: SafetyEventType.LOSING_STREAK_PAUSE,
            trigger_value: '3 losses', action_taken: 'Pause 30min',
            size_multiplier: null, started_at: new Date(Date.now() - 35 * 60 * 1000).toISOString(),
            expires_at: pastExpiry.toISOString(), resolved_at: null,
          }],
        })
        .mockResolvedValueOnce({ rows: [] }) // resolveEvent
        .mockResolvedValueOnce({ rows: [] }) // active pause check for streak
        .mockResolvedValueOnce({ rows: [{ realized_pnl: '100' }] }); // recent positions

      const result = await safety.check('acct-1', defaultAccount, 0.50, 0.45);

      expect(result.allowed).toBe(true);
    });
  });

  describe('check — IV spike', () => {
    test('reduces size on IV spike exceeding threshold', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [] }) // getActiveEvents
        .mockResolvedValueOnce({ rows: [] }) // active pause check
        .mockResolvedValueOnce({ rows: [{ realized_pnl: '100' }] }) // no streak
        .mockResolvedValueOnce({ rows: [] }); // insert IV spike event

      // IV jumped from 0.40 to 0.55 (0.15 > 0.10 threshold)
      const result = await safety.check('acct-1', defaultAccount, 0.55, 0.40);

      expect(result.allowed).toBe(true);
      expect(result.sizeMultiplier).toBe(0.25); // ivSpikeSizeReduction
      expect(result.activeEvents).toHaveLength(1);
    });

    test('no reduction when IV change below threshold', async () => {
      mockDbQuery
        .mockResolvedValueOnce({ rows: [] }) // getActiveEvents
        .mockResolvedValueOnce({ rows: [] }) // active pause check
        .mockResolvedValueOnce({ rows: [{ realized_pnl: '100' }] }); // no streak

      // IV went from 0.50 to 0.55 (0.05 < 0.10 threshold)
      const result = await safety.check('acct-1', defaultAccount, 0.55, 0.50);

      expect(result.allowed).toBe(true);
      expect(result.sizeMultiplier).toBe(1.0);
    });
  });

  describe('check — drawdown freeze', () => {
    test('blocks trade when drawdown freeze event is active', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{
          id: 'event-2', account_id: 'acct-1',
          event_type: SafetyEventType.DRAWDOWN_FREEZE,
          trigger_value: '85% drawdown', action_taken: 'Freeze entries',
          size_multiplier: null, started_at: new Date().toISOString(),
          expires_at: null, resolved_at: null,
        }],
      });

      const result = await safety.check('acct-1', defaultAccount, 0.50, 0.45);

      expect(result.allowed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.PSYCHOLOGICAL_PAUSE);
      expect(result.reason).toContain('Drawdown freeze');
    });
  });

  describe('resolveAllForAccount', () => {
    test('resolves all active events', async () => {
      mockDbQuery.mockResolvedValueOnce({
        rows: [{ id: 'e1' }, { id: 'e2' }],
      });

      const count = await safety.resolveAllForAccount('acct-1');
      expect(count).toBe(2);
    });

    test('returns 0 when no active events', async () => {
      mockDbQuery.mockResolvedValueOnce({ rows: [] });
      const count = await safety.resolveAllForAccount('acct-1');
      expect(count).toBe(0);
    });
  });
});
