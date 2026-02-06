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
  alpacaApiKey: string;
  alpacaSecretKey: string;
  alpacaPaper: boolean;
  alpacaBaseUrl: string;
  polygonApiKey: string;
  twelveDataApiKey: string;
  marketDataApiKey: string;

  // Performance
  slowRequestMs: number;
  cacheTtlSeconds: number;

  // Rate Limiting
  alpacaRateLimit: number;
  twelveDataRateLimit: number;

  // Worker Intervals
  signalProcessorInterval: number;
  orderCreatorInterval: number;
  paperExecutorInterval: number;
  positionRefresherInterval: number;
  exitMonitorInterval: number;

  // Risk Management
  maxPositionSize: number;
  maxDailyLoss: number;
  maxOpenPositions: number;
  maxExposurePercent: number;

  // Exit Rules
  profitTargetPct: number;
  stopLossPct: number;
  timeStopDte: number;
  maxHoldDays: number;

  // A/B Testing
  abSplitPercentage: number;
  enableVariantB: boolean;

  // Feature Flags (Engine 2)
  enableOrbSpecialist: boolean;
  enableStratSpecialist: boolean;
  enableTtmSpecialist: boolean;
  enableSatylandSubagent: boolean;
  enableShadowExecution: boolean;

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

export const config: Config = {
  // Server
  port: getEnvVarNumber('PORT', 8080),
  nodeEnv: getEnvVar('NODE_ENV', 'development'),
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
  alpacaApiKey: getEnvVar('ALPACA_API_KEY', ''),
  alpacaSecretKey: getEnvVar('ALPACA_SECRET_KEY', ''),
  alpacaPaper: getEnvVarBoolean('ALPACA_PAPER', true),
  alpacaBaseUrl: getEnvVar('ALPACA_BASE_URL', 'https://paper-api.alpaca.markets'),
  polygonApiKey: getEnvVar('POLYGON_API_KEY', ''),
  twelveDataApiKey: getEnvVar('TWELVE_DATA_API_KEY', ''),
  marketDataApiKey:
    getEnvVar('MARKET_DATA_API_KEY', '') || getEnvVar('MARKETDATA_API_KEY', ''),

  // Performance
  slowRequestMs: getEnvVarNumber('SLOW_REQUEST_MS', 2000),
  cacheTtlSeconds: getEnvVarNumber('CACHE_TTL_SECONDS', 60),

  // Rate Limiting
  alpacaRateLimit: getEnvVarNumber('ALPACA_RATE_LIMIT', 200),
  twelveDataRateLimit: getEnvVarNumber('TWELVE_DATA_RATE_LIMIT', 800),

  // Worker Intervals
  signalProcessorInterval: getEnvVarNumber('SIGNAL_PROCESSOR_INTERVAL', 30000),
  orderCreatorInterval: getEnvVarNumber('ORDER_CREATOR_INTERVAL', 30000),
  paperExecutorInterval: getEnvVarNumber('PAPER_EXECUTOR_INTERVAL', 10000),
  positionRefresherInterval: getEnvVarNumber('POSITION_REFRESHER_INTERVAL', 60000),
  exitMonitorInterval: getEnvVarNumber('EXIT_MONITOR_INTERVAL', 60000),

  // Risk Management
  maxPositionSize: getEnvVarNumber('MAX_POSITION_SIZE', 10),
  maxDailyLoss: getEnvVarNumber('MAX_DAILY_LOSS', 1000),
  maxOpenPositions: getEnvVarNumber('MAX_OPEN_POSITIONS', 5),
  maxExposurePercent: getEnvVarNumber('MAX_EXPOSURE_PERCENT', 20),

  // Exit Rules
  profitTargetPct: getEnvVarNumber('PROFIT_TARGET_PCT', 50),
  stopLossPct: getEnvVarNumber('STOP_LOSS_PCT', 50),
  timeStopDte: getEnvVarNumber('TIME_STOP_DTE', 1),
  maxHoldDays: getEnvVarNumber('MAX_HOLD_DAYS', 5),

  // A/B Testing
  abSplitPercentage: getEnvVarNumber('AB_SPLIT_PERCENTAGE', 0),
  enableVariantB: getEnvVarBoolean('ENABLE_VARIANT_B', false),

  // Feature Flags (Engine 2)
  enableOrbSpecialist: getEnvVarBoolean('ENABLE_ORB_SPECIALIST', false),
  enableStratSpecialist: getEnvVarBoolean('ENABLE_STRAT_SPECIALIST', false),
  enableTtmSpecialist: getEnvVarBoolean('ENABLE_TTM_SPECIALIST', false),
  enableSatylandSubagent: getEnvVarBoolean('ENABLE_SATYLAND_SUBAGENT', false),
  enableShadowExecution: getEnvVarBoolean('ENABLE_SHADOW_EXECUTION', false),

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

  if (config.appMode !== 'PAPER' && config.appMode !== 'LIVE') {
    errors.push('APP_MODE must be either PAPER or LIVE');
  }

  if (errors.length > 0) {
    throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
  }
}
