import crypto from 'crypto';

const BASE_PRICES: Record<string, number> = {
  SPY: 452.33,
  QQQ: 378.45,
  SPX: 4523.0,
  AAPL: 178.23,
  TSLA: 234.56,
  MSFT: 389.12,
};

export const TEST_SYMBOLS = Object.keys(BASE_PRICES);
export const TEST_TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
export const TEST_SIGNAL_TYPES = ['buy', 'sell'] as const;

export type TestSignalType = (typeof TEST_SIGNAL_TYPES)[number];
export type TestWebhookFormat =
  | 'ultimate_options'
  | 'trend_start'
  | 'dots_indicator'
  | 'market_context';

export function generateSignalId(): string {
  return crypto.randomUUID();
}

export function generateRealisticPrice(symbol: string, lastPrice?: number | null): number {
  const base = lastPrice ?? BASE_PRICES[symbol] ?? 100;
  const variance = (Math.random() - 0.5) * 0.01 * base;
  return Math.round((base + variance) * 100) / 100;
}

export function generateIndicators(symbol: string, signalType: TestSignalType): Record<string, number> {
  const price = generateRealisticPrice(symbol);
  return {
    rsi: signalType === 'buy' ? 55 + Math.random() * 20 : 25 + Math.random() * 20,
    macd: signalType === 'buy' ? 0.5 + Math.random() * 2 : -2.5 + Math.random() * 2,
    volume: Math.floor(10000000 + Math.random() * 20000000),
    bb_upper: price * 1.02,
    bb_lower: price * 0.98,
    ema_20: price * 0.995,
    ema_50: price * 0.99,
  };
}

function convertTimeframe(value: string): string {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return value;
  if (/^\d+$/.test(raw)) return raw;
  const match = raw.match(/^(\d+)\s*([mhdw])$/);
  if (!match) return value;
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) return value;
  if (unit === 'm') return String(amount);
  if (unit === 'h') return String(amount * 60);
  if (unit === 'd') return String(amount * 1440);
  if (unit === 'w') return String(amount * 10080);
  return value;
}

function pickExchange(symbol: string): string {
  if (symbol === 'SPX') return 'CBOE';
  return 'NASDAQ';
}

function clamp(num: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, num));
}

export function buildTestWebhookPayload(input: {
  symbol: string;
  timeframe: string;
  signalType: TestSignalType;
  price?: number;
  indicators?: Record<string, any>;
  timestamp?: string;
  testSessionId?: string | null;
  testScenario?: string | null;
  sequenceNumber?: number | null;
  isTest?: boolean;
  metadata?: Record<string, any>;
  format?: TestWebhookFormat;
}): Record<string, any> {
  if (input.format === 'trend_start') {
    return buildTrendStartPayload(input);
  }
  if (input.format === 'dots_indicator') {
    return buildDotsIndicatorPayload(input);
  }
  if (input.format === 'market_context') {
    return buildMarketContextPayload(input);
  }
  return buildUltimateOptionsPayload(input);
}

