import { randomUUID } from 'crypto';
import * as Sentry from '@sentry/node';
import { logger } from '../../utils/logger.js';
import { db } from '../../services/database.service.js';
import { getEngineConfig } from '../config/loader.js';
import type { CorrelationMatrix } from './CorrelationMatrixJob.js';

export interface CorrelationBucket {
  id: string;
  tickers: string[];
  centroid: string;
}

export interface CorrelationBucketsResult {
  id: string;
  computedAt: Date;
  windowDays: number;
  bucketVersion: string;
  buckets: CorrelationBucket[];
  threshold: number;
  notes: string | null;
}

/**
 * Builds dynamic correlation buckets from the correlation matrix
 * using a connected-components graph approach.
 */
export class CorrelationBucketService {

  /**
   * Build buckets from a correlation matrix.
   * Graph approach: create edges where corr >= threshold,
   * each connected component = bucket,
   * centroid = ticker with max avg correlation to others in bucket.
   */
  async buildAndPersist(matrix: CorrelationMatrix): Promise<CorrelationBucketsResult> {
    const cfg = getEngineConfig().correlation;
    const threshold = cfg.threshold;
    const tickers = matrix.tickers;

    // Build adjacency list
    const adjacency = new Map<string, Set<string>>();
    for (const t of tickers) {
      adjacency.set(t, new Set());
    }

    for (let i = 0; i < tickers.length; i++) {
      for (let j = i + 1; j < tickers.length; j++) {
        const corr = matrix.matrix[tickers[i]]?.[tickers[j]] ?? 0;
        if (corr >= threshold) {
          adjacency.get(tickers[i])!.add(tickers[j]);
          adjacency.get(tickers[j])!.add(tickers[i]);
        }
      }
    }

    // Find connected components via BFS
    const visited = new Set<string>();
    const components: string[][] = [];

    for (const ticker of tickers) {
      if (visited.has(ticker)) continue;

      const component: string[] = [];
      const queue = [ticker];
      visited.add(ticker);

      while (queue.length > 0) {
        const current = queue.shift()!;
        component.push(current);

        for (const neighbor of adjacency.get(current) ?? []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      components.push(component);
    }

    // Build buckets with centroids
    const buckets: CorrelationBucket[] = components.map((component, idx) => {
      const centroid = this.findCentroid(component, matrix.matrix);
      return {
        id: `B${idx + 1}`,
        tickers: component.sort(),
        centroid,
      };
    });

    // Determine version
    const latestVersion = await this.getLatestVersion();
    const newVersion = this.incrementVersion(latestVersion);

    const id = randomUUID();
    const now = new Date();

    const bucketsJson = buckets.map(b => ({
      id: b.id,
      tickers: b.tickers,
      centroid: b.centroid,
    }));

    await db.query(
      `INSERT INTO oe_correlation_buckets
        (id, computed_at, window_days, bucket_version, buckets, threshold, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id, now, matrix.windowDays, newVersion,
        JSON.stringify(bucketsJson), threshold,
        `${buckets.length} buckets from ${tickers.length} tickers`,
      ]
    );

    const result: CorrelationBucketsResult = {
      id, computedAt: now, windowDays: matrix.windowDays,
      bucketVersion: newVersion, buckets, threshold,
      notes: `${buckets.length} buckets from ${tickers.length} tickers`,
    };

    Sentry.addBreadcrumb({
      category: 'engine',
      message: `Correlation buckets computed: ${buckets.length} buckets from ${tickers.length} tickers`,
      level: 'info',
      data: { bucketCount: buckets.length, tickerCount: tickers.length, version: newVersion, threshold },
    });
    logger.info('Correlation buckets built', {
      bucketCount: buckets.length,
      tickerCount: tickers.length,
      version: newVersion,
      threshold,
    });

    return result;
  }

  /**
   * Get latest buckets from DB.
   */
  async getLatest(): Promise<CorrelationBucketsResult | null> {
    const result = await db.query(
      'SELECT * FROM oe_correlation_buckets ORDER BY computed_at DESC LIMIT 1'
    );

    if (result.rows.length === 0) return null;
    return this.mapRow(result.rows[0]);
  }

  /**
   * Convert buckets result into a Map<bucketId, tickers[]> for PortfolioGovernor consumption.
   */
  toBucketMap(buckets: CorrelationBucketsResult): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const bucket of buckets.buckets) {
      map.set(bucket.id, bucket.tickers);
    }
    return map;
  }

  /**
   * Find which bucket a ticker belongs to.
   */
  findBucketForTicker(ticker: string, buckets: CorrelationBucketsResult): CorrelationBucket | null {
    return buckets.buckets.find(b => b.tickers.includes(ticker)) ?? null;
  }

  // ─── Helpers ───

  /**
   * Find centroid: ticker with highest average correlation to others in the component.
   */
  private findCentroid(
    component: string[],
    matrix: Record<string, Record<string, number>>
  ): string {
    if (component.length === 1) return component[0];

    let bestTicker = component[0];
    let bestAvg = -Infinity;

    for (const ticker of component) {
      let sum = 0;
      let count = 0;
      for (const other of component) {
        if (other === ticker) continue;
        sum += matrix[ticker]?.[other] ?? 0;
        count++;
      }
      const avg = count > 0 ? sum / count : 0;
      if (avg > bestAvg) {
        bestAvg = avg;
        bestTicker = ticker;
      }
    }

    return bestTicker;
  }

  private async getLatestVersion(): Promise<string> {
    const result = await db.query(
      'SELECT bucket_version FROM oe_correlation_buckets ORDER BY computed_at DESC LIMIT 1'
    );

    if (result.rows.length === 0) return '0.0.0';
    return result.rows[0].bucket_version as string;
  }

  private incrementVersion(version: string): string {
    const parts = version.split('.').map(Number);
    parts[2] = (parts[2] ?? 0) + 1;
    return parts.join('.');
  }

  private mapRow(row: Record<string, unknown>): CorrelationBucketsResult {
    const bucketsRaw = row.buckets as Array<{ id: string; tickers: string[]; centroid: string }>;
    return {
      id: row.id as string,
      computedAt: new Date(row.computed_at as string),
      windowDays: parseInt(row.window_days as string),
      bucketVersion: row.bucket_version as string,
      buckets: bucketsRaw.map(b => ({
        id: b.id,
        tickers: b.tickers,
        centroid: b.centroid,
      })),
      threshold: parseFloat(row.threshold as string),
      notes: row.notes as string | null,
    };
  }
}

export const correlationBucketService = new CorrelationBucketService();
