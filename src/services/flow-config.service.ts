/**
 * Flow Config Service - Runtime overrides for confluence threshold, gate, sizing.
 * Reads from flow_config table; falls back to env config.
 */
import { db } from './database.service.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

let cachedConfig: FlowConfigValues | null = null;

export interface FlowConfigValues {
  confluenceMinThreshold: number;
  enableConfluenceGate: boolean;
  enableConfluenceSizing: boolean;
  basePositionSize: number;
}

const DEFAULTS: FlowConfigValues = {
  confluenceMinThreshold: 50,
  enableConfluenceGate: true,
  enableConfluenceSizing: true,
  basePositionSize: 1,
};

export async function getFlowConfig(): Promise<FlowConfigValues> {
  try {
    const result = await db.query(
      `SELECT key, value_text, value_number, value_bool FROM flow_config`
    );
    const rows = result.rows as { key: string; value_text: string | null; value_number: string | number | null; value_bool: boolean | null }[];
    const overrides: Partial<FlowConfigValues> = {};
    for (const r of rows) {
      if (r.key === 'confluence_min_threshold' && r.value_number != null) {
        overrides.confluenceMinThreshold = Number(r.value_number);
      } else if (r.key === 'enable_confluence_gate' && r.value_bool != null) {
        overrides.enableConfluenceGate = r.value_bool;
      } else if (r.key === 'enable_confluence_sizing' && r.value_bool != null) {
        overrides.enableConfluenceSizing = r.value_bool;
      } else if (r.key === 'base_position_size' && r.value_number != null) {
        overrides.basePositionSize = Number(r.value_number);
      }
    }
    const values: FlowConfigValues = {
      confluenceMinThreshold: overrides.confluenceMinThreshold ?? config.confluenceMinThreshold ?? DEFAULTS.confluenceMinThreshold,
      enableConfluenceGate: overrides.enableConfluenceGate ?? config.enableConfluenceGate ?? DEFAULTS.enableConfluenceGate,
      enableConfluenceSizing: overrides.enableConfluenceSizing ?? config.enableConfluenceSizing ?? DEFAULTS.enableConfluenceSizing,
      basePositionSize: overrides.basePositionSize ?? config.basePositionSize ?? DEFAULTS.basePositionSize,
    };
    cachedConfig = values;
    return values;
  } catch (error) {
    logger.warn('Flow config fetch failed, using env defaults', { error });
    const fallback: FlowConfigValues = {
      confluenceMinThreshold: config.confluenceMinThreshold ?? DEFAULTS.confluenceMinThreshold,
      enableConfluenceGate: config.enableConfluenceGate ?? DEFAULTS.enableConfluenceGate,
      enableConfluenceSizing: config.enableConfluenceSizing ?? DEFAULTS.enableConfluenceSizing,
      basePositionSize: config.basePositionSize ?? DEFAULTS.basePositionSize,
    };
    cachedConfig = fallback;
    return fallback;
  }
}

/** Sync access for workers - returns cached config or env defaults. */
export function getFlowConfigSync(): FlowConfigValues {
  if (cachedConfig) return cachedConfig;
  return {
    confluenceMinThreshold: config.confluenceMinThreshold ?? DEFAULTS.confluenceMinThreshold,
    enableConfluenceGate: config.enableConfluenceGate ?? DEFAULTS.enableConfluenceGate,
    enableConfluenceSizing: config.enableConfluenceSizing ?? DEFAULTS.enableConfluenceSizing,
    basePositionSize: config.basePositionSize ?? DEFAULTS.basePositionSize,
  };
}

export function invalidateFlowConfigCache(): void {
  cachedConfig = null;
}

export async function updateFlowConfig(updates: Partial<FlowConfigValues>): Promise<FlowConfigValues> {
  const updatesList: { key: string; value_number?: number; value_bool?: boolean }[] = [];
  if (updates.confluenceMinThreshold != null) {
    updatesList.push({ key: 'confluence_min_threshold', value_number: updates.confluenceMinThreshold });
  }
  if (updates.enableConfluenceGate != null) {
    updatesList.push({ key: 'enable_confluence_gate', value_bool: updates.enableConfluenceGate });
  }
  if (updates.enableConfluenceSizing != null) {
    updatesList.push({ key: 'enable_confluence_sizing', value_bool: updates.enableConfluenceSizing });
  }
  if (updates.basePositionSize != null) {
    updatesList.push({ key: 'base_position_size', value_number: updates.basePositionSize });
  }

  for (const u of updatesList) {
    if (u.value_number != null) {
      await db.query(
        `INSERT INTO flow_config (key, value_number, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value_number = $2, updated_at = NOW()`,
        [u.key, u.value_number]
      );
    } else if (u.value_bool != null) {
      await db.query(
        `INSERT INTO flow_config (key, value_bool, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value_bool = $2, updated_at = NOW()`,
        [u.key, u.value_bool]
      );
    }
  }

  invalidateFlowConfigCache();
  return getFlowConfig();
}
