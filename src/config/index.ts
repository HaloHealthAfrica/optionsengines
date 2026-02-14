// Configuration management for the dual-engine options trading platform
import dotenv from 'dotenv';

dotenv.config();

interface Config {
  // Server
  port: number;
  nodeEnv: string;
  appMode: 'PAPER' | 'LIVE';

  // Database
  databaseUrl: string;
  dbPoolMax: number;

  // Redis Cache
  redisUrl: string;

  // Authentication
  jwtSecret: string;
  hmacSecret: string;

  // Market Data
  marketDataProvider: string;
  marketDataProviderPriority: string[];
  alpacaApiKey: string;
  alpacaSecretKey: string;
  alpacaPaper: boolean;
  alpacaBaseUrl: string;
  polygonApiKey: string;
  polygonBaseUrl: string;
  polygonRateLimit: number;
  polygonWsEnabled: boolean;
  twelveDataApiKey: string;
  marketDataApiKey: string;
  unusualWhalesApiKey: string;
  unusualWhalesGammaUrl: string;
  unusualWhalesOptionsEnabled: boolean;

  // Performance
  slowRequestMs: number;
  cacheTtlSeconds: number;

  // Rate Limiting
  alpacaRateLimit: number;
  twelveDataRateLimit: number;
  unusualWhalesRateLimitPerMinute: number;
  unusualWhalesRateLimitPerDay: number;

  // Worker Intervals
  signalProcessorInterval: number;
  orderCreatorInterval: number;
  paperExecutorInterval: number;
  paperExecutorBatchSize: number;
  positionRefresherInterval: number;
  exitMonitorInterval: number;
  orchestratorIntervalMs: number;
  orchestratorBatchSize: number;
  orchestratorConcurrency: number;
  orchestratorSignalTimeoutMs: number;
  orchestratorRetryDelayMs: number;
  processingQueueDepthAlert: number;
  processingQueueDepthDurationSec: number;

  // Risk Management
  maxPositionSize: number;
  maxDailyLoss: number;
  maxOpenPositions: number;
  maxExposurePercent: number;
  allowPremarket: boolean;
  allowAfterhours: boolean;
  decisionOnlyWhenMarketClosed: boolean;
  marketCloseGraceMinutes: number;
  signalMaxAgeMinutes: number;
  maxDailyTrades: number;
  positionReplacementEnabled: boolean;
  minConfidenceForReplacement: number;
  autoCloseNearTarget: boolean;
  autoCloseNearTargetThresholdPct: number;
  closeAgedPositions: boolean;
  closeAgedAfterHours: number;
  closeAgedBelowPnlPercent: number;

  // Exit Rules
  profitTargetPct: number;
  stopLossPct: number;
  timeStopDte: number;
  maxHoldDays: number;
  enableExitDecisionEngine: boolean;

  // Capacity Management
  minHoldMinutesForCapacityClose: number;

  // A/B Testing
  abSplitPercentage: number;
  enableVariantB: boolean;

  // Feature Flags (Engine 2)
  enableOrbSpecialist: boolean;
  enableStratSpecialist: boolean;
  enableTtmSpecialist: boolean;
  enableSatylandSubagent: boolean;
  enableShadowExecution: boolean;

  // Orchestrator
  enableOrchestrator: boolean;
  enableDualPaperTrading: boolean;

  // Market webhook pipeline
  enableMarketWebhookPipeline: boolean;

  // MTF Bias Processing System
  enableMTFBiasPipeline: boolean;
  requireMTFBiasForEntry: boolean;

  // Confluence (Flow page, trade gate, position sizing)
  confluenceMinThreshold: number;
  enableConfluenceGate: boolean;
  enableConfluenceSizing: boolean;
  basePositionSize: number;

  // Alerts
  discordWebhookUrl: string;
  slackWebhookUrl: string;
  alertsEnabled: boolean;
  alertCooldownMinutes: number;

  // Flow-first signals (Phase 10: UW flow poller)
  enableUwFlowPoller: boolean;
  uwFlowPollerIntervalMs: number;

  // Dealer strategy family (both use dealer gamma positioning)
  // UW = Unusual Whales gamma API | GEX = GEX/flow from positioning service
  enableDealerUwGamma: boolean;
  enableDealerGex: boolean;
  dealerStrategyWeight: number;
  dealerUwNeutralThreshold: number;

