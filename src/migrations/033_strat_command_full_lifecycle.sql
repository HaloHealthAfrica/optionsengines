-- Migration 033: Strat Command Center - Full Lifecycle Intelligence
-- strat_alerts, enhanced strat_plans, plan state machine

-- strat_alerts: Unified alert feed from scanner, webhook, UW, manual
CREATE TABLE IF NOT EXISTS strat_alerts (
  alert_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('long', 'short')),
  timeframe VARCHAR(10) NOT NULL CHECK (timeframe IN ('4H', 'D', 'W', 'M')),
  setup VARCHAR(50) NOT NULL,
  entry DECIMAL(12, 4) NOT NULL,
  target DECIMAL(12, 4) NOT NULL,
  stop DECIMAL(12, 4) NOT NULL,
  reversal_level DECIMAL(12, 4),
  score INTEGER NOT NULL,
  c1_type VARCHAR(50),
  c2_type VARCHAR(50),
  c1_shape VARCHAR(50),
  atr DECIMAL(12, 4),
  rvol VARCHAR(20),
  tf_confluence JSONB,
  flow_sentiment VARCHAR(20) CHECK (flow_sentiment IN ('bullish', 'bearish', 'neutral')),
  unusual_activity BOOLEAN DEFAULT FALSE,
  gex_level DECIMAL(20, 2),
  dark_pool_activity DECIMAL(20, 2),
  status VARCHAR(20) NOT NULL DEFAULT 'watching' CHECK (status IN (
    'watching', 'pending', 'triggered', 'expired', 'invalidated'
  )),
  source VARCHAR(30) NOT NULL DEFAULT 'scanner' CHECK (source IN (
    'scanner', 'webhook', 'manual', 'unusual_whales'
  )),
  options_suggestion TEXT,
  condition_text TEXT,
  raw_payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  triggered_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_strat_alerts_symbol ON strat_alerts(symbol);
CREATE INDEX IF NOT EXISTS idx_strat_alerts_status ON strat_alerts(status);
CREATE INDEX IF NOT EXISTS idx_strat_alerts_created ON strat_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_strat_alerts_score ON strat_alerts(score DESC);

-- Enhance strat_plans: add execution_mode, trigger_condition, full state machine
ALTER TABLE strat_plans
  ADD COLUMN IF NOT EXISTS entry_price DECIMAL(12, 4),
  ADD COLUMN IF NOT EXISTS target_price DECIMAL(12, 4),
  ADD COLUMN IF NOT EXISTS stop_price DECIMAL(12, 4),
  ADD COLUMN IF NOT EXISTS reversal_level DECIMAL(12, 4),
  ADD COLUMN IF NOT EXISTS setup VARCHAR(50),
  ADD COLUMN IF NOT EXISTS source_alert_id UUID REFERENCES strat_alerts(alert_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS execution_mode VARCHAR(20) DEFAULT 'manual' CHECK (execution_mode IN ('manual', 'auto_on_trigger')),
  ADD COLUMN IF NOT EXISTS trigger_condition TEXT,
  ADD COLUMN IF NOT EXISTS risk_amount DECIMAL(12, 2),
  ADD COLUMN IF NOT EXISTS risk_percent DECIMAL(5, 2),
  ADD COLUMN IF NOT EXISTS position_size INTEGER,
  ADD COLUMN IF NOT EXISTS trailing_stop BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS partial_exit_levels JSONB,
  ADD COLUMN IF NOT EXISTS contract_type VARCHAR(10) CHECK (contract_type IN ('call', 'put')),
  ADD COLUMN IF NOT EXISTS strike_price DECIMAL(12, 4),
  ADD COLUMN IF NOT EXISTS expiration DATE,
  ADD COLUMN IF NOT EXISTS dte INTEGER,
  ADD COLUMN IF NOT EXISTS position_id UUID,
  ADD COLUMN IF NOT EXISTS candidate_id UUID,
  ADD COLUMN IF NOT EXISTS triggered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS filled_at TIMESTAMPTZ;

-- Add new plan states (draft, armed, executing, filled, cancelled)
-- Keep backward compat: map PLANNED->draft, IN_FORCE->armed, TRIGGERED->triggered, EXECUTED->filled
-- Use a new status column to avoid breaking existing data
ALTER TABLE strat_plans
  ADD COLUMN IF NOT EXISTS plan_status VARCHAR(20) DEFAULT 'draft' CHECK (plan_status IN (
    'draft', 'armed', 'triggered', 'executing', 'filled', 'expired', 'cancelled', 'rejected'
  ));

CREATE INDEX IF NOT EXISTS idx_strat_plans_plan_status ON strat_plans(plan_status);
CREATE INDEX IF NOT EXISTS idx_strat_plans_armed ON strat_plans(plan_status) WHERE plan_status = 'armed';
CREATE INDEX IF NOT EXISTS idx_strat_plans_source_alert ON strat_plans(source_alert_id) WHERE source_alert_id IS NOT NULL;

COMMENT ON TABLE strat_alerts IS 'Unified strat setup alerts from scanner, webhook, UW, manual';
COMMENT ON TABLE strat_plans IS 'Pre-authorized trade instructions with execution rules. draft->armed->triggered->executing->filled';
