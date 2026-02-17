/**
 * Alert Outcome Tracker - Records what actually happened to every strat alert
 * Tracks MFE/MAE, target hit, stop hit, expired. Feeds the Strat Feedback Loop.
 * Runs every 60 seconds during market hours.
 */

import { logger } from '../utils/logger.js';
import { db } from '../services/database.service.js';
import { config } from '../config/index.js';
import { marketData } from '../services/market-data.js';
import { getStratMarketSession } from '../utils/market-session.js';
import { publishStratOutcomeRecorded } from '../services/realtime-updates.service.js';

type AlertRow = {
  alert_id: string;
  symbol: string;
  direction: string;
  timeframe: string;
  setup: string;
  entry: string | number;
  target: string | number;
  stop: string | number;
  score: number;
  flow_sentiment: string | null;
  unusual_activity: boolean | null;
  rvol: string | null;
  tf_confluence: Record<string, string> | null;
  c1_shape: string | null;
  status: string;
  triggered_at: Date | string | null;
  expires_at: Date | string | null;
  max_favorable_excursion: number | null;
  max_adverse_excursion: number | null;
  outcome: string | null;
};

async function getCurrentPrice(symbol: string): Promise<number | null> {
  try {
    return await marketData.getStockPrice(symbol);
  } catch {
    return null;
  }
}

async function getVIX(): Promise<number | null> {
  try {
    return await marketData.getStockPrice('VIX');
  } catch {
    try {
      return await marketData.getStockPrice('^VIX');
    } catch {
      return null;
    }
  }
}

function determineSpyTrend(_spyPrice: number): 'bullish' | 'bearish' | 'neutral' {
  // Placeholder: could compare to MA or use market intel. Default neutral.
  return 'neutral';
}

