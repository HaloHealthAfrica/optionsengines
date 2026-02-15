-- Migration 026: Bias Risk Model config
-- Config-driven risk modifiers for position sizing

INSERT INTO bias_config (config_key, config_json, updated_at)
VALUES (
  'risk',
  '{
    "macroBreakdownLongMultiplier": 0.5,
    "macroTrendUpLongMultiplier": 1.15,
    "macroTrendDownShortMultiplier": 0.5,
    "rangeBreakoutMultiplier": 0.7,
    "trendAlignmentMultiplier": 1.1,
    "stateStrengthUpMultiplier": 1.1,
    "stateStrengthDownMultiplier": 0.8,
    "macroDriftHighMultiplier": 0.85,
    "latePhaseNegativeMultiplier": 0.75
  }'::jsonb,
  NOW()
)
ON CONFLICT (config_key) DO NOTHING;

COMMENT ON TABLE bias_config IS 'Bias aggregator config - gating rules and risk modifiers';
