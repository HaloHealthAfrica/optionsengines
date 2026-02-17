-- Migration 037: Strat Feedback Loop - Outcome tracking, analytics, scoring tuner
-- Alert outcomes, scoring weight history, pattern filters, symbol strat scores, strat insights

-- alert_outcomes: Track what actually happened to every alert (target hit, stop hit, expired, etc.)
CREATE TABLE IF NOT EXISTS alert_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id UUID NOT NULL REFERENCES strat_alerts(alert_id) ON DELETE CASCADE,
  symbol VARCHAR(10) NOT NULL,
  direction VARCHAR(5) NOT NULL,
  timeframe VARCHAR(5) NOT NULL,
  setup_type VARCHAR(30) NOT NULL,
  score_at_creation INTEGER,
  entry_price DECIMAL(12, 4),
  target_price DECIMAL(12, 4),
  stop_price DECIMAL(12, 4),
  predicted_rr DECIMAL(5, 2),
  did_trigger BOOLEAN DEFAULT false,
  did_hit_target BOOLEAN DEFAULT false,
  did_hit_stop BOOLEAN DEFAULT false,
  max_favorable_excursion DECIMAL(12, 4),
  max_adverse_excursion DECIMAL(12, 4),
  actual_rr DECIMAL(5, 2),
  outcome VARCHAR(20) NOT NULL,
  exit_price DECIMAL(12, 4),
  time_to_trigger_minutes INTEGER,
  time_to_outcome_minutes INTEGER,
  flow_sentiment VARCHAR(10),
  unusual_activity BOOLEAN,
  rvol VARCHAR(10),
  tf_confluence_count INTEGER,
  c1_shape VARCHAR(30),
  market_context JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alert_outcomes_alert ON alert_outcomes(alert_id);
CREATE INDEX IF NOT EXISTS idx_alert_outcomes_symbol ON alert_outcomes(symbol);
CREATE INDEX IF NOT EXISTS idx_alert_outcomes_setup ON alert_outcomes(setup_type);
CREATE INDEX IF NOT EXISTS idx_alert_outcomes_timeframe ON alert_outcomes(timeframe);
CREATE INDEX IF NOT EXISTS idx_alert_outcomes_outcome ON alert_outcomes(outcome);
CREATE INDEX IF NOT EXISTS idx_alert_outcomes_created ON alert_outcomes(created_at DESC);

COMMENT ON TABLE alert_outcomes IS 'Outcome of every strat alert for feedback loop analytics';

-- Add outcome tracking columns to strat_alerts
ALTER TABLE strat_alerts
  ADD COLUMN IF NOT EXISTS max_favorable_excursion DECIMAL(12, 4),
  ADD COLUMN IF NOT EXISTS max_adverse_excursion DECIMAL(12, 4),
  ADD COLUMN IF NOT EXISTS outcome VARCHAR(20),
  ADD COLUMN IF NOT EXISTS outcome_recorded_at TIMESTAMPTZ;

-- Add plan outcome columns to strat_plans (for position close tracking)
ALTER TABLE strat_plans
  ADD COLUMN IF NOT EXISTS exit_price DECIMAL(12, 4),
  ADD COLUMN IF NOT EXISTS r_multiple_achieved DECIMAL(10, 4),
  ADD COLUMN IF NOT EXISTS hold_duration_minutes INTEGER;

-- scoring_weight_history: Track when scoring weights were tuned
CREATE TABLE IF NOT EXISTS scoring_weight_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  previous_weights JSONB,
  new_weights JSONB,
  sample_size INTEGER,
  factors_analysis JSONB,
  tuned_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scoring_weight_history_tuned ON scoring_weight_history(tuned_at DESC);

-- pattern_filters: Suppress/boost patterns based on performance
CREATE TABLE IF NOT EXISTS pattern_filters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern VARCHAR(30) NOT NULL UNIQUE,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'suppressed', 'boosted')),
  boost_amount INTEGER DEFAULT 0,
  reason TEXT,
  sample_size INTEGER,
  win_rate DECIMAL(5, 4),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pattern_filters_status ON pattern_filters(status);

-- symbol_strat_scores: Strat-friendliness per symbol
CREATE TABLE IF NOT EXISTS symbol_strat_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(10) NOT NULL UNIQUE,
  strat_friendliness DECIMAL(5, 2),
  best_pattern VARCHAR(30),
  best_timeframe VARCHAR(5),
  sample_size INTEGER,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symbol_strat_scores_symbol ON symbol_strat_scores(symbol);

-- strat_insights: Cached insights (rules-based or LLM-generated)
CREATE TABLE IF NOT EXISTS strat_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20), -- positive, warning, info
  category VARCHAR(20), -- pattern, scoring, flow, confluence, timing, symbol
  title TEXT,
  description TEXT,
  impact VARCHAR(10), -- high, medium, low
  actionable BOOLEAN DEFAULT false,
  action TEXT,
  applied BOOLEAN DEFAULT false,
  generated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strat_insights_generated ON strat_insights(generated_at DESC);

-- strat_scoring_weights: Current weights for scanner (tuned by feedback loop)
CREATE TABLE IF NOT EXISTS strat_scoring_weights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  weights JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed initial weights if empty
INSERT INTO strat_scoring_weights (weights)
SELECT '{"patternQuality":0.25,"riskReward":0.2,"tfConfluence":0.2,"rvol":0.15,"candleShape":0.1,"atrContext":0.1}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM strat_scoring_weights LIMIT 1);
