/**
 * Strat Cron Types - Score evolution, snapshots, weights
 */

export interface ScoreSnapshot {
  timestamp: string;
  score: number;
  price: number;
  factors: {
    proximity: number;
    integrity: number;
    timeDecay: number;
    confluence: number;
    rvol: number;
    patternQuality: number;
    candleShape: number;
    flowAlignment: number;
  };
  trigger: 'tier1' | 'tier2' | 'manual';
}

export interface ScoringWeights {
  proximity?: number;
  integrity?: number;
  timeDecay?: number;
  tfConfluence?: number;
  rvol?: number;
  patternQuality?: number;
  candleShape?: number;
  flowAlignment?: number;
}

export interface StratAlertRow {
  alert_id: string;
  symbol: string;
  direction: string;
  timeframe: string;
  setup: string;
  entry: string | number;
  target: string | number;
  stop: string | number;
  score: number;
  current_score: number | null;
  initial_score: number | null;
  score_trend: string | null;
  peak_score: number | null;
  score_history: ScoreSnapshot[] | null;
  c1_type: string | null;
  c2_type: string | null;
  c1_high: number | null;
  c1_low: number | null;
  c2_high: number | null;
  c2_low: number | null;
  tf_confluence: Record<string, unknown> | null;
  tf_confluence_count: number | null;
  rvol: string | null;
  pattern_quality_score: number | null;
  candle_shape_score: number | null;
  flow_alignment_score: number | null;
  flow_sentiment: string | null;
  status: string;
  created_at: Date | string;
  expires_at: Date | string | null;
}
