-- Migration 023: MTF Bias - Trade lifecycle and performance feedback

-- Add MTF bias fields to refactored_positions for exit agent and feedback
ALTER TABLE refactored_positions ADD COLUMN IF NOT EXISTS entry_bias_score DECIMAL(5,4);
ALTER TABLE refactored_positions ADD COLUMN IF NOT EXISTS entry_confidence_score DECIMAL(5,4);
ALTER TABLE refactored_positions ADD COLUMN IF NOT EXISTS entry_regime_type VARCHAR(30);
ALTER TABLE refactored_positions ADD COLUMN IF NOT EXISTS entry_mode_hint VARCHAR(30);
ALTER TABLE refactored_positions ADD COLUMN IF NOT EXISTS exit_type VARCHAR(30);
ALTER TABLE refactored_positions ADD COLUMN IF NOT EXISTS r_multiple DECIMAL(10,4);

-- performance_feedback: rolling stats for setup thresholds and risk multiplier
CREATE TABLE IF NOT EXISTS performance_feedback (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(20),
  regime_type VARCHAR(30),
  confidence_band VARCHAR(20),
  entry_mode_hint VARCHAR(30),
  win_count INTEGER DEFAULT 0,
  loss_count INTEGER DEFAULT 0,
  avg_r_multiple DECIMAL(10,4),
  sample_size INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_performance_feedback_regime ON performance_feedback(regime_type);
CREATE INDEX IF NOT EXISTS idx_performance_feedback_updated ON performance_feedback(updated_at DESC);

COMMENT ON TABLE performance_feedback IS 'Rolling win rate and R-multiple stats by regime, confidence, entry mode';
