-- Migration 022: MTF Bias Processing System - Core tables
-- Schema v1: Locked. No drift without versioning.

-- symbol_market_state: source of truth per symbol (MTF bias state)
CREATE TABLE IF NOT EXISTS symbol_market_state (
  symbol VARCHAR(20) PRIMARY KEY,
  last_event_id VARCHAR(64) NOT NULL,
  bias_consensus VARCHAR(20) NOT NULL,
  bias_score DECIMAL(5,4) NOT NULL,
  confidence_score DECIMAL(5,4) NOT NULL,
  alignment_score DECIMAL(5,4) NOT NULL,
  conflict_score DECIMAL(5,4) NOT NULL,
  regime_type VARCHAR(30) NOT NULL,
  chop_score DECIMAL(5,2) NOT NULL,
  vol_state VARCHAR(30) NOT NULL DEFAULT 'UNKNOWN',
  entry_mode_hint VARCHAR(30) NOT NULL,
  invalidation_level DECIMAL(12,4),
  resolved_bias VARCHAR(20),
  resolved_confidence DECIMAL(5,4),
  resolved_source VARCHAR(50),
  resolution_trace JSONB,
  full_mtf_json JSONB NOT NULL,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symbol_market_state_last_updated
  ON symbol_market_state(last_updated_at DESC);

COMMENT ON TABLE symbol_market_state IS 'MTF bias state per symbol - source of truth for market direction';

-- market_state_history: audit trail of state snapshots
CREATE TABLE IF NOT EXISTS market_state_history (
  id BIGSERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  event_id VARCHAR(64) NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_state_history_symbol_created
  ON market_state_history(symbol, created_at DESC);

COMMENT ON TABLE market_state_history IS 'Historical MTF bias snapshots for audit and replay';

-- mtf_bias_events: raw webhook events (idempotency)
CREATE TABLE IF NOT EXISTS mtf_bias_events (
  event_id VARCHAR(64) PRIMARY KEY,
  event_id_raw TEXT NOT NULL,
  symbol VARCHAR(20) NOT NULL,
  schema_version VARCHAR(10) NOT NULL DEFAULT '1',
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mtf_bias_events_symbol ON mtf_bias_events(symbol);
CREATE INDEX IF NOT EXISTS idx_mtf_bias_events_created ON mtf_bias_events(created_at DESC);

COMMENT ON TABLE mtf_bias_events IS 'MTF bias webhook events - idempotency and audit';
