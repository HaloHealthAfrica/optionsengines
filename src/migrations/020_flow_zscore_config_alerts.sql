-- Migration 020: Flow Z-Score, Config UI, Alert History
-- Phase 6: Add netflow column for z-score computation
-- Phase 8: flow_config table for editable config
-- Phase 9: flow_alerts table for alert history

-- Phase 6: netflow column for options_flow_snapshots
ALTER TABLE options_flow_snapshots
  ADD COLUMN IF NOT EXISTS call_premium DECIMAL(18, 4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS put_premium DECIMAL(18, 4) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS netflow DECIMAL(18, 4) DEFAULT 0;

-- Phase 8: flow_config for runtime overrides (editable from UI)
CREATE TABLE IF NOT EXISTS flow_config (
  flow_config_id SERIAL PRIMARY KEY,
  key VARCHAR(100) UNIQUE NOT NULL,
  value_text TEXT,
  value_number DECIMAL(18, 4),
  value_bool BOOLEAN,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO flow_config (key, value_number) VALUES ('confluence_min_threshold', 75)
  ON CONFLICT (key) DO NOTHING;
INSERT INTO flow_config (key, value_bool) VALUES ('enable_confluence_gate', true)
  ON CONFLICT (key) DO NOTHING;
INSERT INTO flow_config (key, value_bool) VALUES ('enable_confluence_sizing', true)
  ON CONFLICT (key) DO NOTHING;
INSERT INTO flow_config (key, value_number) VALUES ('base_position_size', 1)
  ON CONFLICT (key) DO NOTHING;

-- Phase 9: flow_alerts for alert history
CREATE TABLE IF NOT EXISTS flow_alerts (
  flow_alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  direction VARCHAR(10) NOT NULL,
  confluence_score DECIMAL(6, 2) NOT NULL,
  netflow_formatted VARCHAR(50),
  gamma_regime VARCHAR(20),
  sent_to_discord BOOLEAN DEFAULT false,
  sent_to_slack BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flow_alerts_symbol ON flow_alerts(symbol);
CREATE INDEX IF NOT EXISTS idx_flow_alerts_created_at ON flow_alerts(created_at DESC);