function buildUltimateOptionsPayload(input: {
  symbol: string;
  timeframe: string;
  signalType: TestSignalType;
  price?: number;
  indicators?: Record<string, any>;
  timestamp?: string;
  testSessionId?: string | null;
  testScenario?: string | null;
  sequenceNumber?: number | null;
  isTest?: boolean;
  metadata?: Record<string, any>;
}): Record<string, any> {
  const price = input.price ?? generateRealisticPrice(input.symbol);
  const exchange = pickExchange(input.symbol);
  const timeframe = convertTimeframe(input.timeframe);
  const signalType = input.signalType === 'buy' ? 'LONG' : 'SHORT';
  const trend = input.signalType === 'buy' ? 'BULLISH' : 'BEARISH';
  const now = input.timestamp ? new Date(input.timestamp) : new Date();
  const epochSeconds = Math.floor(now.getTime() / 1000);
  const quality = input.signalType === 'buy' ? 'HIGH' : 'MEDIUM';
  const aiScore = Math.round((5 + Math.random() * 3) * 10) / 10;
  const score = aiScore;
  const stopLoss = Math.round(price * 0.993 * 100) / 100;
  const target1 = Math.round(price * 1.012 * 100) / 100;
  const target2 = Math.round(price * 1.03 * 100) / 100;
  const indicators = input.indicators || generateIndicators(input.symbol, input.signalType);
  const rsi = indicators.rsi ?? Math.round((50 + Math.random() * 20) * 10) / 10;
  const ema8 = Math.round((price * 0.999) * 10) / 10;
  const ema21 = Math.round((price * 0.995) * 10) / 10;
  const ema50 = Math.round((price * 0.99) * 10) / 10;

  return {
    ticker: input.symbol,
    trend,
    score,
    exchange,
    timeframe,
    current_price: price,
    signal: {
      type: signalType,
      timeframe,
      quality,
      ai_score: aiScore,
      timestamp: epochSeconds,
      bar_time: now.toISOString(),
    },
    instrument: {
      exchange,
      ticker: input.symbol,
      current_price: price,
    },
    entry: {
      price,
      stop_loss: stopLoss,
      target_1: target1,
      target_2: target2,
      stop_reason: 'VWAP',
    },
    risk: {
      amount: 200,
      rr_ratio_t1: 2.0,
      rr_ratio_t2: 4.0,
      stop_distance_pct: Math.round(((price - stopLoss) / price) * 1000) / 10,
      recommended_shares: 50,
      recommended_contracts: 2,
      position_multiplier: 1.5,
      account_risk_pct: 2,
      max_loss_dollars: 200,
    },
    market_context: {
      vwap: Math.round((price * 0.997) * 100) / 100,
      pmh: Math.round((price * 1.01) * 100) / 100,
      pml: Math.round((price * 0.985) * 100) / 100,
      day_open: Math.round((price * 0.99) * 100) / 100,
      day_change_pct: Math.round((Math.random() * 1.5) * 10) / 10,
      price_vs_vwap_pct: Math.round((Math.random() * 0.5) * 10) / 10,
      distance_to_pmh_pct: Math.round((Math.random() * 1.2) * 10) / 10,
      distance_to_pml_pct: Math.round((Math.random() * 1.5) * 10) / 10,
      atr: Math.round((price * 0.006) * 10) / 10,
      volume_vs_avg: Math.round((1 + Math.random()) * 10) / 10,
      candle_direction: input.signalType === 'buy' ? 'GREEN' : 'RED',
      candle_size_atr: Math.round((1 + Math.random()) * 10) / 10,
    },
    trend_data: {
      ema_8: ema8,
      ema_21: ema21,
      ema_50: ema50,
      alignment: trend,
      strength: clamp(Math.round(50 + Math.random() * 40), 0, 100),
      rsi: Math.round(rsi),
      macd_signal: trend,
    },
    mtf_context: {
      '4h_bias': signalType,
      '4h_rsi': clamp(Math.round(50 + Math.random() * 20), 0, 100),
      '1h_bias': signalType,
    },
    score_breakdown: {
      strat: 2,
      trend: 1.5,
      gamma: 1,
      vwap: 1,
      mtf: 1.5,
      golf: 0.5,
    },
    components: ['MTF_ALIGN', 'STRAT_SETUP', 'PMH_BREAK', 'TREND_ALIGN'],
    time_context: {
      market_session: 'OPEN',
      day_of_week: now.toLocaleString('en-US', { weekday: 'long', timeZone: 'UTC' }).toUpperCase(),
    },
    metadata: {
      is_test: input.isTest ?? true,
      test_session_id: input.testSessionId || undefined,
      test_scenario: input.testScenario || undefined,
      sequence_number: input.sequenceNumber || undefined,
      ...input.metadata,
    },
  };
}

