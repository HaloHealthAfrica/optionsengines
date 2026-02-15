/**
 * Adaptive Status - Read/write adaptive config for UI and tuner.
 */

import { db } from '../database.service.js';

export interface AdaptiveMeta {
  enabled: boolean;
  dryRun?: boolean;
  lastRunSummary?: {
    date: string;
    tunerUpdated: boolean;
    parametersChanged: { key: string; oldValue: number; newValue: number; reason: string }[];
  };
}

export async function getAdaptiveMeta(): Promise<AdaptiveMeta> {
  try {
    const r = await db.query(
      `SELECT config_json FROM bias_config WHERE config_key = 'adaptive' LIMIT 1`
    );
    const row = r.rows[0];
    if (row?.config_json) {
      const cfg = row.config_json as Record<string, unknown>;
      return {
        enabled: cfg.enabled !== false,
        dryRun: cfg.dryRun === true,
        lastRunSummary: cfg.lastRunSummary as AdaptiveMeta['lastRunSummary'],
      };
    }
  } catch {
    /* ignore */
  }
  return { enabled: true };
}

export async function setAdaptiveEnabled(enabled: boolean): Promise<void> {
  const r = await db.query(
    `SELECT config_json FROM bias_config WHERE config_key = 'adaptive' LIMIT 1`
  );
  const cfg = (r.rows[0]?.config_json as Record<string, unknown>) ?? {};
  const next = { ...cfg, enabled };
  await db.query(
    `INSERT INTO bias_config (config_key, config_json, updated_at)
     VALUES ('adaptive', $1::jsonb, NOW())
     ON CONFLICT (config_key) DO UPDATE SET config_json = $1::jsonb, updated_at = NOW()`,
    [JSON.stringify(next)]
  );
}

export async function setLastRunSummary(summary: AdaptiveMeta['lastRunSummary']): Promise<void> {
  const r = await db.query(
    `SELECT config_json FROM bias_config WHERE config_key = 'adaptive' LIMIT 1`
  );
  const cfg = (r.rows[0]?.config_json as Record<string, unknown>) ?? {};
  const next = { ...cfg, lastRunSummary: summary };
  await db.query(
    `UPDATE bias_config SET config_json = $1::jsonb, updated_at = NOW() WHERE config_key = 'adaptive'`,
    [JSON.stringify(next)]
  );
}
