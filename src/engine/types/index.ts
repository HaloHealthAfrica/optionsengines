export * from './enums.js';
export * from './errors.js';

import type {
  SystemState,
  PositionState,
  LedgerTransactionType,
  TradeStructure,
  TradeDirection,
  OptionRight,
  LegRole,
  GreekSource,
  LatencyMode,
  FillStatus,
  GovernorDecision,
  IVRegime,
  TermShape,
  RejectionCode,
  SystemStateTransitionTrigger,
} from './enums.js';

// ─── TradeIntent (produced by Decision Engines) ───

export interface TradeIntent {
  underlying: string;
  structure: TradeStructure;
  direction: TradeDirection;
  targetDTE: number;
  dteTolerance: number;
  targetDelta: number;
  deltaTolerance: number;
  maxRiskPerTrade: number;
  confidenceScore: number;
  strategyTag: string;
  accountId: string;
  signalId: string;
}

// ─── TradePlan (produced by OptionsConstructionEngine) ───

export interface TradePlan {
  tradePlanId: string;
  accountId: string;
  strategyTag: string;
  structure: TradeStructure;
  underlying: string;
  contracts: number;
  legs: TradePlanLeg[];
  entryModel: EntryModel;
  exitModel: ExitModel;
  riskModel: RiskModel;
  liquidityModel: LiquidityModel;
  marketContext: MarketContext;
  constructionVersion: string;
  constructionLatencyMs: number;
  createdAt: Date;
}

export interface TradePlanLeg {
  legRole: LegRole;
  optionTicker: string;
  expiration: string;
  strike: number;
  option_right: OptionRight;
  dte: number;
  delta: number;
  gamma: number;
  vega: number;
  iv: number;
  greekSource: GreekSource;
  bid: number;
  ask: number;
  mid: number;
  volume: number;
  oi: number;
  spreadWidth: number;
  spreadWidthPct: number;
  liquidityScore: number;
  sanityCheckPassed: boolean;
  quoteTimestamp: Date;
}

export interface EntryModel {
  expectedPrice: number;
  limitPrice: number;
  maxRepricingAttempts: number;
  repriceIntervalSeconds: number;
}

export interface ExitModel {
  profitTargetPct: number;
  stopLossPct: number;
  maxHoldDays: number;
}

export interface RiskModel {
  maxLossPerContract: number;
  maxLossTotal: number;
  creditPerSpread: number;
  spreadWidthDollars: number;
}

export interface LiquidityModel {
  liquidityScore: number;
  spreadWidthPct: number;
  volumeNorm: number;
  oiNorm: number;
}

export interface MarketContext {
  underlyingPrice: number;
  ivPercentile: number | null;
  ivRegime: IVRegime;
  termShape: TermShape;
  underlyingVolume: number;
  avgVolume30D: number;
}

// ─── OptionCandidate (internal to construction engine) ───

export interface OptionCandidate {
  optionTicker: string;
  expiration: string;
  strike: number;
  option_right: OptionRight;
  dte: number;
  delta: number | null;
  gamma: number | null;
  vega: number | null;
  iv: number | null;
  greekSource: GreekSource;
  bid: number;
  ask: number;
  mid: number;
  volume: number;
  oi: number;
  spreadWidth: number;
  spreadWidthPct: number;
  liquidityScore: number;
  quoteTimestamp: Date;
  deltaScore: number;
  dteScore: number;
  ivContextScore: number;
  totalScore: number;
  sanityCheckPassed: boolean;
}

// ─── Governor Result ───

export interface GovernorResult {
  decision: GovernorDecision;
  reasonCodes: string[];
  sizeMultiplier: number;
  netDeltaDollars: number;
  netGamma: number;
  projectedShockLoss: number;
  underlyingLiquidityRatio: number;
}

// ─── Capital / Ledger ───

export interface TradingAccount {
  id: string;
  name: string;
  initialCapital: number;
  currentCash: number;
  reservedCapital: number;
  realizedPnL: number;
  unrealizedPnL: number;
  totalEquity: number;
  maxDailyLoss: number;
  maxPortfolioRisk: number;
  peakEquity: number;
  intradayRealizedPnL: number;
  intradayStartEquity: number;
  entryFrozen: boolean;
  brokerSyncWarning: boolean;
  brokerSyncFrozen: boolean;
  brokerSyncedAt: Date | null;
  createdAt: Date;
}

