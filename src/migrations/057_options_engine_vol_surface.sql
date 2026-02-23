-- Options Engine: Volatility Surface tables
-- Migration 057

-- Daily ATM IV series (one row per underlying per trading day)
CREATE TABLE IF NOT EXISTS oe_iv_daily_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  underlying TEXT NOT NULL,
  date DATE NOT NULL,
  atm_dte INT NOT NULL,
  call_ticker TEXT NOT NULL,
  put_ticker TEXT NOT NULL,
  call_iv DECIMAL(8,5) NOT NULL,
  put_iv DECIMAL(8,5) NOT NULL,
  atm_iv DECIMAL(8,5) NOT NULL,
  source TEXT NOT NULL DEFAULT 'MASSIVE_SNAPSHOT',
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(underlying, date)
);

CREATE INDEX IF NOT EXISTS idx_oe_iv_series_underlying
  ON oe_iv_daily_series(underlying, date DESC);

-- IV series collection failures
CREATE TABLE IF NOT EXISTS oe_iv_series_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  underlying TEXT NOT NULL,
  date DATE NOT NULL,
  reason TEXT NOT NULL,
  details JSONB,
  recorded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Vol surface snapshots (computed from IV series + chain data)
CREATE TABLE IF NOT EXISTS oe_vol_surface_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  underlying TEXT NOT NULL,
  computed_at TIMESTAMP NOT NULL,
  window_days INT NOT NULL,
  front_dte INT NOT NULL,
  mid_dte INT NOT NULL,
  back_dte INT NOT NULL,
  iv_front DECIMAL(8,5),
  iv_mid DECIMAL(8,5),
  iv_back DECIMAL(8,5),
  term_slope DECIMAL(8,5),
  term_shape TEXT NOT NULL,
  skew_25d_rr DECIMAL(8,5),
  iv_percentile_252d DECIMAL(8,5),
  iv_regime TEXT NOT NULL,
  sample_count INT NOT NULL,
  confidence DECIMAL(5,4) NOT NULL,
  source TEXT NOT NULL DEFAULT 'COMPUTED_FROM_MASSIVE',
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_oe_vol_surface_underlying
  ON oe_vol_surface_snapshots(underlying, computed_at DESC);
