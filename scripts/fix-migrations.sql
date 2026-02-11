-- Script to fix partial migration state
-- Run this if migrations are failing due to "already exists" errors

-- Option 1: Mark migrations as applied (if tables/indexes already exist)
-- This tells the migration runner to skip these migrations

-- Check what's in the migrations table
SELECT * FROM schema_migrations ORDER BY migration_id;

-- If you see partial migrations, you can manually mark them as complete:
-- INSERT INTO schema_migrations (migration_name) VALUES ('001_create_engine1_tables.sql') ON CONFLICT DO NOTHING;
-- INSERT INTO schema_migrations (migration_name) VALUES ('002_create_engine2_tables.sql') ON CONFLICT DO NOTHING;
-- etc.

-- Option 2: Drop all indexes and let migrations recreate them
-- WARNING: This will temporarily remove indexes (queries will be slower)

-- Drop indexes from migration 001
DROP INDEX IF EXISTS idx_signals_status;
DROP INDEX IF EXISTS idx_signals_created_at;
DROP INDEX IF EXISTS idx_signals_symbol;
DROP INDEX IF EXISTS idx_signals_timestamp;
DROP INDEX IF EXISTS idx_refactored_signals_signal_id;
DROP INDEX IF EXISTS idx_orders_status;
DROP INDEX IF EXISTS idx_orders_signal_id;
DROP INDEX IF EXISTS idx_orders_symbol;
DROP INDEX IF EXISTS idx_orders_order_type;
DROP INDEX IF EXISTS idx_trades_order_id;
DROP INDEX IF EXISTS idx_trades_fill_timestamp;
DROP INDEX IF EXISTS idx_positions_status;
DROP INDEX IF EXISTS idx_positions_symbol;
DROP INDEX IF EXISTS idx_positions_expiration;

-- Drop indexes from migration 002
DROP INDEX IF EXISTS idx_experiments_variant;
DROP INDEX IF EXISTS idx_experiments_signal_id;
DROP INDEX IF EXISTS idx_experiments_created_at;
DROP INDEX IF EXISTS idx_agent_decisions_experiment_id;
DROP INDEX IF EXISTS idx_agent_decisions_signal_id;
DROP INDEX IF EXISTS idx_agent_decisions_agent_name;
DROP INDEX IF EXISTS idx_agent_decisions_agent_type;
DROP INDEX IF EXISTS idx_shadow_trades_experiment_id;
DROP INDEX IF EXISTS idx_shadow_trades_signal_id;
DROP INDEX IF EXISTS idx_shadow_trades_symbol;
DROP INDEX IF EXISTS idx_shadow_trades_entry_timestamp;
DROP INDEX IF EXISTS idx_shadow_positions_status;
DROP INDEX IF EXISTS idx_shadow_positions_shadow_trade_id;
DROP INDEX IF EXISTS idx_shadow_positions_symbol;
DROP INDEX IF EXISTS idx_shadow_positions_expiration;
DROP INDEX IF EXISTS idx_agent_performance_agent_name;
DROP INDEX IF EXISTS idx_feature_flags_name;
DROP INDEX IF EXISTS idx_feature_flags_enabled;

-- After running this, redeploy the app and migrations will recreate the indexes
