-- Migration 011: Add engine and experiment fields to order pipeline tables
-- Description: Track engine attribution for paper trading comparisons

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS engine VARCHAR(1) CHECK (engine IN ('A', 'B')),
  ADD COLUMN IF NOT EXISTS experiment_id UUID;

ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS engine VARCHAR(1) CHECK (engine IN ('A', 'B')),
  ADD COLUMN IF NOT EXISTS experiment_id UUID;

ALTER TABLE refactored_positions
  ADD COLUMN IF NOT EXISTS engine VARCHAR(1) CHECK (engine IN ('A', 'B')),
  ADD COLUMN IF NOT EXISTS experiment_id UUID;

CREATE INDEX IF NOT EXISTS idx_orders_engine ON orders(engine);
CREATE INDEX IF NOT EXISTS idx_orders_experiment_id ON orders(experiment_id);
CREATE INDEX IF NOT EXISTS idx_trades_engine ON trades(engine);
CREATE INDEX IF NOT EXISTS idx_trades_experiment_id ON trades(experiment_id);
CREATE INDEX IF NOT EXISTS idx_positions_engine ON refactored_positions(engine);
CREATE INDEX IF NOT EXISTS idx_positions_experiment_id ON refactored_positions(experiment_id);
