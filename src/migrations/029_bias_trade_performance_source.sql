-- Migration 029: Add source column to bias_trade_performance for simulation cleanup
ALTER TABLE bias_trade_performance ADD COLUMN IF NOT EXISTS source VARCHAR(20) DEFAULT 'live';