function buildTrendStartPayload(input: {
  symbol: string;
  timeframe: string;
  signalType: TestSignalType;
  price?: number;
  indicators?: Record<string, any>;
  timestamp?: string;
  testSessionId?: string | null;
  testScenario?: string | null;
  sequenceNumber?: number | null;
  isTest?: boolean;
  metadata?: Record<string, any>;
}): Record<string, any> {
  const price = input.price ?? generateRealisticPrice(input.symbol);
  const timeframe = convertTimeframe(input.timeframe);
  const side = input.signalType === 'buy' ? 'LONG' : 'SHORT';
  const trend = input.signalType === 'buy' ? 'BULL' : 'BEAR';
  const stop = Math.round(price * 0.993 * 100) / 100;
  const t1 = Math.round(price * 1.006 * 100) / 100;
  const t2 = Math.round(price * 1.012 * 100) / 100;

  return {
    side,
    confidence: Math.round(2 + Math.random() * 4),
    entry: price,
    stop,
    t1,
    t2,
    trend,
    mtf: {
      '5m': 1,
      '15m': 1,
      '1h': 1,
    },
    session: 'ACTIVE',
    atr: Math.round((price * 0.0063) * 100) / 100,
    symbol: input.symbol,
    timeframe,
    metadata: {
      is_test: input.isTest ?? true,
      test_session_id: input.testSessionId || undefined,
      test_scenario: input.testScenario || undefined,
      sequence_number: input.sequenceNumber || undefined,
      ...input.metadata,
    },
  };
}

function buildDotsIndicatorPayload(input: {
  symbol: string;
  timeframe: string;
  signalType: TestSignalType;
  price?: number;
  indicators?: Record<string, any>;
  timestamp?: string;
  testSessionId?: string | null;
  testScenario?: string | null;
  sequenceNumber?: number | null;
  isTest?: boolean;
  metadata?: Record<string, any>;
}): Record<string, any> {
  const price = input.price ?? generateRealisticPrice(input.symbol);
  const exchange = pickExchange(input.symbol);
  const trend = input.signalType === 'buy' ? 'BULLISH' : 'BEARISH';
  const now = input.timestamp ? new Date(input.timestamp) : new Date();
  const epochSeconds = Math.floor(now.getTime() / 1000);
  const timeframes = {
    '3m': { dir: trend.toLowerCase(), chg: true },
    '5m': { dir: trend.toLowerCase(), chg: true },
    '15m': { dir: trend.toLowerCase(), chg: false },
    '30m': { dir: 'neutral', chg: false },
    '1h': { dir: trend.toLowerCase(), chg: false },
    '4h': { dir: input.signalType === 'buy' ? 'bearish' : 'bullish', chg: false },
    '1w': { dir: trend.toLowerCase(), chg: false },
    '1M': { dir: trend.toLowerCase(), chg: false },
  };

  return {
    ticker: input.symbol,
    exchange,
    price,
    symbol: input.symbol,
    current_price: price,
    bias: trend,
    event: 'trend_change',
    trigger_timeframe: '3m,5m',
    timestamp: epochSeconds,
    alignment_score: Math.round(60 + Math.random() * 25),
    bullish_count: input.signalType === 'buy' ? 6 : 2,
    bearish_count: input.signalType === 'buy' ? 2 : 6,
    timeframes,
    meta: {
      version: '2.0',
      source: 'tradingview_indicator',
      indicator_name: 'Multi-Timeframe Trend Dots',
      bar_time: now.toISOString(),
    },
    metadata: {
      is_test: input.isTest ?? true,
      test_session_id: input.testSessionId || undefined,
      test_scenario: input.testScenario || undefined,
      sequence_number: input.sequenceNumber || undefined,
      ...input.metadata,
    },
  };
}

