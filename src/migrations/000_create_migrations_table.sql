-- Migration 000: Create schema_migrations table
-- Description: Track applied migrations

CREATE TABLE IF NOT EXISTS schema_migrations (
  migration_id SERIAL PRIMARY KEY,
  migration_name VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schema_migrations_applied_at ON schema_migrations(applied_at DESC);

COMMENT ON TABLE schema_migrations IS 'Tracks applied database migrations';
