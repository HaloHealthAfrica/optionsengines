-- Options Engine: Positions with State Machine (Epic 14)
-- Optimistic locking via version column

CREATE TABLE IF NOT EXISTS oe_positions (
  position_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES oe_trading_accounts(id),
  trade_plan_id UUID,
  underlying TEXT NOT NULL,
  structure TEXT NOT NULL
    CHECK (structure IN ('LONG_CALL', 'LONG_PUT', 'CREDIT_CALL_SPREAD', 'CREDIT_PUT_SPREAD')),
  strategy_tag TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING_ENTRY'
    CHECK (state IN ('PENDING_ENTRY', 'PARTIALLY_FILLED', 'OPEN', 'EXIT_PENDING', 'CLOSED', 'FORCE_CLOSED', 'CANCELLED')),
  entry_order_id UUID,
  exit_order_id UUID,
  entry_filled_qty INT NOT NULL DEFAULT 0,
  exit_filled_qty INT NOT NULL DEFAULT 0,
  target_qty INT NOT NULL,
  entry_avg_price DECIMAL(10,4),
  exit_avg_price DECIMAL(10,4),
  unrealized_pnl DECIMAL(14,2) NOT NULL DEFAULT 0,
  realized_pnl DECIMAL(14,2),
  version INT NOT NULL DEFAULT 1,
  opened_at TIMESTAMP NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMP,
  force_close_reason TEXT,
  idempotency_key UUID NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oe_positions_account
  ON oe_positions(account_id);
CREATE INDEX IF NOT EXISTS idx_oe_positions_state
  ON oe_positions(state);
CREATE INDEX IF NOT EXISTS idx_oe_positions_underlying
  ON oe_positions(underlying);
CREATE INDEX IF NOT EXISTS idx_oe_positions_strategy_tag
  ON oe_positions(strategy_tag);
CREATE INDEX IF NOT EXISTS idx_oe_positions_opened
  ON oe_positions(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_oe_positions_idempotency
  ON oe_positions(idempotency_key);
