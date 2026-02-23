export interface OptionsEngineConfig {
  latency: LatencyConfig;
  liquidity: LiquidityConfig;
  sanity: SanityConfig;
  slippage: SlippageConfig;
  exits: ExitsConfig;
  portfolio: PortfolioConfig;
  buckets: Record<string, number>;
  tapering: TaperingConfig;
  pause: PauseConfig;
  regime: RegimeConfig;
  metaLearner: MetaLearnerConfig;
  cache: CacheConfig;
  timeouts: TimeoutsConfig;
  session: SessionConfig;
  brokerSync: BrokerSyncConfig;
  volSurface: VolSurfaceConfig;
  correlation: CorrelationConfig;
  research?: ResearchConfig;
}

export interface LatencyConfig {
  maxTotalDecisionCycleMs_cached: number;
  maxTotalDecisionCycleMs_cold: number;
  maxConstructionLatencyMs: number;
  maxGovernorLatencyMs: number;
  maxLedgerLatencyMs: number;
  maxSessionGuardLatencyMs: number;
}

export interface LiquidityConfig {
  minOI: number;
  minVolume: number;
  maxSpreadWidthPct: number;
  minLiquidityScore: number;
  minCreditRatio: number;
  volumeMaxRefDefault: number;
  oiMaxRefDefault: number;
}

export interface SanityConfig {
  maxGreekMismatch: number;
  maxSpreadWidthSanity: number;
  maxDelta: number;
  maxIV: number;
  maxUnderlyingMovePct: number;
  minOptionPremium: number;
  gammaNegativeEpsilon: number;
}

export interface SlippageConfig {
  repriceAttempts: number;
  repriceIntervalSeconds: number;
  repriceSpreadImprovement: number[];
  fillTimeoutSeconds: number;
  maxMidMovement15s: number;
  maxUnderlyingMovement15s: number;
}

export interface ExitsConfig {
  creditSpread: {
    profitTargetPct: number;
    stopLossPct: number;
  };
}

export interface PortfolioConfig {
  maxNetDeltaPct: number;
  maxShockLossPct: number;
  maxUnderlyingRiskPct: number;
  maxDTEConcentrationPct: number;
  underlyingLiquidityFloorPct: number;
  underlyingLiquidityRejectPct: number;
  maxCorrelationBucketRiskPct: number;
}

export interface TaperingConfig {
  level1DrawdownPct: number;
  level1SizeMultiplier: number;
  level2DrawdownPct: number;
  level2FreezeEntries: boolean;
}

export interface PauseConfig {
  losingStreakCount: number;
  pauseDurationMinutes: number;
  ivSpikeThresholdPct: number;
  ivSpikeSizeReduction: number;
}

export interface RegimeConfig {
  ivLowThreshold: number;
  ivHighThreshold: number;
  minIVSampleDays: number;
  hysteresisCount: number;
  blockTradesOnUnknownIV: boolean;
}

export interface MetaLearnerConfig {
  minSampleCount: number;
  degradationThreshold: number;
  adjustmentFactor: number;
  cooldownTrades: number;
  weightFloor: number;
  weightCeiling: number;
}

export interface CacheConfig {
  chainTTLSeconds: number;
  snapshotTTLSeconds: number;
  snapshotMaxAgeAtUseSeconds: number;
  underlyingPriceTTLSeconds: number;
}

export interface TimeoutsConfig {
  massiveHTTPSeconds: number;
  lockAcquisitionMs: number;
  lockTTLSeconds: number;
  streamDisconnectPauseSecs: number;
}

export interface SessionConfig {
  openBufferMinutes: number;
  closeBufferMinutes: number;
  haltResumeBufferMinutes: number;
  dayCloseTimeET: string;
  timezone: string;
}

export interface BrokerSyncConfig {
  intervalMinutes: number;
  warningThresholdPct: number;
  freezeThresholdPct: number;
}

export interface VolSurfaceConfig {
  termEpsilon: number;
  frontDTERange: [number, number];
  midDTE: number;
  backDTERange: [number, number];
  backFallbackRange: [number, number];
  redisTTLMarketHours: number;
  redisTTLAfterHours: number;
}

export interface CorrelationConfig {
  windowDays: number;
  calendarDaysToFetch: number;
  threshold: number;
  coreTickers: string[];
  method: string;
}

export interface ResearchConfig {
  drift: DriftConfig;
}

export interface DriftConfig {
  winRateDropPct: number;
  sharpeDropAbs: number;
  slippageIncreasePct: number;
  pnlMeanDropPct: number;
  rollingWindow: number;
  baselineWindow: number;
}

const REQUIRED_KEYS: string[] = [
  'latency.maxTotalDecisionCycleMs_cached',
  'latency.maxTotalDecisionCycleMs_cold',
  'liquidity.minOI',
  'liquidity.minVolume',
  'sanity.maxDelta',
  'sanity.maxIV',
  'exits.creditSpread.profitTargetPct',
  'portfolio.maxNetDeltaPct',
  'buckets',
  'tapering.level1DrawdownPct',
  'regime.ivLowThreshold',
  'regime.ivHighThreshold',
  'cache.chainTTLSeconds',
  'timeouts.massiveHTTPSeconds',
  'timeouts.lockAcquisitionMs',
  'timeouts.lockTTLSeconds',
  'session.timezone',
  'brokerSync.intervalMinutes',
];

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

export function validateConfig(config: unknown): string[] {
  const errors: string[] = [];

  if (!config || typeof config !== 'object') {
    return ['Config must be a non-null object'];
  }

  const c = config as Record<string, unknown>;

  for (const key of REQUIRED_KEYS) {
    const value = getNestedValue(c, key);
    if (value === undefined || value === null) {
      errors.push(`Missing required config key: ${key}`);
    }
  }

  const latency = c.latency as Record<string, unknown> | undefined;
  if (latency) {
    if (typeof latency.maxTotalDecisionCycleMs_cached === 'number' && latency.maxTotalDecisionCycleMs_cached <= 0) {
      errors.push('latency.maxTotalDecisionCycleMs_cached must be positive');
    }
    if (typeof latency.maxTotalDecisionCycleMs_cold === 'number' && latency.maxTotalDecisionCycleMs_cold <= 0) {
      errors.push('latency.maxTotalDecisionCycleMs_cold must be positive');
    }
  }

  const regime = c.regime as Record<string, unknown> | undefined;
  if (regime) {
    const low = regime.ivLowThreshold as number;
    const high = regime.ivHighThreshold as number;
    if (typeof low === 'number' && typeof high === 'number' && low >= high) {
      errors.push('regime.ivLowThreshold must be less than regime.ivHighThreshold');
    }
  }

  const buckets = c.buckets as Record<string, number> | undefined;
  if (buckets && typeof buckets === 'object') {
    const sum = Object.values(buckets).reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1.0) > 0.01) {
      errors.push(`Bucket allocations must sum to 1.0 (got ${sum})`);
    }
  }

  return errors;
}