function buildMarketContextPayload(input: {
  symbol: string;
  timeframe: string;
  signalType: TestSignalType;
  price?: number;
  indicators?: Record<string, any>;
  timestamp?: string;
  testSessionId?: string | null;
  testScenario?: string | null;
  sequenceNumber?: number | null;
  isTest?: boolean;
  metadata?: Record<string, any>;
}): Record<string, any> {
  const price = input.price ?? generateRealisticPrice(input.symbol);
  const exchange = pickExchange(input.symbol);
  const timeframe = convertTimeframe(input.timeframe);
  const now = input.timestamp ? new Date(input.timestamp) : new Date();
  const epochSeconds = Math.floor(now.getTime() / 1000);

  return {
    ticker: input.symbol,
    exchange,
    price,
    timestamp: epochSeconds,
    type: 'CONTEXT',
    event: 'bar_close',
    timeframe,
    volatility: {
      vix: Math.round((15 + Math.random() * 8) * 10) / 10,
      vix_sma20: Math.round((16 + Math.random() * 6) * 10) / 10,
      vix_regime: 'LOW_VOL',
      vix_trend: 'FALLING',
      atr: Math.round((price * 0.006) * 100) / 100,
      atr_percentile: Math.round(30 + Math.random() * 40),
      bb_position: Math.round(40 + Math.random() * 40),
      vol_expansion_pct: Math.round((3 + Math.random() * 6) * 10) / 10,
    },
    levels: {
      pivot: Math.round((price * 0.994) * 100) / 100,
      r1: Math.round((price * 1.004) * 100) / 100,
      r2: Math.round((price * 1.014) * 100) / 100,
      r3: Math.round((price * 1.024) * 100) / 100,
      s1: Math.round((price * 0.986) * 100) / 100,
      s2: Math.round((price * 0.976) * 100) / 100,
      s3: Math.round((price * 0.966) * 100) / 100,
      nearest_resistance: Math.round((price * 1.004) * 100) / 100,
      nearest_support: Math.round((price * 0.986) * 100) / 100,
      dist_to_r1_pct: Math.round((Math.random() * 0.8) * 100) / 100,
      dist_to_s1_pct: Math.round((0.8 + Math.random() * 1.2) * 100) / 100,
      dist_to_nearest_res_pct: Math.round((Math.random() * 0.8) * 100) / 100,
      dist_to_nearest_sup_pct: Math.round((0.8 + Math.random() * 1.2) * 100) / 100,
      prior_day_high: Math.round((price * 1.008) * 100) / 100,
      prior_day_low: Math.round((price * 0.986) * 100) / 100,
      prior_day_close: Math.round((price * 0.994) * 100) / 100,
    },
    opening_range: {
      high: Math.round((price * 0.999) * 100) / 100,
      low: Math.round((price * 0.989) * 100) / 100,
      midpoint: Math.round((price * 0.994) * 100) / 100,
      range: Math.round((price * 0.01) * 100) / 100,
      breakout: 'ABOVE',
      complete: true,
    },
    market: {
      spy_price: price,
      spy_trend: input.signalType === 'buy' ? 'BULLISH' : 'BEARISH',
      spy_rsi: Math.round((50 + Math.random() * 20) * 10) / 10,
      spy_day_change_pct: Math.round((Math.random() * 1.2) * 100) / 100,
      qqq_price: Math.round((price * 0.85) * 100) / 100,
      qqq_trend: input.signalType === 'buy' ? 'BULLISH' : 'BEARISH',
      market_bias: input.signalType === 'buy' ? 'BULLISH' : 'BEARISH',
      moving_with_market: true,
      self_day_change_pct: Math.round((Math.random() * 1.2) * 100) / 100,
    },
    candle: {
      body_ratio: Math.round(50 + Math.random() * 30),
      wick_ratio: Math.round(20 + Math.random() * 40),
      close_position: Math.round(60 + Math.random() * 30),
      strength: Math.round(60 + Math.random() * 30),
      pattern: input.signalType === 'buy' ? 'BULL_ENGULF' : 'BEAR_ENGULF',
      pattern_bias: input.signalType === 'buy' ? 'BULLISH' : 'BEARISH',
      is_inside_bar: false,
      is_outside_bar: true,
    },
    session: {
      is_market_open: true,
      is_first_30min: false,
      ny_hour: now.getUTCHours(),
      ny_minute: now.getUTCMinutes(),
    },
    freshness: {
      bar_open_time: epochSeconds,
      server_time: epochSeconds,
    },
    metadata: {
      is_test: input.isTest ?? true,
      test_session_id: input.testSessionId || undefined,
      test_scenario: input.testScenario || undefined,
      sequence_number: input.sequenceNumber || undefined,
      ...input.metadata,
    },
  };
}
