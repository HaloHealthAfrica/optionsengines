import { join } from 'path';
import { validateConfig } from '../../engine/config/schema';
import { loadOptionsEngineConfig } from '../../engine/config/loader';

const VALID_CONFIG_PATH = join(process.cwd(), 'config', 'options-engine.yaml');

// Mock logger + Sentry before importing modules that use them
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

describe('OptionsEngineConfig Validation', () => {
  test('validates a complete config without errors', () => {
    const errors = validateConfig({
      latency: {
        maxTotalDecisionCycleMs_cached: 700,
        maxTotalDecisionCycleMs_cold: 2000,
        maxConstructionLatencyMs: 400,
        maxGovernorLatencyMs: 150,
        maxLedgerLatencyMs: 100,
        maxSessionGuardLatencyMs: 50,
      },
      liquidity: { minOI: 200, minVolume: 50, maxSpreadWidthPct: 0.15, minLiquidityScore: 0.55, minCreditRatio: 0.33, volumeMaxRefDefault: 5000, oiMaxRefDefault: 20000 },
      sanity: { maxGreekMismatch: 0.15, maxSpreadWidthSanity: 1.0, maxDelta: 1.05, maxIV: 5.0, maxUnderlyingMovePct: 0.20, minOptionPremium: 0.01, gammaNegativeEpsilon: 0.0001 },
      slippage: { repriceAttempts: 3, repriceIntervalSeconds: 10, repriceSpreadImprovement: [0.10, 0.20], fillTimeoutSeconds: 30, maxMidMovement15s: 0.10, maxUnderlyingMovement15s: 0.005 },
      exits: { creditSpread: { profitTargetPct: 0.50, stopLossPct: 1.00 } },
      portfolio: { maxNetDeltaPct: 0.15, maxShockLossPct: 0.75, maxUnderlyingRiskPct: 0.25, maxDTEConcentrationPct: 0.60, underlyingLiquidityFloorPct: 0.50, underlyingLiquidityRejectPct: 0.30, maxCorrelationBucketRiskPct: 0.40 },
      buckets: { ORB: 0.30, GEX: 0.30, Spread: 0.30, Experimental: 0.10 },
      tapering: { level1DrawdownPct: 0.50, level1SizeMultiplier: 0.50, level2DrawdownPct: 0.80, level2FreezeEntries: true },
      pause: { losingStreakCount: 3, pauseDurationMinutes: 30, ivSpikeThresholdPct: 0.10, ivSpikeSizeReduction: 0.25 },
      regime: { ivLowThreshold: 0.33, ivHighThreshold: 0.66, minIVSampleDays: 63, hysteresisCount: 3, blockTradesOnUnknownIV: false },
      metaLearner: { minSampleCount: 50, degradationThreshold: 0.10, adjustmentFactor: 0.80, cooldownTrades: 10, weightFloor: 0.50, weightCeiling: 1.50 },
      cache: { chainTTLSeconds: 300, snapshotTTLSeconds: 2, snapshotMaxAgeAtUseSeconds: 30, underlyingPriceTTLSeconds: 5 },
      timeouts: { massiveHTTPSeconds: 3, lockAcquisitionMs: 500, lockTTLSeconds: 5, streamDisconnectPauseSecs: 30 },
      session: { openBufferMinutes: 5, closeBufferMinutes: 15, haltResumeBufferMinutes: 2, dayCloseTimeET: '15:45', timezone: 'America/New_York' },
      brokerSync: { intervalMinutes: 5, warningThresholdPct: 0.01, freezeThresholdPct: 0.05 },
    });

    expect(errors).toHaveLength(0);
  });

  test('rejects null config', () => {
    const errors = validateConfig(null);
    expect(errors).toContain('Config must be a non-null object');
  });

  test('reports missing required keys', () => {
    const errors = validateConfig({});
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.includes('Missing required config key'))).toBe(true);
  });

  test('rejects non-positive latency budgets', () => {
    const errors = validateConfig({
      latency: { maxTotalDecisionCycleMs_cached: -1, maxTotalDecisionCycleMs_cold: 2000 },
      liquidity: { minOI: 200, minVolume: 50 },
      sanity: { maxDelta: 1.05, maxIV: 5.0 },
      exits: { creditSpread: { profitTargetPct: 0.50 } },
      portfolio: { maxNetDeltaPct: 0.15 },
      buckets: { A: 1.0 },
      tapering: { level1DrawdownPct: 0.50 },
      regime: { ivLowThreshold: 0.33, ivHighThreshold: 0.66 },
      cache: { chainTTLSeconds: 300 },
      timeouts: { massiveHTTPSeconds: 3, lockAcquisitionMs: 500, lockTTLSeconds: 5 },
      session: { timezone: 'America/New_York' },
      brokerSync: { intervalMinutes: 5 },
    });
    expect(errors.some(e => e.includes('must be positive'))).toBe(true);
  });

  test('rejects ivLowThreshold >= ivHighThreshold', () => {
    const errors = validateConfig({
      latency: { maxTotalDecisionCycleMs_cached: 700, maxTotalDecisionCycleMs_cold: 2000 },
      liquidity: { minOI: 200, minVolume: 50 },
      sanity: { maxDelta: 1.05, maxIV: 5.0 },
      exits: { creditSpread: { profitTargetPct: 0.50 } },
      portfolio: { maxNetDeltaPct: 0.15 },
      buckets: { A: 1.0 },
      tapering: { level1DrawdownPct: 0.50 },
      regime: { ivLowThreshold: 0.80, ivHighThreshold: 0.30 },
      cache: { chainTTLSeconds: 300 },
      timeouts: { massiveHTTPSeconds: 3, lockAcquisitionMs: 500, lockTTLSeconds: 5 },
      session: { timezone: 'America/New_York' },
      brokerSync: { intervalMinutes: 5 },
    });
    expect(errors.some(e => e.includes('ivLowThreshold must be less than'))).toBe(true);
  });

  test('rejects bucket allocations that do not sum to 1.0', () => {
    const errors = validateConfig({
      latency: { maxTotalDecisionCycleMs_cached: 700, maxTotalDecisionCycleMs_cold: 2000 },
      liquidity: { minOI: 200, minVolume: 50 },
      sanity: { maxDelta: 1.05, maxIV: 5.0 },
      exits: { creditSpread: { profitTargetPct: 0.50 } },
      portfolio: { maxNetDeltaPct: 0.15 },
      buckets: { ORB: 0.50, GEX: 0.50, Spread: 0.50 },
      tapering: { level1DrawdownPct: 0.50 },
      regime: { ivLowThreshold: 0.33, ivHighThreshold: 0.66 },
      cache: { chainTTLSeconds: 300 },
      timeouts: { massiveHTTPSeconds: 3, lockAcquisitionMs: 500, lockTTLSeconds: 5 },
      session: { timezone: 'America/New_York' },
      brokerSync: { intervalMinutes: 5 },
    });
    expect(errors.some(e => e.includes('Bucket allocations must sum to 1.0'))).toBe(true);
  });

  test('loads the actual YAML config file successfully', () => {
    const config = loadOptionsEngineConfig(VALID_CONFIG_PATH);
    expect(config.latency.maxTotalDecisionCycleMs_cached).toBe(700);
    expect(config.latency.maxTotalDecisionCycleMs_cold).toBe(2000);
    expect(config.regime.ivLowThreshold).toBe(0.33);
    expect(config.regime.ivHighThreshold).toBe(0.66);
    expect(config.buckets.ORB).toBe(0.30);
  });
});
