import { RejectionCode } from '../../engine/types/enums';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockSessionConfig = {
  openBufferMinutes: 5,
  closeBufferMinutes: 10,
  haltResumeBufferMinutes: 3,
  dayCloseTimeET: '16:00',
  timezone: 'America/New_York',
};

jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => ({
    session: mockSessionConfig,
  }),
}));

import { SessionGuard } from '../../engine/core/SessionGuard';

describe('SessionGuard', () => {
  let guard: SessionGuard;

  beforeEach(() => {
    guard = new SessionGuard();
  });

  // ─── Utility: Mocking getNowET via a spy ───
  function setMockTime(hour: number, minute: number, dayOfWeek: number): void {
    jest.spyOn(guard as any, 'getNowET').mockReturnValue(
      (() => {
        const d = new Date(2026, 1, 23, hour, minute, 0);
        // Override getDay to return desired dayOfWeek
        d.getDay = () => dayOfWeek;
        return d;
      })()
    );
  }

  describe('market hours', () => {
    test('allows entry during normal trading hours', () => {
      setMockTime(10, 0, 1); // Mon 10:00 ET
      const result = guard.check();
      expect(result.allowed).toBe(true);
      expect(result.sessionInfo.marketOpen).toBe(true);
    });

    test('rejects entry on weekend (Saturday)', () => {
      setMockTime(12, 0, 6); // Sat 12:00 ET
      const result = guard.check();
      expect(result.allowed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.SESSION_CLOSED);
      expect(result.reason).toContain('weekend');
    });

    test('rejects entry on weekend (Sunday)', () => {
      setMockTime(12, 0, 0); // Sun 12:00 ET
      const result = guard.check();
      expect(result.allowed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.SESSION_CLOSED);
    });

    test('rejects entry before market open', () => {
      setMockTime(9, 0, 2); // Tue 09:00 ET (before 9:30)
      const result = guard.check();
      expect(result.allowed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.SESSION_CLOSED);
    });

    test('rejects entry after market close', () => {
      setMockTime(16, 30, 3); // Wed 16:30 ET (after 16:00)
      const result = guard.check();
      expect(result.allowed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.SESSION_CLOSED);
    });
  });

  describe('open buffer', () => {
    test('rejects within open buffer (first 5 minutes)', () => {
      setMockTime(9, 32, 1); // Mon 09:32 ET → 2 min since open < 5 min buffer
      const result = guard.check();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('open buffer');
    });

    test('allows after open buffer', () => {
      setMockTime(9, 36, 1); // Mon 09:36 ET → 6 min since open > 5 min buffer
      const result = guard.check();
      expect(result.allowed).toBe(true);
    });
  });

  describe('close buffer', () => {
    test('rejects within close buffer (last 10 minutes)', () => {
      setMockTime(15, 55, 4); // Thu 15:55 ET → 5 min until close < 10 min buffer
      const result = guard.check();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('close buffer');
    });

    test('allows before close buffer', () => {
      setMockTime(15, 40, 4); // Thu 15:40 ET → 20 min until close > 10 min buffer
      const result = guard.check();
      expect(result.allowed).toBe(true);
    });
  });

  describe('halt management', () => {
    test('rejects halted symbol', () => {
      setMockTime(11, 0, 1); // Mon 11:00 ET — normal hours
      guard.registerHalt('AAPL');
      const result = guard.check('AAPL');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('halted');
    });

    test('allows non-halted symbol', () => {
      setMockTime(11, 0, 1);
      guard.registerHalt('AAPL');
      const result = guard.check('MSFT');
      expect(result.allowed).toBe(true);
    });

    test('rejects within halt resume buffer', () => {
      setMockTime(11, 0, 1);
      guard.registerHalt('AAPL');
      guard.registerHaltResume('AAPL');

      // Immediately after resume — within 3-minute buffer
      const result = guard.check('AAPL');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('halt resume buffer');
    });

    test('allows after halt resume buffer expires', () => {
      setMockTime(11, 0, 1);
      guard.registerHalt('AAPL');
      guard.registerHaltResume('AAPL');

      // Force the resume timestamp to be 4 minutes ago
      (guard as any).haltResumedAt.set('AAPL', new Date(Date.now() - 4 * 60 * 1000));

      const result = guard.check('AAPL');
      expect(result.allowed).toBe(true);
    });
  });

  describe('session info', () => {
    test('populates session info correctly', () => {
      setMockTime(12, 0, 3); // Wed 12:00 ET
      const result = guard.check();
      const info = result.sessionInfo;

      expect(info.currentTimeET).toBe('12:00');
      expect(info.marketOpenET).toBe('09:30');
      expect(info.marketCloseET).toBe('16:00');
      expect(info.minutesSinceOpen).toBe(150); // 12:00 - 09:30 = 150 min
      expect(info.minutesUntilClose).toBe(240); // 16:00 - 12:00 = 240 min
      expect(info.marketOpen).toBe(true);
      expect(info.dayOfWeek).toBe(3);
    });
  });

  describe('no underlying (market-level check only)', () => {
    test('skips halt check when no underlying passed', () => {
      setMockTime(11, 0, 1);
      guard.registerHalt('AAPL');
      const result = guard.check(); // no underlying
      expect(result.allowed).toBe(true); // halt doesn't apply
    });
  });
});