  // Logging
  logLevel: string;
}

function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (!value && defaultValue === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue!;
}

function getEnvVarNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  return value ? parseFloat(value) : defaultValue;
}

function getEnvVarBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key];
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
}

function getEnvVarBooleanWithFallback(
  primary: string,
  fallback: string,
  defaultValue: boolean
): boolean {
  const v = process.env[primary] ?? process.env[fallback];
  if (!v) return defaultValue;
  return v.toLowerCase() === 'true';
}

function getEnvVarNumberWithFallback(
  primary: string,
  fallback: string,
  defaultValue: number
): number {
  const v = process.env[primary] ?? process.env[fallback];
  return v ? parseFloat(v) : defaultValue;
}

const nodeEnv = getEnvVar('NODE_ENV', 'development');

export const config: Config = {
  // Server
  port: getEnvVarNumber('PORT', 8080),
  nodeEnv,
  appMode: (getEnvVar('APP_MODE', 'PAPER') as 'PAPER' | 'LIVE'),

  // Database
  databaseUrl: getEnvVar('DATABASE_URL'),
  dbPoolMax: getEnvVarNumber('DB_POOL_MAX', 20),

  // Redis Cache
  redisUrl: getEnvVar('REDIS_URL', ''),

  // Authentication
  jwtSecret: getEnvVar('JWT_SECRET'),
  hmacSecret: getEnvVar('HMAC_SECRET', ''),

  // Market Data
  marketDataProvider: getEnvVar('MARKET_DATA_PROVIDER', 'alpaca'),
  marketDataProviderPriority: getEnvVar(
    'MARKET_DATA_PROVIDER_PRIORITY',
    'alpaca,twelvedata'
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
  alpacaApiKey: getEnvVar('ALPACA_API_KEY', ''),
  alpacaSecretKey: getEnvVar('ALPACA_SECRET_KEY', ''),
  alpacaPaper: getEnvVarBoolean('ALPACA_PAPER', true),
  alpacaBaseUrl: getEnvVar('ALPACA_BASE_URL', 'https://paper-api.alpaca.markets'),
  polygonApiKey: getEnvVar('POLYGON_API_KEY', ''),
  polygonBaseUrl: getEnvVar('POLYGON_BASE_URL', 'https://api.massive.com'),
  polygonRateLimit: getEnvVarNumber('POLYGON_RATE_LIMIT', 5),
  polygonWsEnabled: getEnvVarBoolean('POLYGON_WS_ENABLED', false),
  twelveDataApiKey: getEnvVar('TWELVE_DATA_API_KEY', ''),
  marketDataApiKey:
    getEnvVar('MARKET_DATA_API_KEY', '') || getEnvVar('MARKETDATA_API_KEY', ''),
  unusualWhalesApiKey: getEnvVar('UNUSUAL_WHALES_API_KEY', ''),
  unusualWhalesGammaUrl: getEnvVar('UNUSUAL_WHALES_GAMMA_URL', ''),
  unusualWhalesOptionsEnabled: getEnvVarBoolean('UNUSUAL_WHALES_OPTIONS_ENABLED', true),

  // Performance
  slowRequestMs: getEnvVarNumber('SLOW_REQUEST_MS', 2000),
  cacheTtlSeconds: getEnvVarNumber('CACHE_TTL_SECONDS', 60),

  // Rate Limiting
  alpacaRateLimit: getEnvVarNumber('ALPACA_RATE_LIMIT', 200),
  twelveDataRateLimit: getEnvVarNumber('TWELVE_DATA_RATE_LIMIT', 800),
  unusualWhalesRateLimitPerMinute: getEnvVarNumber('UNUSUAL_WHALES_RATE_LIMIT_PER_MINUTE', 120),
  unusualWhalesRateLimitPerDay: getEnvVarNumber('UNUSUAL_WHALES_RATE_LIMIT_PER_DAY', 15000),

  // Worker Intervals
  signalProcessorInterval: getEnvVarNumber('SIGNAL_PROCESSOR_INTERVAL', 30000),
  orderCreatorInterval: getEnvVarNumber('ORDER_CREATOR_INTERVAL', 30000),
  paperExecutorInterval: getEnvVarNumber('PAPER_EXECUTOR_INTERVAL', 10000),
  paperExecutorBatchSize: getEnvVarNumber('PAPER_EXECUTOR_BATCH_SIZE', 10),
  positionRefresherInterval: getEnvVarNumber('POSITION_REFRESHER_INTERVAL', 60000),
  exitMonitorInterval: getEnvVarNumber('EXIT_MONITOR_INTERVAL', 60000),
  orchestratorIntervalMs: getEnvVarNumber('ORCHESTRATOR_INTERVAL_MS', 30000),
  orchestratorBatchSize: getEnvVarNumber('ORCHESTRATOR_BATCH_SIZE', 20),
  orchestratorConcurrency: getEnvVarNumber('ORCHESTRATOR_CONCURRENCY', 5),
  orchestratorSignalTimeoutMs: getEnvVarNumber('ORCHESTRATOR_SIGNAL_TIMEOUT_MS', 30000),
  orchestratorRetryDelayMs: getEnvVarNumber('ORCHESTRATOR_RETRY_DELAY_MS', 60000),
  processingQueueDepthAlert: getEnvVarNumber('PROCESSING_QUEUE_DEPTH_ALERT', 20),
  processingQueueDepthDurationSec: getEnvVarNumber('PROCESSING_QUEUE_DEPTH_DURATION_SEC', 300),

  // Risk Management
  maxPositionSize: getEnvVarNumber('MAX_POSITION_SIZE', 10),
  maxDailyLoss: getEnvVarNumber('MAX_DAILY_LOSS', 1000),
  maxOpenPositions: getEnvVarNumber('MAX_OPEN_POSITIONS', 5),
  maxExposurePercent: getEnvVarNumber('MAX_EXPOSURE_PERCENT', 20),
  allowPremarket: getEnvVarBoolean('ALLOW_PREMARKET', nodeEnv === 'test'),
  allowAfterhours: getEnvVarBoolean('ALLOW_AFTERHOURS', nodeEnv === 'test'),
  decisionOnlyWhenMarketClosed: getEnvVarBoolean('DECISION_ONLY_WHEN_MARKET_CLOSED', true),
  marketCloseGraceMinutes: getEnvVarNumber('MARKET_CLOSE_GRACE_MINUTES', 10),
  signalMaxAgeMinutes: getEnvVarNumber('SIGNAL_MAX_AGE_MINUTES', 30),
  maxDailyTrades: getEnvVarNumber('MAX_DAILY_TRADES', nodeEnv === 'test' ? 500 : 0),
  positionReplacementEnabled: getEnvVarBoolean(
    'POSITION_REPLACEMENT_ENABLED',
    nodeEnv === 'test'
  ),
  minConfidenceForReplacement: getEnvVarNumber('MIN_CONFIDENCE_FOR_REPLACEMENT', 70),
  autoCloseNearTarget: getEnvVarBoolean('AUTO_CLOSE_NEAR_TARGET', nodeEnv === 'test'),
  autoCloseNearTargetThresholdPct: getEnvVarNumber(
    'AUTO_CLOSE_NEAR_TARGET_THRESHOLD_PCT',
    80
  ),
  closeAgedPositions: getEnvVarBoolean('CLOSE_AGED_POSITIONS', nodeEnv === 'test'),
  closeAgedAfterHours: getEnvVarNumber('CLOSE_AGED_AFTER_HOURS', 2),
  closeAgedBelowPnlPercent: getEnvVarNumber('CLOSE_AGED_BELOW_PNL_PERCENT', 10),

  // Exit Rules
  profitTargetPct: getEnvVarNumber('PROFIT_TARGET_PCT', 50),
  stopLossPct: getEnvVarNumber('STOP_LOSS_PCT', 50),
  timeStopDte: getEnvVarNumber('TIME_STOP_DTE', 1),
  maxHoldDays: getEnvVarNumber('MAX_HOLD_DAYS', 5),
  enableExitDecisionEngine: getEnvVarBoolean('ENABLE_EXIT_DECISION_ENGINE', true),

  // Capacity Management
  minHoldMinutesForCapacityClose: getEnvVarNumber('MIN_HOLD_MINUTES_FOR_CAPACITY_CLOSE', 15),

  // A/B Testing
  abSplitPercentage: getEnvVarNumber('AB_SPLIT_PERCENTAGE', 0),
  enableVariantB: getEnvVarBoolean('ENABLE_VARIANT_B', false),

  // Feature Flags (Engine 2)
  enableOrbSpecialist: getEnvVarBoolean('ENABLE_ORB_SPECIALIST', false),
  enableStratSpecialist: getEnvVarBoolean('ENABLE_STRAT_SPECIALIST', false),
  enableTtmSpecialist: getEnvVarBoolean('ENABLE_TTM_SPECIALIST', false),
  enableSatylandSubagent: getEnvVarBoolean('ENABLE_SATYLAND_SUBAGENT', false),
  enableShadowExecution: getEnvVarBoolean('ENABLE_SHADOW_EXECUTION', false),

  // Orchestrator
  enableOrchestrator: getEnvVarBoolean('ENABLE_ORCHESTRATOR', true),
  enableDualPaperTrading: getEnvVarBoolean('ENABLE_DUAL_PAPER_TRADING', false),

  // Market webhook pipeline
  enableMarketWebhookPipeline: getEnvVarBoolean('ENABLE_MARKET_WEBHOOK_PIPELINE', true),

  // MTF Bias Processing System
  enableMTFBiasPipeline: getEnvVarBoolean('ENABLE_MTF_BIAS_PIPELINE', true),
  requireMTFBiasForEntry: getEnvVarBoolean(
    'REQUIRE_MTF_BIAS_FOR_ENTRY',
    nodeEnv !== 'test'
  ),

  // Confluence
  confluenceMinThreshold: getEnvVarNumber('CONFLUENCE_MIN_THRESHOLD', 50),
  enableConfluenceGate: getEnvVarBoolean('ENABLE_CONFLUENCE_GATE', true),
  enableConfluenceSizing: getEnvVarBoolean('ENABLE_CONFLUENCE_SIZING', true),
  basePositionSize: getEnvVarNumber('BASE_POSITION_SIZE', 1),

  // Alerts
  discordWebhookUrl: getEnvVar('DISCORD_WEBHOOK_URL', ''),
  slackWebhookUrl: getEnvVar('SLACK_WEBHOOK_URL', ''),
  alertsEnabled: getEnvVarBoolean('ALERTS_ENABLED', false),
  alertCooldownMinutes: getEnvVarNumber('ALERT_COOLDOWN_MINUTES', 30),

  enableUwFlowPoller: getEnvVarBoolean('ENABLE_UW_FLOW_POLLER', false),
  uwFlowPollerIntervalMs: getEnvVarNumber('UW_FLOW_POLLER_INTERVAL_MS', 120000),

  // Dealer strategy: UW gamma API (GammaDealerStrategy) | GEX/flow (DealerPositioningStrategy)
  enableDealerUwGamma: getEnvVarBooleanWithFallback(
    'ENABLE_DEALER_UW_GAMMA',
    'ENABLE_GAMMA_STRATEGY',
    false
  ),
  enableDealerGex: getEnvVarBooleanWithFallback(
    'ENABLE_DEALER_GEX',
    'ENABLE_DEALER_POSITIONING_STRATEGY',
    true
  ),
  dealerStrategyWeight: getEnvVarNumberWithFallback(
    'DEALER_STRATEGY_WEIGHT',
    'GAMMA_STRATEGY_WEIGHT',
    0.25
  ),
  dealerUwNeutralThreshold: getEnvVarNumberWithFallback(
    'DEALER_UW_NEUTRAL_THRESHOLD',
    'GAMMA_NEUTRAL_THRESHOLD',
    100_000_000
  ),

  // Logging
  logLevel: getEnvVar('LOG_LEVEL', 'info'),
};

// Validate critical configuration
export function validateConfig(): void {
  const errors: string[] = [];

  if (!config.databaseUrl) {
    errors.push('DATABASE_URL is required');
  }

  if (!config.jwtSecret || config.jwtSecret.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters');
  }

  if (config.nodeEnv === 'production' && !config.redisUrl) {
    errors.push('REDIS_URL is required in production');
  }

  if (config.appMode !== 'PAPER' && config.appMode !== 'LIVE') {
    errors.push('APP_MODE must be either PAPER or LIVE');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}
