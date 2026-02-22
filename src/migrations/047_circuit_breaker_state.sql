-- Persistent circuit breaker state for drawdown protection.
-- Single-row table ensures state survives restarts and is shared across instances.

CREATE TABLE IF NOT EXISTS circuit_breaker_state (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  freeze_until TIMESTAMPTZ,
  triggered_at TIMESTAMPTZ,
  drawdown_pct DECIMAL(6, 2),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO circuit_breaker_state (id, updated_at)
VALUES (1, NOW())
ON CONFLICT (id) DO NOTHING;
