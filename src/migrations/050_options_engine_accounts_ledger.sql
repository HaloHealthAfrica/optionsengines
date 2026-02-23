-- Options Engine: Trading Accounts & Ledger (Epic 11)
-- AccountLedgerService owns all capital mutations

CREATE TABLE IF NOT EXISTS oe_trading_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  initial_capital DECIMAL(14,2) NOT NULL,
  current_cash DECIMAL(14,2) NOT NULL,
  reserved_capital DECIMAL(14,2) NOT NULL DEFAULT 0,
  realized_pnl DECIMAL(14,2) NOT NULL DEFAULT 0,
  unrealized_pnl DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_equity DECIMAL(14,2) NOT NULL,
  max_daily_loss DECIMAL(14,2) NOT NULL,
  max_portfolio_risk DECIMAL(14,2) NOT NULL,
  peak_equity DECIMAL(14,2) NOT NULL,
  intraday_realized_pnl DECIMAL(14,2) NOT NULL DEFAULT 0,
  intraday_start_equity DECIMAL(14,2) NOT NULL,
  entry_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  broker_sync_warning BOOLEAN NOT NULL DEFAULT FALSE,
  broker_sync_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  broker_synced_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_cash_reservation CHECK (current_cash - reserved_capital >= 0)
);

CREATE TABLE IF NOT EXISTS oe_ledger_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL REFERENCES oe_trading_accounts(id),
  type TEXT NOT NULL
    CHECK (type IN ('FUND', 'RESERVE', 'COMMIT_ENTRY', 'RELEASE', 'REALIZE', 'ADJUST', 'BROKER_SYNC', 'MTM_UPDATE')),
  amount DECIMAL(14,2) NOT NULL,
  reference_id UUID,
  balance_before DECIMAL(14,2) NOT NULL,
  balance_after DECIMAL(14,2) NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  idempotency_key UUID NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_oe_ledger_tx_account
  ON oe_ledger_transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_oe_ledger_tx_type
  ON oe_ledger_transactions(type);
CREATE INDEX IF NOT EXISTS idx_oe_ledger_tx_reference
  ON oe_ledger_transactions(reference_id);
CREATE INDEX IF NOT EXISTS idx_oe_ledger_tx_idempotency
  ON oe_ledger_transactions(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_oe_ledger_tx_timestamp
  ON oe_ledger_transactions(timestamp DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_oe_ledger_tx_idempotency_unique
  ON oe_ledger_transactions(idempotency_key, type);