async function recordOutcome(
  alert: AlertRow,
  outcome: string,
  exitPrice: number,
  mfe: number,
  mae: number
): Promise<void> {
  const entryPrice = Number(alert.entry);
  const targetPrice = Number(alert.target);
  const stopPrice = Number(alert.stop);
  const riskDistance = Math.abs(entryPrice - stopPrice);
  const actualRR = riskDistance > 0 ? mfe / riskDistance : 0;

  const didTrigger = alert.status === 'triggered';
  const vix = await getVIX();
  const marketContext = {
    spy_trend: determineSpyTrend(0),
    vix_level: vix,
    market_session: getStratMarketSession(),
    day_of_week: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
  };

  const tfConfluenceCount = alert.tf_confluence
    ? Object.values(alert.tf_confluence).filter(
        (v) => String(v).toLowerCase() === (alert.direction || '').toLowerCase()
      ).length
    : 0;

  const predictedRR =
    riskDistance > 0
      ? Math.abs(Number(alert.target) - entryPrice) / riskDistance
      : null;

  await db.query(
    `INSERT INTO alert_outcomes (
      alert_id, symbol, direction, timeframe, setup_type, score_at_creation,
      entry_price, target_price, stop_price, predicted_rr,
      did_trigger, did_hit_target, did_hit_stop,
      max_favorable_excursion, max_adverse_excursion, actual_rr, outcome, exit_price,
      flow_sentiment, unusual_activity, rvol, tf_confluence_count, c1_shape, market_context
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
    [
      alert.alert_id,
      alert.symbol,
      alert.direction,
      alert.timeframe,
      alert.setup,
      alert.score,
      entryPrice,
      targetPrice,
      stopPrice,
      predictedRR,
      didTrigger,
      outcome === 'target_hit',
      outcome === 'stop_hit',
      mfe,
      mae,
      actualRR,
      outcome,
      exitPrice,
      alert.flow_sentiment,
      alert.unusual_activity ?? false,
      alert.rvol,
      tfConfluenceCount,
      alert.c1_shape,
      JSON.stringify(marketContext),
    ]
  );

  await db.query(
    `UPDATE strat_alerts SET outcome = $1, outcome_recorded_at = NOW() WHERE alert_id = $2`,
    [outcome, alert.alert_id]
  );

  publishStratOutcomeRecorded({
    alertId: alert.alert_id,
    outcome,
    actualRR,
  });

  logger.info('Alert outcome recorded', {
    alert_id: alert.alert_id,
    symbol: alert.symbol,
    outcome,
    actualRR,
  });
}

export class AlertOutcomeTrackerWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(private intervalMs: number = 60_000) {}

  start(): void {
    if (this.timer) return;

    if (!config.enableStratPlanLifecycle) {
      logger.info('AlertOutcomeTrackerWorker skipped: Strat Plan Lifecycle disabled');
      return;
    }

    this.timer = setInterval(() => {
      this.run().catch((err) => logger.error('AlertOutcomeTrackerWorker error', err));
    }, this.intervalMs);

    this.run().catch((err) => logger.error('AlertOutcomeTrackerWorker startup error', err));
    logger.info('AlertOutcomeTrackerWorker started', { intervalMs: this.intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('AlertOutcomeTrackerWorker stopped');
    }
  }

  async run(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      const result = await db.query<AlertRow>(
        `SELECT alert_id, symbol, direction, timeframe, setup, entry, target, stop,
                score, flow_sentiment, unusual_activity, rvol, tf_confluence, c1_shape,
                status, triggered_at, expires_at, max_favorable_excursion, max_adverse_excursion, outcome
         FROM strat_alerts
         WHERE outcome IS NULL AND status IN ('triggered', 'invalidated', 'expired')
         LIMIT 50`
      );

      const alerts = result.rows;
      if (alerts.length === 0) {
        this.isRunning = false;
        return;
      }

      const symbols = [...new Set(alerts.map((r) => r.symbol))];
      const prices: Record<string, number> = {};
      for (const sym of symbols) {
        const p = await getCurrentPrice(sym);
        if (p != null && Number.isFinite(p) && p > 0) prices[sym] = p;
      }

      for (const alert of alerts) {
        const currentPrice = prices[alert.symbol];
        const entry = Number(alert.entry);
        const target = Number(alert.target);
        const stop = Number(alert.stop);
        const isLong = (alert.direction || '').toLowerCase() === 'long';
        const mfePrev = Number(alert.max_favorable_excursion ?? 0);
        const maePrev = Number(alert.max_adverse_excursion ?? 0);

        if (alert.status === 'invalidated') {
          const mfe = 0;
          const mae = isLong ? entry - stop : stop - entry;
          const exitPx = currentPrice ?? stop;
          await recordOutcome(alert, 'invalidated', exitPx, mfe, mae);
          continue;
        }

        if (alert.status === 'expired') {
          const wasTriggered = !!alert.triggered_at;
          if (!wasTriggered) {
            await recordOutcome(alert, 'expired', currentPrice ?? entry, 0, 0);
            continue;
          }
          const targetDistance = Math.abs(target - entry);
          const mfe = mfePrev;
          const mae = maePrev;
          const outcome = mfe > targetDistance * 0.5 ? 'partial_win' : 'expired';
          await recordOutcome(alert, outcome, currentPrice ?? entry, mfe, mae);
          continue;
        }

        if (alert.status === 'triggered' && Number.isFinite(currentPrice)) {
          let mfe = mfePrev;
          let mae = maePrev;

          if (isLong) {
            mfe = Math.max(mfe, currentPrice - entry);
            mae = Math.max(mae, entry - currentPrice);

            if (currentPrice >= target) {
              await recordOutcome(alert, 'target_hit', currentPrice, mfe, mae);
              continue;
            }
            if (currentPrice <= stop) {
              await recordOutcome(alert, 'stop_hit', currentPrice, mfe, mae);
              continue;
            }
          } else {
            mfe = Math.max(mfe, entry - currentPrice);
            mae = Math.max(mae, currentPrice - entry);

            if (currentPrice <= target) {
              await recordOutcome(alert, 'target_hit', currentPrice, mfe, mae);
              continue;
            }
            if (currentPrice >= stop) {
              await recordOutcome(alert, 'stop_hit', currentPrice, mfe, mae);
              continue;
            }
          }

          if (alert.expires_at && new Date() > new Date(alert.expires_at)) {
            const targetDistance = Math.abs(target - entry);
            const outcome = mfe > targetDistance * 0.5 ? 'partial_win' : 'expired';
            await recordOutcome(alert, outcome, currentPrice, mfe, mae);
            continue;
          }

          await db.query(
            `UPDATE strat_alerts SET max_favorable_excursion = $1, max_adverse_excursion = $2 WHERE alert_id = $3`,
            [mfe, mae, alert.alert_id]
          );
        }
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === '42P01') {
        logger.debug('AlertOutcomeTrackerWorker: alert_outcomes table not yet migrated');
      } else {
        logger.error('AlertOutcomeTrackerWorker run failed', { error: err });
      }
    } finally {
      this.isRunning = false;
    }
  }
}
