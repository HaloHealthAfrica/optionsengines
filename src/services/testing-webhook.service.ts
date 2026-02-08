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
}): Record<string, any> {
  const direction = input.signalType === 'buy' ? 'long' : 'short';
  const timestamp = input.timestamp || new Date().toISOString();
  const indicators = input.indicators || generateIndicators(input.symbol, input.signalType);
  const price = input.price ?? generateRealisticPrice(input.symbol);

  return {
    symbol: input.symbol,
    timeframe: input.timeframe,
    direction,
    timestamp,
    price,
    indicators,
    is_test: input.isTest ?? true,
    test_session_id: input.testSessionId || undefined,
    test_scenario: input.testScenario || undefined,
    sequence_number: input.sequenceNumber || undefined,
    metadata: {
      is_test: input.isTest ?? true,
      test_session_id: input.testSessionId || undefined,
      test_scenario: input.testScenario || undefined,
      sequence_number: input.sequenceNumber || undefined,
      ...input.metadata,
    },
  };
}
