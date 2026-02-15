// Core type definitions for the dual-engine options trading platform

export interface Signal {
  signal_id: string;
  symbol: string;
  direction: 'long' | 'short';
  timeframe: string;
  timestamp: Date;
  status: 'pending' | 'approved' | 'rejected';
  raw_payload?: Record<string, any>;
  queued_until?: Date | null;
  queued_at?: Date | null;
  queue_reason?: string | null;
  processing_attempts?: number;
  next_retry_at?: Date | null;
  created_at: Date;
}

export interface Order {
  order_id: string;
  signal_id: string;
  symbol: string;
  option_symbol: string;
  strike: number;
  expiration: Date;
  type: 'call' | 'put';
  quantity: number;
  order_type: 'paper' | 'live';
  status: 'pending_execution' | 'filled' | 'failed';
  created_at: Date;
}

export interface Trade {
  trade_id: string;
  order_id: string;
  fill_price: number;
  fill_quantity: number;
  fill_timestamp: Date;
  commission: number;
  created_at: Date;
}

export interface Position {
  position_id: string;
  symbol: string;
  option_symbol: string;
  strike: number;
  expiration: Date;
  type: 'call' | 'put';
  quantity: number;
  entry_price: number;
  current_price?: number;
  unrealized_pnl?: number;
  position_pnl_percent?: number;
  realized_pnl?: number;
  status: 'open' | 'closing' | 'closed';
  entry_timestamp: Date;
  exit_timestamp?: Date;
  exit_reason?: string;
  last_updated: Date;
}

export interface ExitRule {
  rule_id: string;
  rule_name: string;
  profit_target_percent?: number;
  stop_loss_percent?: number;
  max_hold_time_hours?: number;
  min_dte_exit?: number;
  enabled: boolean;
  created_at: Date;
}

export interface RiskLimit {
  limit_id: string;
  max_position_size?: number;
  max_total_exposure?: number;
  max_exposure_percent?: number;
  max_positions_per_symbol?: number;
  enabled: boolean;
  created_at: Date;
}

// Engine 2 Types

export interface Experiment {
  experiment_id: string;
  signal_id: string;
  variant: 'A' | 'B';
  assignment_hash: string;
  split_percentage: number;
  created_at: Date;
}

export interface AgentDecision {
  decision_id: string;
  experiment_id: string;
  signal_id: string;
  agent_name: string;
  agent_type: 'core' | 'specialist' | 'subagent';
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasons: string[];
  block: boolean;
  metadata?: Record<string, any>;
  created_at: Date;
}

export interface ShadowTrade {
  shadow_trade_id: string;
  experiment_id: string;
  signal_id: string;
  symbol: string;
  option_symbol: string;
  strike: number;
  expiration: Date;
  type: 'call' | 'put';
  quantity: number;
  entry_price: number;
  entry_timestamp: Date;
  contributing_agents: string[];
  meta_confidence: number;
  created_at: Date;
}

export interface ShadowPosition {
  shadow_position_id: string;
  shadow_trade_id: string;
  symbol: string;
  option_symbol: string;
  strike: number;
  expiration: Date;
  type: 'call' | 'put';
  quantity: number;
  entry_price: number;
  current_price?: number;
  unrealized_pnl?: number;
  realized_pnl?: number;
  status: 'open' | 'closing' | 'closed';
  entry_timestamp: Date;
  exit_timestamp?: Date;
  exit_reason?: string;
  last_updated: Date;
}

export interface FeatureFlag {
  flag_id: string;
  name: string;
  enabled: boolean;
  description?: string;
  updated_at: Date;
  updated_by?: string;
}

export interface AgentPerformance {
  performance_id: string;
  agent_name: string;
  total_signals: number;
  approved_signals: number;
  rejected_signals: number;
  avg_confidence: number;
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  expectancy: number;
  last_updated: Date;
}

// Market Data Types

export interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Indicators {
  ema8: number[];
  ema13: number[];
  ema21: number[];
  ema48: number[];
  ema200: number[];
  atr: number[];
  bollingerBands: {
    upper: number[];
    middle: number[];
    lower: number[];
  };
  keltnerChannels: {
    upper: number[];
    middle: number[];
    lower: number[];
  };
  ttmSqueeze: {
    state: 'on' | 'off';
    momentum: number;
  };
}

export interface GexStrikeLevel {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
  openInterestCall?: number;
  openInterestPut?: number;
  gammaCall?: number;
  gammaPut?: number;
}

export interface GexData {
  symbol: string;
  netGex: number;
  totalCallGex: number;
  totalPutGex: number;
  zeroGammaLevel?: number;
  dealerPosition: 'long_gamma' | 'short_gamma' | 'neutral';
  volatilityExpectation: 'compressed' | 'expanding' | 'neutral';
  updatedAt: Date;
  levels: GexStrikeLevel[];
}

