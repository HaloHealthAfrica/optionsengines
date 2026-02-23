-- Options Engine: Trade Plans & Legs (Epic 1)

CREATE TABLE IF NOT EXISTS oe_trade_plans (
  trade_plan_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES oe_trading_accounts(id),
  strategy_tag TEXT NOT NULL,
  structure TEXT NOT NULL
    CHECK (structure IN ('LONG_CALL', 'LONG_PUT', 'CREDIT_CALL_SPREAD', 'CREDIT_PUT_SPREAD')),
  underlying TEXT NOT NULL,
  contracts INT NOT NULL,
  entry_model JSONB NOT NULL DEFAULT '{}',
  exit_model JSONB NOT NULL DEFAULT '{}',
  risk_model JSONB NOT NULL DEFAULT '{}',
  liquidity_model JSONB NOT NULL DEFAULT '{}',
  market_context JSONB NOT NULL DEFAULT '{}',
  construction_version TEXT NOT NULL,
  construction_latency_ms INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS oe_trade_plan_legs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_plan_id UUID NOT NULL REFERENCES oe_trade_plans(trade_plan_id),
  leg_role TEXT NOT NULL CHECK (leg_role IN ('SHORT', 'LONG')),
  option_ticker TEXT NOT NULL,
  expiration DATE NOT NULL,
  strike DECIMAL(10,2) NOT NULL,
  "right" TEXT NOT NULL CHECK ("right" IN ('C', 'P')),
  dte INT NOT NULL,
  delta DECIMAL(8,5),
  gamma DECIMAL(8,5),
  vega DECIMAL(8,5),
  iv DECIMAL(8,5),
  greek_source TEXT NOT NULL CHECK (greek_source IN ('UW', 'MASSIVE', 'MISSING')),
  bid DECIMAL(10,4) NOT NULL,
  ask DECIMAL(10,4) NOT NULL,
  mid DECIMAL(10,4) NOT NULL,
  volume INT NOT NULL DEFAULT 0,
  oi INT NOT NULL DEFAULT 0,
  spread_width DECIMAL(10,4) NOT NULL,
  spread_width_pct DECIMAL(8,5) NOT NULL,
  liquidity_score DECIMAL(8,5) NOT NULL,
  sanity_check_passed BOOLEAN NOT NULL,
  quote_timestamp TIMESTAMP NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oe_trade_plans_account
  ON oe_trade_plans(account_id);
CREATE INDEX IF NOT EXISTS idx_oe_trade_plans_strategy
  ON oe_trade_plans(strategy_tag);
CREATE INDEX IF NOT EXISTS idx_oe_trade_plans_underlying
  ON oe_trade_plans(underlying);
CREATE INDEX IF NOT EXISTS idx_oe_trade_plan_legs_plan
  ON oe_trade_plan_legs(trade_plan_id);
