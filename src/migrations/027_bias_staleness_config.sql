-- Migration 027: Bias staleness protection config

INSERT INTO bias_config (config_key, config_json, updated_at)
VALUES (
  'staleness',
  '{
    "behavior": "reduce_risk",
    "riskMultiplier": 0.7,
    "rthThresholdMinutes": 10,
    "dailyThresholdMinutes": 60
  }'::jsonb,
  NOW()
)
ON CONFLICT (config_key) DO NOTHING;
