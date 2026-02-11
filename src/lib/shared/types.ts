export type SetupType = 'SCALP_GUARDED' | 'SWING' | 'POSITION' | 'LEAPS';

export type RegimeType =
  | 'STRONG_BULL'
  | 'BULL'
  | 'NEUTRAL'
  | 'BEAR'
  | 'STRONG_BEAR'
  | 'CHOPPY'
  | 'BREAKOUT'
  | 'BREAKDOWN';

export type GEXState =
  | 'POSITIVE_HIGH'
  | 'POSITIVE_LOW'
  | 'NEUTRAL'
  | 'NEGATIVE_LOW'
  | 'NEGATIVE_HIGH';

export type LiquidityState = 'HIGH' | 'NORMAL' | 'LOW' | 'ILLIQUID';

export type SessionType =
  | 'PRE_MARKET'
  | 'OPEN'
  | 'MORNING'
  | 'LUNCH'
  | 'AFTERNOON'
  | 'CLOSE'
  | 'AFTER_HOURS';

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface EventRisk {
  type: 'EARNINGS' | 'FOMC' | 'OPEX' | 'DIVIDEND' | 'ECONOMIC_DATA';
  date: string;
  daysUntil: number;
}

export interface RuleResult {
  tier: 1 | 2 | 3 | 4;
  rule: string;
  triggered: boolean;
  message: string;
  severity?: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface ProgressCheck {
  atMinute: number;
  minProfitPercent: number;
}

export interface Guardrails {
  maxHoldTime: number;
  timeStops: number[];
  progressChecks: ProgressCheck[];
  thetaBurnLimit: number;
  invalidationLevels: {
    stopLoss: number;
    thesisInvalidation: number;
  };
}

export interface ValidationError {
  type: 'VALIDATION_ERROR';
  field: string;
  message: string;
  received?: unknown;
}

export interface ErrorResponse {
  success: false;
  errors: ValidationError[];
  timestamp: number;
}
