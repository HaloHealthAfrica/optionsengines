-- Options Engine: Historical snapshots for replay + replay drift log
-- Migration 056

-- Historical market data snapshots for deterministic replay
CREATE TABLE IF NOT EXISTS oe_historical_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  underlying TEXT NOT NULL,
  option_ticker TEXT NOT NULL,
  snapshot_type TEXT NOT NULL,
  bid DECIMAL(10,4),
  ask DECIMAL(10,4),
  iv DECIMAL(8,5),
  delta DECIMAL(8,5),
  gamma DECIMAL(8,5),
  vega DECIMAL(8,5),
  volume INT,
  oi INT,
  underlying_price DECIMAL(10,4),
  recorded_at TIMESTAMP NOT NULL,
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oe_historical_snap_ticker
  ON oe_historical_snapshots(option_ticker, recorded_at);
CREATE INDEX IF NOT EXISTS idx_oe_historical_snap_underlying
  ON oe_historical_snapshots(underlying, recorded_at);

-- Replay drift log: records divergences between replay and live
CREATE TABLE IF NOT EXISTS oe_replay_drift_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  replay_trace_id TEXT NOT NULL,
  original_trace_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  field TEXT NOT NULL,
  original_value TEXT,
  replay_value TEXT,
  drift_magnitude DECIMAL(14,6),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oe_replay_drift_original
  ON oe_replay_drift_log(original_trace_id);
CREATE INDEX IF NOT EXISTS idx_oe_replay_drift_replay
  ON oe_replay_drift_log(replay_trace_id);
