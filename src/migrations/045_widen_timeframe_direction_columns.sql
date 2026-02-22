-- Widen timeframe and direction columns to accommodate multi-timeframe signals
-- e.g. '15m,30m,1h,4h' exceeds varchar(10)

ALTER TABLE signals ALTER COLUMN timeframe TYPE varchar(50);
ALTER TABLE signals ALTER COLUMN direction TYPE varchar(30);

ALTER TABLE webhook_events ALTER COLUMN timeframe TYPE varchar(50);
ALTER TABLE webhook_events ALTER COLUMN direction TYPE varchar(30);

ALTER TABLE decision_recommendations ALTER COLUMN timeframe TYPE varchar(50);
ALTER TABLE decision_recommendations ALTER COLUMN direction TYPE varchar(30);

ALTER TABLE alert_outcomes ALTER COLUMN timeframe TYPE varchar(50);
ALTER TABLE alert_outcomes ALTER COLUMN direction TYPE varchar(30);

ALTER TABLE strat_alerts ALTER COLUMN timeframe TYPE varchar(50);
ALTER TABLE strat_alerts ALTER COLUMN direction TYPE varchar(30);

ALTER TABLE strat_plans ALTER COLUMN timeframe TYPE varchar(50);
ALTER TABLE strat_plans ALTER COLUMN direction TYPE varchar(30);

ALTER TABLE flow_alerts ALTER COLUMN direction TYPE varchar(30);
