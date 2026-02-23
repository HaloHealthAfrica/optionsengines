-- Options Engine: Regime snapshots and psychological safety
-- Migration 054

CREATE TABLE IF NOT EXISTS oe_regime_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  underlying TEXT NOT NULL,
  computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  iv_percentile DECIMAL(8,5),
  iv_regime TEXT NOT NULL CHECK (iv_regime IN ('LOW', 'NEUTRAL', 'HIGH', 'UNKNOWN')),
  term_shape TEXT NOT NULL CHECK (term_shape IN ('CONTANGO', 'BACKWARDATION', 'FLAT', 'UNKNOWN')),
  confidence DECIMAL(5,4) NOT NULL DEFAULT 0,
  hysteresis_count INT NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'COMPUTED',
  UNIQUE(underlying, computed_at)
);

CREATE INDEX IF NOT EXISTS idx_oe_regime_underlying
  ON oe_regime_snapshots(underlying, computed_at DESC);

-- Psychological safety: losing streaks and pause events
CREATE TABLE IF NOT EXISTS oe_safety_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES oe_trading_accounts(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('LOSING_STREAK_PAUSE', 'IV_SPIKE_RESIZE', 'DRAWDOWN_TAPER', 'DRAWDOWN_FREEZE', 'MANUAL_PAUSE')),
  trigger_value TEXT NOT NULL,
  action_taken TEXT NOT NULL,
  size_multiplier DECIMAL(5,4),
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP,
  resolved_at TIMESTAMP,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_oe_safety_account
  ON oe_safety_events(account_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_oe_safety_active
  ON oe_safety_events(account_id) WHERE resolved_at IS NULL;
