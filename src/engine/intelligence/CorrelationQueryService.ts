import { logger } from '../../utils/logger.js';
import { getEngineConfig } from '../config/loader.js';
import { correlationMatrixJob } from './CorrelationMatrixJob.js';
import { correlationBucketService } from './CorrelationBucketService.js';
import type { CorrelationMatrix } from './CorrelationMatrixJob.js';
import type { CorrelationBucket, CorrelationBucketsResult } from './CorrelationBucketService.js';

export interface TickerCorrelation {
  ticker: string;
  otherTicker: string;
  correlation: number;
}

export interface TickerBucketInfo {
  ticker: string;
  bucket: CorrelationBucket | null;
  correlatedTickers: TickerCorrelation[];
}

export interface GovernorBucketResult {
  source: 'DYNAMIC' | 'STATIC_FALLBACK';
  bucketMap: Map<string, string[]>;
  confidence: number;
  notes: string;
}

/**
 * Read layer for correlation data.
 * Provides data to PortfolioGovernor and dashboard.
 */
export class CorrelationQueryService {

  /**
   * Get correlation buckets for PortfolioGovernor.
   * If dynamic buckets unavailable and correlation limits enabled, fail-closed.
   * Otherwise falls back to static YAML buckets.
   */
  async getBucketsForGovernor(correlationLimitsEnabled: boolean = true): Promise<GovernorBucketResult> {
    const dynamicBuckets = await correlationBucketService.getLatest();

    if (dynamicBuckets) {
      const bucketMap = correlationBucketService.toBucketMap(dynamicBuckets);
      return {
        source: 'DYNAMIC',
        bucketMap,
        confidence: this.computeFreshness(dynamicBuckets.computedAt),
        notes: `Dynamic v${dynamicBuckets.bucketVersion}, ${dynamicBuckets.buckets.length} buckets`,
      };
    }

    // No dynamic buckets available
    if (correlationLimitsEnabled) {
      // Fall back to static YAML buckets
      const staticBuckets = this.getStaticBuckets();
      logger.warn('Using static correlation buckets (CORR_FALLBACK_STATIC)');
      return {
        source: 'STATIC_FALLBACK',
        bucketMap: staticBuckets,
        confidence: 0,
        notes: 'CORR_FALLBACK_STATIC: dynamic buckets unavailable',
      };
    }

    return {
      source: 'STATIC_FALLBACK',
      bucketMap: new Map(),
      confidence: 0,
      notes: 'Correlation limits disabled, no buckets applied',
    };
  }

  /**
   * Get correlation info for a specific ticker.
   */
  async getTickerInfo(ticker: string): Promise<TickerBucketInfo> {
    const [matrix, buckets] = await Promise.all([
      correlationMatrixJob.getLatest(),
      correlationBucketService.getLatest(),
    ]);

    const bucket = buckets
      ? correlationBucketService.findBucketForTicker(ticker, buckets)
      : null;

    const correlatedTickers: TickerCorrelation[] = [];

    if (matrix && matrix.matrix[ticker]) {
      const tickerCorrs = matrix.matrix[ticker];
      for (const [other, corr] of Object.entries(tickerCorrs)) {
        if (other !== ticker) {
          correlatedTickers.push({ ticker, otherTicker: other, correlation: corr });
        }
      }
      correlatedTickers.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
    }

    return { ticker, bucket, correlatedTickers };
  }

  /**
   * Get the full latest matrix.
   */
  async getLatestMatrix(): Promise<CorrelationMatrix | null> {
    return correlationMatrixJob.getLatest();
  }

  /**
   * Get the full latest bucket set.
   */
  async getLatestBuckets(): Promise<CorrelationBucketsResult | null> {
    return correlationBucketService.getLatest();
  }

  /**
   * Get pairwise correlation between two tickers.
   */
  async getPairwiseCorrelation(tickerA: string, tickerB: string): Promise<number | null> {
    const matrix = await correlationMatrixJob.getLatest();
    if (!matrix) return null;

    return matrix.matrix[tickerA]?.[tickerB] ?? null;
  }

  // ─── Helpers ───

  /**
   * Build static buckets from YAML config core tickers.
   * Each core ticker is its own bucket (simple fallback).
   */
  private getStaticBuckets(): Map<string, string[]> {
    const cfg = getEngineConfig().correlation;
    const map = new Map<string, string[]>();

    for (let i = 0; i < cfg.coreTickers.length; i++) {
      map.set(`STATIC_${i + 1}`, [cfg.coreTickers[i]]);
    }

    return map;
  }

  /**
   * Compute freshness as a 0-1 score (1 = computed today, decays over 7 days).
   */
  private computeFreshness(computedAt: Date): number {
    const ageHours = (Date.now() - computedAt.getTime()) / (1000 * 60 * 60);
    const maxAgeHours = 7 * 24; // 7 days
    return Math.max(0, 1 - ageHours / maxAgeHours);
  }
}

export const correlationQueryService = new CorrelationQueryService();
