-- Options Engine: Correlation matrix and dynamic buckets
-- Migration 058

-- Correlation matrix (nightly computation)
CREATE TABLE IF NOT EXISTS oe_correlation_matrix (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  computed_at TIMESTAMP NOT NULL,
  window_days INT NOT NULL,
  tickers TEXT[] NOT NULL,
  matrix JSONB NOT NULL,
  method TEXT NOT NULL DEFAULT 'PEARSON',
  sample_count INT NOT NULL,
  source TEXT NOT NULL DEFAULT 'MASSIVE_AGGS',
  confidence DECIMAL(5,4) NOT NULL,
  UNIQUE(window_days, (computed_at::date))
);

CREATE INDEX IF NOT EXISTS idx_oe_corr_matrix_date
  ON oe_correlation_matrix(computed_at DESC);

-- Dynamic correlation buckets (derived from matrix)
CREATE TABLE IF NOT EXISTS oe_correlation_buckets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  computed_at TIMESTAMP NOT NULL,
  window_days INT NOT NULL,
  bucket_version TEXT NOT NULL,
  buckets JSONB NOT NULL,
  threshold DECIMAL(5,4) NOT NULL,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_oe_corr_buckets_date
  ON oe_correlation_buckets(computed_at DESC);
