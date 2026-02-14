-- Migration 024: Gamma Context + Market State Schema Extensions
-- Phase 1 - Data + Persistence
-- Extends symbol_market_state with price-derived bias and gamma context.
-- Adds gamma_context append-only table.
-- Extends market_state_history with event_type, event_ts_ms, source.

-- Enums for price bias and gamma
DO $$ BEGIN
  CREATE TYPE price_bias_consensus_enum AS ENUM ('BULLISH', 'BEARISH', 'NEUTRAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE gamma_environment_enum AS ENUM ('POSITIVE', 'NEGATIVE', 'NEUTRAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE gamma_magnitude_enum AS ENUM ('LOW', 'MEDIUM', 'HIGH');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE wall_method_enum AS ENUM ('PROVIDER', 'DERIVED_GAMMA', 'DERIVED_OI');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE vol_regime_bias_enum AS ENUM ('EXPANSION_LIKELY', 'COMPRESSION_LIKELY', 'NEUTRAL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Extend symbol_market_state with price-derived bias and gamma fields
ALTER TABLE symbol_market_state
  ADD COLUMN IF NOT EXISTS last_event_ts_ms BIGINT,
  ADD COLUMN IF NOT EXISTS price_bias_consensus price_bias_consensus_enum,
  ADD COLUMN IF NOT EXISTS price_bias_score INTEGER,
  ADD COLUMN IF NOT EXISTS price_confidence_score NUMERIC(5,4) CHECK (price_confidence_score >= 0 AND price_confidence_score <= 1),
  ADD COLUMN IF NOT EXISTS gamma_environment gamma_environment_enum,
  ADD COLUMN IF NOT EXISTS gamma_magnitude gamma_magnitude_enum,
  ADD COLUMN IF NOT EXISTS gamma_flip_level NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS distance_to_flip NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS call_wall NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS put_wall NUMERIC(18,4),
  ADD COLUMN IF NOT EXISTS wall_method wall_method_enum,
  ADD COLUMN IF NOT EXISTS gamma_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS vol_regime_bias vol_regime_bias_enum,
  ADD COLUMN IF NOT EXISTS latest_price_payload JSONB,
  ADD COLUMN IF NOT EXISTS latest_gamma_payload JSONB;

-- Backfill price_* from existing bias_* for existing rows (one-time migration)
-- HOLD maps to NEUTRAL
UPDATE symbol_market_state
SET
  price_bias_consensus = CASE
    WHEN bias_consensus = 'BULLISH' THEN 'BULLISH'::price_bias_consensus_enum
    WHEN bias_consensus = 'BEARISH' THEN 'BEARISH'::price_bias_consensus_enum
    WHEN bias_consensus IN ('NEUTRAL', 'HOLD') THEN 'NEUTRAL'::price_bias_consensus_enum
    ELSE 'NEUTRAL'::price_bias_consensus_enum
  END,
  price_bias_score = ROUND(bias_score::numeric)::integer,
  price_confidence_score = confidence_score
WHERE price_bias_score IS NULL AND bias_consensus IS NOT NULL;

-- Extend market_state_history
ALTER TABLE market_state_history
  ADD COLUMN IF NOT EXISTS event_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS event_ts_ms BIGINT,
  ADD COLUMN IF NOT EXISTS source VARCHAR(50);

-- Add unique constraint on event_id if not exists (for idempotency)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'market_state_history_event_id_key'
  ) THEN
    ALTER TABLE market_state_history ADD CONSTRAINT market_state_history_event_id_key UNIQUE (event_id);
  END IF;
END $$;

-- Create gamma_context (append-only)
CREATE TABLE IF NOT EXISTS gamma_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol VARCHAR(20) NOT NULL,
  as_of_ts_ms BIGINT NOT NULL,
  net_gex NUMERIC(24,4) NOT NULL,
  total_gex NUMERIC(24,4) NOT NULL,
  gamma_environment gamma_environment_enum NOT NULL,
  gamma_magnitude gamma_magnitude_enum NOT NULL,
  gamma_flip_level NUMERIC(18,4),
  distance_to_flip NUMERIC(18,4),
  call_wall NUMERIC(18,4),
  put_wall NUMERIC(18,4),
  wall_method wall_method_enum,
  zero_dte_gamma_ratio NUMERIC(8,4),
  vol_regime_bias vol_regime_bias_enum NOT NULL,
  raw_provider_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gamma_context_symbol_as_of
  ON gamma_context(symbol, as_of_ts_ms DESC);

COMMENT ON TABLE gamma_context IS 'Append-only gamma context from provider (Unusual Whales). Used for merge into symbol_market_state.';
