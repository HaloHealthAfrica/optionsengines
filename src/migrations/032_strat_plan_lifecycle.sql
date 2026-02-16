-- Migration 032: Strat Plan Lifecycle Engine
-- Description: Watchlist (max 10 tickers) + Strat Plans with lifecycle states
-- Enables focused tactical execution, not broad market scanning

-- active_watchlist: Max 10 tickers, gates all plan acceptance
CREATE TABLE IF NOT EXISTS active_watchlist (
  watchlist_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'webhook')),
  priority_score INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(symbol)
);

CREATE INDEX IF NOT EXISTS idx_watchlist_active ON active_watchlist(active) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_watchlist_priority ON active_watchlist(priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_watchlist_symbol ON active_watchlist(symbol);

COMMENT ON TABLE active_watchlist IS 'Max 10 active tickers - gates plan acceptance. Focused execution universe.';

-- strat_plans: Plans with lifecycle states, linked to signals when triggered
CREATE TABLE IF NOT EXISTS strat_plans (
  plan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('long', 'short')),
  timeframe VARCHAR(20) NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'webhook')),
  state VARCHAR(20) NOT NULL DEFAULT 'PLANNED' CHECK (state IN (
    'PLANNED', 'QUEUED', 'BLOCKED', 'IN_FORCE', 'TRIGGERED', 'EXECUTED', 'EXPIRED', 'REJECTED'
  )),
  signal_id UUID REFERENCES signals(signal_id) ON DELETE SET NULL,
  raw_payload JSONB,
  -- Prioritization scores (populated by enrichment)
  risk_reward DECIMAL(10, 2),
  atr_percent DECIMAL(10, 4),
  expected_move_alignment DECIMAL(5, 2),
  gamma_bias DECIMAL(5, 2),
  liquidity_score DECIMAL(5, 2),
  engine_confidence DECIMAL(5, 2),
  priority_score DECIMAL(10, 2),
  -- Capacity / risk controls
  in_force_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strat_plans_state ON strat_plans(state);
CREATE INDEX IF NOT EXISTS idx_strat_plans_symbol ON strat_plans(symbol);
CREATE INDEX IF NOT EXISTS idx_strat_plans_priority ON strat_plans(priority_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_strat_plans_created ON strat_plans(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strat_plans_signal ON strat_plans(signal_id) WHERE signal_id IS NOT NULL;

COMMENT ON TABLE strat_plans IS 'Strat plans with lifecycle. Max 10 concurrent, max 2 per ticker (configurable).';

-- strat_plan_config: Configurable limits
CREATE TABLE IF NOT EXISTS strat_plan_config (
  config_key VARCHAR(64) PRIMARY KEY,
  config_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO strat_plan_config (config_key, config_value) VALUES
  ('max_watchlist_tickers', '10'),
  ('max_concurrent_plans', '10'),
  ('max_plans_per_ticker', '2'),
  ('max_in_force_simultaneous', '3'),
  ('webhook_auto_add_to_watchlist', 'false'),
  ('kill_switch_consecutive_failures', '3')
ON CONFLICT (config_key) DO NOTHING;
