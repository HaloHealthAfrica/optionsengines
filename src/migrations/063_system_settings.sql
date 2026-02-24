-- PR2: System settings table for runtime configuration (no redeploy).
-- Stores key-value pairs with timestamps. Seeded with TRADING_MODE.

CREATE TABLE IF NOT EXISTS system_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_settings (key, value, updated_at)
VALUES ('TRADING_MODE', 'SHADOW_UDC', NOW())
ON CONFLICT (key) DO NOTHING;