export type GammaRegime = 'LONG_GAMMA' | 'SHORT_GAMMA' | 'NEUTRAL';
export type GammaExpectedBehavior = 'MEAN_REVERT' | 'EXPANSION';

export interface GammaByStrike {
  strike: number;
  netGamma: number;
}

export interface UnusualWhalesGammaSnapshot {
  symbol: string;
  netGamma: number;
  zeroGammaLevel?: number;
  gammaByStrike?: GammaByStrike[];
  timestamp: Date;
  source: 'unusualwhales';
}

export interface GammaRegimeInsight {
  regime: GammaRegime;
  zeroGammaLevel?: number;
  distanceToZeroGammaATR?: number;
  expectedBehavior: GammaExpectedBehavior;
}

export interface MarketIntelGammaContext {
  regime: GammaRegime;
  zeroGammaLevel?: number;
  distanceATR?: number;
  /** From GammaDealerStrategy when enabled */
  position_size_multiplier?: number;
}

export interface MarketIntelContext {
  gamma?: MarketIntelGammaContext;
}

export interface OptionsFlowEntry {
  optionSymbol: string;
  side: 'call' | 'put';
  strike: number;
  expiration: Date;
  volume: number;
  openInterest?: number;
  premium?: number;
  sentiment?: 'bullish' | 'bearish' | 'neutral';
  timestamp: Date;
}

export interface OptionsFlowSummary {
  symbol: string;
  entries: OptionsFlowEntry[];
  updatedAt: Date;
  /** Source of flow data: marketdata or unusualwhales */
  source?: 'marketdata' | 'unusualwhales';
  /** Debug: why this source was used (helps diagnose UW vs marketdata) */
  flowDebug?: string;
}

export interface MarketData {
  candles: Candle[];
  indicators: Indicators;
  currentPrice: number;
  sessionContext: SessionContext;
  gex?: GexData | null;
  optionsFlow?: OptionsFlowSummary | null;
  marketIntel?: MarketIntelContext;
  risk?: {
    positionLimitExceeded?: boolean;
    exposureExceeded?: boolean;
  };
}

export interface SessionContext {
  sessionType: 'RTH' | 'ETH';
  isMarketOpen: boolean;
  minutesUntilClose?: number;
}

// Agent Types

export interface AgentOutput {
  agent: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasons: string[];
  block: boolean;
  metadata?: Record<string, any>;
}

export interface EnrichedSignal {
  signalId: string;
  symbol: string;
  direction: 'long' | 'short';
  timeframe: string;
  timestamp: Date;
  sessionType: 'RTH' | 'ETH';
}

export interface MetaDecision {
  finalBias: 'bullish' | 'bearish' | 'neutral';
  finalConfidence: number;
  contributingAgents: string[];
  consensusStrength: number;
  decision: 'approve' | 'reject';
  reasons: string[];
}

// Configuration Types

export interface DatabaseConfig {
  connectionString: string;
  maxConnections: number;
}

export interface CacheConfig {
  ttl: number;
}

export interface RateLimiterConfig {
  alpacaLimit: number;
  twelveDataLimit: number;
  polygonLimit: number;
}

// ─── WebSocket Message Types (Gap 20 fix) ───────────────────────────────

/** Discriminated union of all WebSocket messages shared between server and frontend */
export type WSMessageType = 'position_update' | 'risk_update' | 'intel_update' | 'heartbeat' | 'error';

export interface WSPositionUpdate {
  type: 'position_update';
  data: {
    id: string;
    symbol: string;
    option_symbol: string;
    type: 'call' | 'put';
    strike: number;
    expiry: string | null;
    qty: number;
    entry_price: number | null;
    current_price: number | null;
    unrealized_pnl: number | null;
    realized_pnl: number | null;
    pnl_percent: number | null;
    status: 'open' | 'closing' | 'closed';
    entry_time: string | null;
    exit_time: string | null;
    updated_at: string | null;
  };
}

export interface WSRiskUpdate {
  type: 'risk_update';
  data: {
    timestamp: string;
    open_positions: number;
    max_open_positions: number;
    max_positions_per_symbol: number | null;
    max_position_size: number | null;
    max_total_exposure: number | null;
    max_exposure_percent: number | null;
    unrealized_pnl: number;
    realized_pnl: number;
  };
}

export interface WSIntelUpdate {
  type: 'intel_update';
  data: Record<string, unknown>;
  symbol?: string;
}

export interface WSHeartbeat {
  type: 'heartbeat';
  data: { timestamp: string };
}

export interface WSError {
  type: 'error';
  data: { message: string; code?: string };
}

export type WSMessage = WSPositionUpdate | WSRiskUpdate | WSIntelUpdate | WSHeartbeat | WSError;
