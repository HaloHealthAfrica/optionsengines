/**
 * Types for synthetic data generation
 * 
 * These types define the structure of test data used for validation.
 */

/**
 * Subscription tier levels
 */
export type SubscriptionTier = 'FREE' | 'BASIC' | 'PREMIUM' | 'ENTERPRISE';

/**
 * Trade direction
 */
export type Direction = 'LONG' | 'SHORT';

/**
 * Market regime classification
 */
export type MarketRegime = 'BULLISH' | 'BEARISH' | 'NEUTRAL' | 'VOLATILE';

/**
 * Volatility levels
 */
export type VolatilityLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';

/**
 * Liquidity levels
 */
export type LiquidityLevel = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Edge case scenarios for testing
 */
export enum EdgeCaseScenario {
  EXTREME_VOLATILITY = 'EXTREME_VOLATILITY',
  LOW_LIQUIDITY = 'LOW_LIQUIDITY',
  CONFLICTING_SIGNALS = 'CONFLICTING_SIGNALS',
  MARKET_CLOSED = 'MARKET_CLOSED',
  DUPLICATE_WEBHOOK = 'DUPLICATE_WEBHOOK',
  MALFORMED_PAYLOAD = 'MALFORMED_PAYLOAD',
  MISSING_FIELDS = 'MISSING_FIELDS',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
}

/**
 * Parameters for webhook generation
 */
export interface WebhookParams {
  strategy: string;
  timeframe: string;
  direction: Direction;
  confidence?: number;
  includeSignature?: boolean;
  malformed?: boolean;
}

/**
 * Generated webhook payload
 */
export interface WebhookPayload {
  strategy: string;
  timeframe: string;
  direction: Direction;
  confidence: number;
  timestamp: Date;
  signature?: string;
  metadata: Record<string, any>;
}

/**
 * Parameters for market context generation
 */
export interface MarketParams {
  volatility: VolatilityLevel;
  liquidity: LiquidityLevel;
  gexLevel: number;
  marketHours: boolean;
}

/**
 * Generated market context
 */
export interface MarketContext {
  gexLevel: number;
  volatilityIndex: number;
  liquidityScore: number;
  marketRegime: MarketRegime;
  marketHours: boolean;
  timestamp: Date;
}

/**
 * Generated user profile
 */
export interface UserProfile {
  userId: string;
  subscriptionTier: SubscriptionTier;
  signalQuota: number;
  signalsUsed: number;
  engineAssignment: 'A' | 'B';
  active: boolean;
}

/**
 * Option Greeks
 */
export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
}

/**
 * Parameters for position generation
 */
export interface PositionParams {
  symbol: string;
  direction: Direction;
  daysToExpiration: number;
}

/**
 * Generated position
 */
export interface Position {
  positionId: string;
  symbol: string;
  strike: number;
  expiration: Date;
  direction: Direction;
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  greeks: Greeks;
  pnl: number;
}

/**
 * Parameters for time series generation
 */
export interface TimeSeriesParams {
  startDate: Date;
  endDate: Date;
  interval: 'minute' | 'hour' | 'day';
  includeAfterHours: boolean;
  includeWeekends: boolean;
}

/**
 * Generated time series data point
 */
export interface TimeSeriesDataPoint {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  marketHours: boolean;
}

/**
 * Generated time series data
 */
export interface TimeSeriesData {
  symbol: string;
  dataPoints: TimeSeriesDataPoint[];
}

/**
 * Test scenario
 */
export interface TestScenario {
  scenarioId: string;
  name: string;
  description: string;
  category: string;
  testData: any;
  expectedOutcome: any;
  edgeCase: boolean;
}

/**
 * Decision output (simplified for validation)
 */
export interface Decision {
  action: 'APPROVE' | 'REJECT' | 'DELAY' | 'NO_ACTION';
  confidence: number;
  reason: string;
}

/**
 * Strike recommendation (simplified for validation)
 */
export interface Strike {
  strikePrice: number;
  expiration: Date;
  greeks: Greeks;
  score: number;
}

/**
 * End-to-end test scenario
 */
export interface EndToEndScenario {
  webhook: WebhookPayload;
  marketContext: MarketContext;
  user: UserProfile;
  expectedDecision: Decision;
  expectedStrike?: Strike;
  expectedDelivery: boolean;
  maxLatency: number;
}
