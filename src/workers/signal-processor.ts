// Signal Processor Worker - Enriches signals and applies risk checks
import { db } from '../services/database.service.js';
import { marketData } from '../services/market-data.js';
import { positioningService } from '../services/positioning.service.js';
import { logger } from '../utils/logger.js';
import { config } from '../config/index.js';
import { Signal } from '../types/index.js';
import { sleep } from '../utils/sleep.js';
import { errorTracker } from '../services/error-tracker.service.js';

export class SignalProcessorWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  start(intervalMs: number): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.run().catch((error) => {
        logger.error('Signal processor worker failed', error);
      });
    }, intervalMs);

    // Run immediately on startup
    this.run().catch((error) => {
      logger.error('Signal processor worker failed on startup', error);
    });

    logger.info('Signal processor worker started', { intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('Signal processor worker stopped');
    }
  }

  async stopAndDrain(timeoutMs: number): Promise<void> {
    this.stop();
    const startedAt = Date.now();
    while (this.isRunning && Date.now() - startedAt < timeoutMs) {
      await sleep(50);
    }
    if (this.isRunning) {
      logger.warn('Signal processor did not stop before timeout');
    }
  }

  async run(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Signal processor already running, skipping');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      const pendingSignals = await db.query<Signal>(
        `SELECT * FROM signals WHERE status = $1 ORDER BY created_at ASC LIMIT 100`,
        ['pending']
      );

      if (pendingSignals.rows.length === 0) {
        return;
      }

      let approved = 0;
      let rejected = 0;

      for (const signal of pendingSignals.rows) {
        const riskResult: Record<string, any> = {};
        let rejectionReason: string | null = null;

        try {
          const isMarketOpen = await marketData.isMarketOpen();
          riskResult.marketOpen = isMarketOpen;
          if (!isMarketOpen) {
            rejectionReason = 'market_closed';
          }

          const riskLimits = await db.query(
            `SELECT * FROM risk_limits WHERE enabled = true ORDER BY created_at DESC LIMIT 1`
          );
          const riskLimit = riskLimits.rows[0] || {};

          const openPositionsResult = await db.query(
            `SELECT COUNT(*)::int AS count FROM refactored_positions WHERE status IN ('open', 'closing')`
          );
          const openPositions = openPositionsResult.rows[0]?.count || 0;

          const openSymbolPositionsResult = await db.query(
            `SELECT COUNT(*)::int AS count FROM refactored_positions 
             WHERE status IN ('open', 'closing') AND symbol = $1`,
            [signal.symbol]
          );
          const openSymbolPositions = openSymbolPositionsResult.rows[0]?.count || 0;

          riskResult.openPositions = openPositions;
          riskResult.openSymbolPositions = openSymbolPositions;
          riskResult.maxOpenPositions = config.maxOpenPositions;
          riskResult.maxPositionsPerSymbol = riskLimit.max_positions_per_symbol || 0;

          if (!rejectionReason && openPositions >= config.maxOpenPositions) {
            rejectionReason = 'max_open_positions_exceeded';
          }

          if (
            !rejectionReason &&
            riskLimit.max_positions_per_symbol &&
            openSymbolPositions >= riskLimit.max_positions_per_symbol
          ) {
            rejectionReason = 'max_positions_per_symbol_exceeded';
          }

          const candles = await marketData.getCandles(signal.symbol, signal.timeframe, 200);
          const indicators = await marketData.getIndicators(signal.symbol, signal.timeframe);
          const currentPrice = await marketData.getStockPrice(signal.symbol);

          let gexData = null;
          let optionsFlow = null;
          try {
            gexData = await positioningService.getGexSnapshot(signal.symbol);
          } catch (error) {
            logger.warn('GEX data unavailable for signal', { error, symbol: signal.symbol });
          }
          try {
            optionsFlow = await positioningService.getOptionsFlowSnapshot(signal.symbol, 50);
          } catch (error) {
            logger.warn('Options flow data unavailable for signal', { error, symbol: signal.symbol });
          }

          const enrichedData = {
            symbol: signal.symbol,
            timeframe: signal.timeframe,
            currentPrice,
            indicators,
            candlesCount: candles.length,
            gex: gexData,
            optionsFlow,
          };

          if (rejectionReason) {
            await db.query(
              `UPDATE signals SET status = $1 WHERE signal_id = $2`,
              ['rejected', signal.signal_id]
            );

            await db.query(
              `INSERT INTO refactored_signals (signal_id, enriched_data, risk_check_result, rejection_reason)
               VALUES ($1, $2, $3, $4)`,
              [signal.signal_id, JSON.stringify(enrichedData), JSON.stringify(riskResult), rejectionReason]
            );

            rejected += 1;
          } else {
            await db.query(
              `UPDATE signals SET status = $1 WHERE signal_id = $2`,
              ['approved', signal.signal_id]
            );

            await db.query(
              `INSERT INTO refactored_signals (signal_id, enriched_data, risk_check_result)
               VALUES ($1, $2, $3)`,
              [signal.signal_id, JSON.stringify(enrichedData), JSON.stringify(riskResult)]
            );

            approved += 1;
          }
        } catch (error) {
          logger.error('Signal processing failed', error, { signalId: signal.signal_id });
          errorTracker.recordError('signal_processor');
          await db.query(
            `UPDATE signals SET status = $1 WHERE signal_id = $2`,
            ['rejected', signal.signal_id]
          );
          await db.query(
            `INSERT INTO refactored_signals (signal_id, enriched_data, risk_check_result, rejection_reason)
             VALUES ($1, $2, $3, $4)`,
            [signal.signal_id, null, JSON.stringify(riskResult), 'processing_error']
          );
          rejected += 1;
        }
      }

      logger.info('Signal processing completed', {
        approved,
        rejected,
        durationMs: Date.now() - startTime,
      });
    } finally {
      this.isRunning = false;
    }
  }
}