export interface LedgerTransaction {
  id: string;
  accountId: string;
  type: LedgerTransactionType;
  amount: number;
  referenceId: string;
  balanceBefore: number;
  balanceAfter: number;
  notes: string;
  timestamp: Date;
  idempotencyKey: string;
}

export interface CapitalReservationResult {
  success: boolean;
  reservationId: string;
  reservedAmount: number;
  availableAfter: number;
  ledgerTransactionId: string;
}

export interface CapitalValidationResult {
  sufficient: boolean;
  available: number;
  required: number;
  currentCash: number;
  reservedCapital: number;
}

// ─── Position ───

export interface Position {
  positionId: string;
  accountId: string;
  tradePlanId: string;
  underlying: string;
  structure: TradeStructure;
  strategyTag: string;
  state: PositionState;
  entryOrderId: string | null;
  exitOrderId: string | null;
  entryFilledQty: number;
  exitFilledQty: number;
  targetQty: number;
  entryAvgPrice: number | null;
  exitAvgPrice: number | null;
  unrealizedPnL: number;
  realizedPnL: number | null;
  version: number;
  openedAt: Date;
  closedAt: Date | null;
  forceCloseReason: string | null;
  idempotencyKey: string;
}

// ─── Slippage Audit ───

export interface SlippageAuditRecord {
  id: string;
  tradeId: string;
  accountId: string;
  positionId: string;
  optionTicker: string;
  expectedPrice: number;
  submittedLimitPrice: number;
  fillPrice: number | null;
  slippageDollars: number;
  slippagePct: number;
  spreadWidthPctAtSubmit: number;
  liquidityScoreAtSubmit: number;
  underlyingPriceAtSubmit: number;
  secondsToFill: number | null;
  repriceCount: number;
  fillStatus: FillStatus;
  createdAt: Date;
  idempotencyKey: string;
}

// ─── Regime ───

export interface RegimeSnapshot {
  id: string;
  underlying: string;
  computedAt: Date;
  ivPercentile: number | null;
  ivRegime: IVRegime;
  termShape: TermShape;
  confidence: number;
  hysteresisCount: number;
  source: string;
}

// ─── DecisionTrace ───

export interface DecisionTrace {
  decisionTraceId: string;
  accountId: string;
  signalId: string;
  isReplay: boolean;
  latencyMode: LatencyMode;
  systemStateAtDecision: SystemState;
  tradeIntentSnapshot: Record<string, unknown> | null;
  sanityValidationResult: Record<string, unknown> | null;
  constructionResult: Record<string, unknown> | null;
  candidatesScoredTop5: Record<string, unknown> | null;
  governorResult: Record<string, unknown> | null;
  capitalValidation: Record<string, unknown> | null;
  bucketValidation: Record<string, unknown> | null;
  policyGateResult: Record<string, unknown> | null;
  latencyBudgetResult: Record<string, unknown> | null;
  positionStateTransition: Record<string, unknown> | null;
  finalOrders: Record<string, unknown> | null;
  fills: Record<string, unknown> | null;
  slippageAuditIds: string[];
  pnlOutcome: number | null;
  regimeAtDecision: Record<string, unknown> | null;
  underlyingLiquidityRatio: number | null;
  createdAt: Date;
  closedAt: Date | null;
}

// ─── System State ───

export interface SystemStateRecord {
  id: string;
  state: SystemState;
  updatedAt: Date;
  updatedBy: string;
}

export interface SystemStateLogEntry {
  id: string;
  fromState: SystemState;
  toState: SystemState;
  trigger: SystemStateTransitionTrigger;
  triggeredBy: string;
  reason: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}

// ─── Latency Budget ───

export interface LatencyBudgetResult {
  latencyMode: LatencyMode;
  stageDurations: Record<string, number>;
  totalElapsedMs: number;
  budgetMs: number;
  passed: boolean;
}

// ─── Construction Rejection ───

export interface ConstructionRejection {
  rejectionCodes: RejectionCode[];
  candidateCounts: CandidateCounts;
  constructionLatencyMs: number;
  underlyingPrice: number;
  timestamp: Date;
}

export interface CandidateCounts {
  afterDTE: number;
  afterDelta: number;
  afterLiquidity: number;
  afterSanity: number;
  afterScoring: number;
  afterRevalidation: number;
}

// ─── Historical Snapshot (for replay) ───

export interface HistoricalSnapshot {
  id: string;
  underlying: string;
  optionTicker: string;
  snapshotType: string;
  bid: number;
  ask: number;
  iv: number;
  delta: number;
  gamma: number;
  volume: number;
  oi: number;
  recordedAt: Date;
  source: string;
}
