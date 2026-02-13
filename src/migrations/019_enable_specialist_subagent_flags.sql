-- Migration 019: Enable ORB, Strat, TTM specialists and Satyland sub-agent
-- Description: Activates specialist and sub-agent agents so they process signals when data conditions are met.
-- Run with: SKIP_MIGRATIONS=false

UPDATE feature_flags SET enabled = true WHERE name = 'enable_orb_specialist';
UPDATE feature_flags SET enabled = true WHERE name = 'enable_strat_specialist';
UPDATE feature_flags SET enabled = true WHERE name = 'enable_ttm_specialist';
UPDATE feature_flags SET enabled = true WHERE name = 'enable_satyland_subagent';
