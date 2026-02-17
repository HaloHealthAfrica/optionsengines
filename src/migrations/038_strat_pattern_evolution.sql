-- Migration 038: Strat Pattern Evolution - Score history, derived fields, C2 range
-- Supports Tier 1 price check re-scoring and pattern evolution tracking

-- Add 'archived' and 'completed' to status if not present (alter check)
ALTER TABLE strat_alerts DROP CONSTRAINT IF EXISTS strat_alerts_status_check;
ALTER TABLE strat_alerts ADD CONSTRAINT strat_alerts_status_check CHECK (status IN (
  'watching', 'pending', 'triggered', 'expired', 'invalidated', 'archived', 'completed'
));

-- Score evolution columns
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS score_history JSONB DEFAULT '[]';
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS current_score INTEGER;
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS initial_score INTEGER;
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS score_delta INTEGER DEFAULT 0;
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS score_trend VARCHAR(15) DEFAULT 'stable';
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS peak_score INTEGER;
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS score_velocity DECIMAL(5,2) DEFAULT 0;
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS last_evaluated_at TIMESTAMPTZ;
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS last_full_scan_at TIMESTAMPTZ;

-- C2 range for integrity checking (C1 inside bar)
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS c2_high DECIMAL(10,2);
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS c2_low DECIMAL(10,2);
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS c1_high DECIMAL(10,2);
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS c1_low DECIMAL(10,2);

-- Component scores for factor-level tracking
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS pattern_quality_score INTEGER;
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS candle_shape_score INTEGER;
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS flow_alignment_score INTEGER;
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS tf_confluence_count INTEGER;

-- Trigger tracking
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS trigger_score INTEGER;
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS trigger_trend VARCHAR(15);

-- Integrity breach tracking
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS integrity_broken BOOLEAN DEFAULT FALSE;
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS integrity_broken_at TIMESTAMPTZ;
ALTER TABLE strat_alerts ADD COLUMN IF NOT EXISTS archived_reason VARCHAR(100);

-- Backfill: set current_score = score where null, initial_score = score
UPDATE strat_alerts SET current_score = score, initial_score = score
WHERE current_score IS NULL AND score IS NOT NULL;

-- Index for active alerts (Tier 1 query)
CREATE INDEX IF NOT EXISTS idx_strat_alerts_active_evolution
  ON strat_alerts(status, last_evaluated_at)
  WHERE status IN ('pending', 'triggered', 'watching');
