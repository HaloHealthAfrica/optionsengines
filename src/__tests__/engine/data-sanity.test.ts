import { RejectionCode, GreekSource } from '../../engine/types/enums';

jest.mock('../../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock('@sentry/node', () => ({
  captureException: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
jest.mock('../../config/index', () => ({
  config: { logLevel: 'info', databaseUrl: '', dbPoolMax: 5, slowRequestMs: 1000 },
}));
jest.mock('../../engine/config/loader', () => ({
  getEngineConfig: () => ({
    sanity: {
      maxGreekMismatch: 0.15,
      maxSpreadWidthSanity: 1.0,
      maxDelta: 1.05,
      maxIV: 5.0,
      maxUnderlyingMovePct: 0.20,
      minOptionPremium: 0.01,
      gammaNegativeEpsilon: 0.0001,
    },
    liquidity: {
      minOI: 200,
      minVolume: 50,
    },
    cache: {
      snapshotMaxAgeAtUseSeconds: 30,
    },
  }),
}));

import { DataSanityValidator } from '../../engine/data/DataSanityValidator';
import type { CandidateInput } from '../../engine/data/DataSanityValidator';

function makeCandidate(overrides: Partial<CandidateInput> = {}): CandidateInput {
  return {
    optionTicker: 'O:SPY260220C00500000',
    bid: 2.50,
    ask: 2.70,
    mid: 2.60,
    iv: 0.25,
    delta: 0.45,
    gamma: 0.03,
    volume: 500,
    oi: 5000,
    spreadWidthPct: 0.077,
    quoteTimestamp: new Date(),
    underlyingPrice: 500,
    greekSource: GreekSource.MASSIVE,
    ...overrides,
  };
}

describe('DataSanityValidator', () => {
  let validator: DataSanityValidator;

  beforeEach(() => {
    validator = new DataSanityValidator();
  });

  // ─── Underlying Price Sanity ───

  describe('validateUnderlying', () => {
    test('passes valid underlying price', () => {
      const result = validator.validateUnderlying({ price: 500, priorClose: 495 });
      expect(result.passed).toBe(true);
      expect(result.movePct).toBeCloseTo(0.0101, 3);
    });

    test('rejects price <= 0', () => {
      const result = validator.validateUnderlying({ price: 0, priorClose: 495 });
      expect(result.passed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.UNDERLYING_PRICE_SANITY_FAILURE);
    });

    test('rejects negative price', () => {
      const result = validator.validateUnderlying({ price: -5, priorClose: 495 });
      expect(result.passed).toBe(false);
    });

    test('rejects move > 20% from prior close', () => {
      const result = validator.validateUnderlying({ price: 600, priorClose: 490 });
      expect(result.passed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.UNDERLYING_PRICE_SANITY_FAILURE);
      expect(result.reason).toContain('exceeds max');
    });

    test('passes when no prior close available', () => {
      const result = validator.validateUnderlying({ price: 500, priorClose: null });
      expect(result.passed).toBe(true);
      expect(result.movePct).toBeNull();
    });

    test('passes move exactly at 20%', () => {
      // 20% of 500 = 100, so price at 600 from close of 500 = 20%
      const result = validator.validateUnderlying({ price: 600, priorClose: 500 });
      expect(result.passed).toBe(true);
    });

    test('rejects move just over 20%', () => {
      const result = validator.validateUnderlying({ price: 601, priorClose: 500 });
      expect(result.passed).toBe(false);
    });
  });

  // ─── Candidate Sanity ───

  describe('validateCandidate', () => {
    test('passes valid candidate', () => {
      const result = validator.validateCandidate(makeCandidate());
      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    test('rejects bid > ask', () => {
      const result = validator.validateCandidate(makeCandidate({ bid: 3.00, ask: 2.50 }));
      expect(result.passed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.DATA_SANITY_FAILURE);
      expect(result.reason).toContain('bid');
    });

    test('rejects negative bid', () => {
      const result = validator.validateCandidate(makeCandidate({ bid: -0.10 }));
      expect(result.passed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.DATA_SANITY_FAILURE);
    });

    test('rejects negative ask', () => {
      const result = validator.validateCandidate(makeCandidate({ ask: -0.10 }));
      expect(result.passed).toBe(false);
    });

    test('rejects mid <= 0', () => {
      const result = validator.validateCandidate(makeCandidate({ mid: 0 }));
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('mid <= 0');
    });

    test('rejects spreadWidthPct > maxSpreadWidthSanity (1.0)', () => {
      const result = validator.validateCandidate(makeCandidate({ spreadWidthPct: 1.5 }));
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('spreadWidthPct');
    });

    test('rejects |delta| > maxDelta (1.05)', () => {
      const result = validator.validateCandidate(makeCandidate({ delta: 1.10 }));
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('delta');
    });

    test('rejects negative IV', () => {
      const result = validator.validateCandidate(makeCandidate({ iv: -0.1 }));
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('IV');
    });

    test('rejects IV > maxIV (5.0)', () => {
      const result = validator.validateCandidate(makeCandidate({ iv: 6.0 }));
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('IV');
    });

    test('allows null IV (no rejection)', () => {
      const result = validator.validateCandidate(makeCandidate({ iv: null }));
      expect(result.passed).toBe(true);
    });

    test('allows null delta (no rejection for sanity)', () => {
      const result = validator.validateCandidate(makeCandidate({ delta: null }));
      expect(result.passed).toBe(true);
    });

    test('rejects mid < minOptionPremium (0.01)', () => {
      const result = validator.validateCandidate(makeCandidate({
        bid: 0.001, ask: 0.005, mid: 0.003,
      }));
      expect(result.passed).toBe(false);
      expect(result.reason).toContain('minOptionPremium');
    });

    test('rejects stale quote (> 30s)', () => {
      const staleTime = new Date(Date.now() - 35000); // 35 seconds ago
      const result = validator.validateCandidate(makeCandidate({ quoteTimestamp: staleTime }));
      expect(result.passed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.STALE_SNAPSHOT);
    });

    test('passes fresh quote (< 30s)', () => {
      const freshTime = new Date(Date.now() - 5000); // 5 seconds ago
      const result = validator.validateCandidate(makeCandidate({ quoteTimestamp: freshTime }));
      expect(result.passed).toBe(true);
    });

    // ─── Gamma Sign Sanity ───

    test('rejects gamma < -0.0001', () => {
      const result = validator.validateCandidate(makeCandidate({ gamma: -0.001 }));
      expect(result.passed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.GAMMA_SIGN_SANITY_FAILURE);
    });

    test('allows gamma = -0.00005 (within epsilon)', () => {
      const result = validator.validateCandidate(makeCandidate({ gamma: -0.00005 }));
      expect(result.passed).toBe(true);
    });

    test('allows gamma = 0', () => {
      const result = validator.validateCandidate(makeCandidate({ gamma: 0 }));
      expect(result.passed).toBe(true);
    });

    test('allows null gamma', () => {
      const result = validator.validateCandidate(makeCandidate({ gamma: null }));
      expect(result.passed).toBe(true);
    });

    // ─── Deep ITM Handling ───

    test('allows deep ITM when |delta| >= 0.95 and volume+oi valid', () => {
      const result = validator.validateCandidate(makeCandidate({
        mid: 510, // mid > underlyingPrice (500)
        delta: 0.98,
        volume: 100,
        oi: 500,
      }));
      expect(result.passed).toBe(true);
      expect(result.warnings).toContain('ITM_PLAUSIBLE_WARNING');
    });

    test('rejects deep ITM when |delta| < 0.95', () => {
      const result = validator.validateCandidate(makeCandidate({
        mid: 510,
        delta: 0.80,
        volume: 100,
        oi: 500,
      }));
      expect(result.passed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.DATA_SANITY_FAILURE);
      expect(result.reason).toContain('Deep ITM');
    });

    test('rejects deep ITM when volume too low', () => {
      const result = validator.validateCandidate(makeCandidate({
        mid: 510,
        delta: 0.98,
        volume: 10, // below minVolume=50
        oi: 500,
      }));
      expect(result.passed).toBe(false);
    });

    test('rejects deep ITM when OI too low', () => {
      const result = validator.validateCandidate(makeCandidate({
        mid: 510,
        delta: 0.98,
        volume: 100,
        oi: 50, // below minOI=200
      }));
      expect(result.passed).toBe(false);
    });

    // ─── Greek Consistency (UW vs Massive delta) ───

    test('passes when UW and Massive deltas are close', () => {
      const result = validator.validateCandidate(makeCandidate({
        uwDelta: 0.45,
        massiveDelta: 0.48,
      }));
      expect(result.passed).toBe(true);
    });

    test('rejects when UW and Massive deltas differ > maxGreekMismatch (0.15)', () => {
      const result = validator.validateCandidate(makeCandidate({
        uwDelta: 0.45,
        massiveDelta: 0.65,
      }));
      expect(result.passed).toBe(false);
      expect(result.rejectionCode).toBe(RejectionCode.GREEK_SOURCE_UNAVAILABLE);
      expect(result.reason).toContain('delta mismatch');
    });

    test('skips greek consistency when only one source available', () => {
      const result = validator.validateCandidate(makeCandidate({
        uwDelta: 0.45,
        massiveDelta: null,
      }));
      expect(result.passed).toBe(true);
    });

    test('skips greek consistency when both null', () => {
      const result = validator.validateCandidate(makeCandidate({
        uwDelta: null,
        massiveDelta: null,
      }));
      expect(result.passed).toBe(true);
    });
  });

  // ─── Batch Validation ───

  describe('validateCandidates', () => {
    test('returns all results when underlying passes', () => {
      const candidates = [
        makeCandidate({ optionTicker: 'C1' }),
        makeCandidate({ optionTicker: 'C2', bid: 5, ask: 3 }), // bad
        makeCandidate({ optionTicker: 'C3' }),
      ];

      const summary = validator.validateCandidates(
        { price: 500, priorClose: 495 },
        candidates
      );

      expect(summary.underlyingResult.passed).toBe(true);
      expect(summary.totalCount).toBe(3);
      expect(summary.passedCount).toBe(2);
      expect(summary.rejectedCount).toBe(1);
      expect(summary.candidateResults[1].passed).toBe(false);
    });

    test('rejects all candidates when underlying fails', () => {
      const candidates = [
        makeCandidate({ optionTicker: 'C1' }),
        makeCandidate({ optionTicker: 'C2' }),
      ];

      const summary = validator.validateCandidates(
        { price: 0, priorClose: 495 },
        candidates
      );

      expect(summary.underlyingResult.passed).toBe(false);
      expect(summary.candidateResults).toHaveLength(0);
      expect(summary.rejectedCount).toBe(2);
    });
  });

  // ─── Edge Cases / Property Tests ───

  describe('edge cases', () => {
    test('bid = ask = mid (zero spread) passes', () => {
      const result = validator.validateCandidate(makeCandidate({
        bid: 2.50, ask: 2.50, mid: 2.50, spreadWidthPct: 0,
      }));
      expect(result.passed).toBe(true);
    });

    test('extremely small but valid option passes', () => {
      const result = validator.validateCandidate(makeCandidate({
        bid: 0.01, ask: 0.02, mid: 0.015, spreadWidthPct: 0.667,
      }));
      expect(result.passed).toBe(true);
    });

    test('delta exactly at boundary (1.05) passes', () => {
      const result = validator.validateCandidate(makeCandidate({ delta: 1.05 }));
      expect(result.passed).toBe(true);
    });

    test('delta just over boundary (1.06) fails', () => {
      const result = validator.validateCandidate(makeCandidate({ delta: 1.06 }));
      expect(result.passed).toBe(false);
    });

    test('IV at boundary (5.0) passes', () => {
      const result = validator.validateCandidate(makeCandidate({ iv: 5.0 }));
      expect(result.passed).toBe(true);
    });

    test('IV just over boundary (5.01) fails', () => {
      const result = validator.validateCandidate(makeCandidate({ iv: 5.01 }));
      expect(result.passed).toBe(false);
    });
  });
});
