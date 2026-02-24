-- Safety net: ensure all direction/timeframe columns are widened beyond VARCHAR(10).
-- Idempotent — PostgreSQL allows widening a column that is already wide enough.

ALTER TABLE signals ALTER COLUMN direction TYPE VARCHAR(30);
ALTER TABLE signals ALTER COLUMN timeframe TYPE VARCHAR(50);

ALTER TABLE webhook_events ALTER COLUMN direction TYPE VARCHAR(30);
ALTER TABLE webhook_events ALTER COLUMN timeframe TYPE VARCHAR(50);

ALTER TABLE decision_recommendations ALTER COLUMN direction TYPE VARCHAR(30);
ALTER TABLE decision_recommendations ALTER COLUMN timeframe TYPE VARCHAR(50);

ALTER TABLE strat_alerts ALTER COLUMN direction TYPE VARCHAR(30);
ALTER TABLE strat_alerts ALTER COLUMN timeframe TYPE VARCHAR(50);

ALTER TABLE strat_plans ALTER COLUMN direction TYPE VARCHAR(30);
ALTER TABLE strat_plans ALTER COLUMN timeframe TYPE VARCHAR(50);

ALTER TABLE flow_alerts ALTER COLUMN direction TYPE VARCHAR(30);

ALTER TABLE alert_outcomes ALTER COLUMN direction TYPE VARCHAR(30);
ALTER TABLE alert_outcomes ALTER COLUMN timeframe TYPE VARCHAR(50);

-- Also widen symbol columns that are too narrow for longer tickers (e.g. BRK/B, GOOGL)
ALTER TABLE alert_outcomes ALTER COLUMN symbol TYPE VARCHAR(20);
ALTER TABLE symbol_strat_scores ALTER COLUMN symbol TYPE VARCHAR(20);
ALTER TABLE orchestrator_context ALTER COLUMN symbol TYPE VARCHAR(20);
