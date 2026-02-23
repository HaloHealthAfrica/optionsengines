-- Options Engine: Regime-based strategy allocation policies + snapshots
-- Migration 059

-- Strategy allocation policies (rule DSL per account)
CREATE TABLE IF NOT EXISTS oe_strategy_allocation_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES oe_trading_accounts(id),
  policy_version TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  rules JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oe_alloc_policies_account
  ON oe_strategy_allocation_policies(account_id);

-- Allocation snapshots (computed from policy + regime)
CREATE TABLE IF NOT EXISTS oe_allocation_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES oe_trading_accounts(id),
  computed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  underlying TEXT,
  regime_tag TEXT NOT NULL,
  bucket_limits JSONB NOT NULL,
  strategy_weight_overrides JSONB NOT NULL,
  risk_multipliers JSONB NOT NULL,
  deny_strategies TEXT[] NOT NULL DEFAULT '{}',
  confidence DECIMAL(5,4) NOT NULL,
  source TEXT NOT NULL DEFAULT 'COMPUTED',
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_oe_alloc_snap_account
  ON oe_allocation_snapshots(account_id, computed_at DESC);
