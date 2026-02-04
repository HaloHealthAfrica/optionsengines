// Feature Flag Service - runtime toggles for Engine 2
import { db } from './database.service.js';
import { logger } from '../utils/logger.js';
import { FeatureFlag } from '../types/index.js';

const DEFAULT_REFRESH_MS = 5000;

export class FeatureFlagService {
  private cache: Map<string, FeatureFlag> = new Map();
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(private readonly refreshIntervalMs: number = DEFAULT_REFRESH_MS) {}

  async init(): Promise<void> {
    await this.refreshCache();
    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(() => {
        this.refreshCache().catch((error) => {
          logger.error('Feature flag cache refresh failed', error);
        });
      }, this.refreshIntervalMs);
    }
    logger.info('Feature flag service initialized', { refreshIntervalMs: this.refreshIntervalMs });
  }

  async refreshCache(): Promise<void> {
    const result = await db.query<FeatureFlag>(
      `SELECT flag_id, name, enabled, description, updated_at, updated_by FROM feature_flags`
    );

    const nextCache = new Map<string, FeatureFlag>();
    for (const row of result.rows) {
      nextCache.set(row.name, row);
    }

    this.cache = nextCache;
  }

  isEnabled(flagName: string): boolean {
    return this.cache.get(flagName)?.enabled ?? false;
  }

  async getAllFlags(): Promise<FeatureFlag[]> {
    if (this.cache.size === 0) {
      await this.refreshCache();
    }
    return Array.from(this.cache.values());
  }

  async updateFlag(flagName: string, enabled: boolean, updatedBy?: string): Promise<boolean> {
    const result = await db.query(
      `UPDATE feature_flags
       SET enabled = $1, updated_at = NOW(), updated_by = $2
       WHERE name = $3`,
      [enabled, updatedBy || null, flagName]
    );

    if ((result.rowCount || 0) > 0) {
      await this.refreshCache();
      logger.info('Feature flag updated', { flagName, enabled, updatedBy });
      return true;
    }

    logger.warn('Feature flag not found', { flagName });
    return false;
  }

  stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }
}

export const featureFlags = new FeatureFlagService();
