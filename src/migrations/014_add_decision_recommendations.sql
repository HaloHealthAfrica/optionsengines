-- Migration 014: Persist decision engine recommendations
-- Description: Store recommendation details and rationale per engine

CREATE TABLE IF NOT EXISTS decision_recommendations (
  recommendation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id UUID NOT NULL REFERENCES experiments(experiment_id) ON DELETE CASCADE,
  signal_id UUID NOT NULL REFERENCES signals(signal_id) ON DELETE CASCADE,
  engine VARCHAR(1) NOT NULL CHECK (engine IN ('A', 'B')),
  symbol VARCHAR(20) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('long', 'short')),
  timeframe VARCHAR(10) NOT NULL,
  strike DECIMAL(10, 2),
  expiration DATE,
  quantity INTEGER,
  entry_price DECIMAL(10, 4),
  is_shadow BOOLEAN DEFAULT FALSE,
  rationale JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(experiment_id, engine)
);

CREATE INDEX IF NOT EXISTS idx_decision_recommendations_experiment ON decision_recommendations(experiment_id);
CREATE INDEX IF NOT EXISTS idx_decision_recommendations_signal ON decision_recommendations(signal_id);
CREATE INDEX IF NOT EXISTS idx_decision_recommendations_engine ON decision_recommendations(engine);
