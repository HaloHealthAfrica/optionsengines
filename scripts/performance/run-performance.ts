import { performance } from 'perf_hooks';
import { db } from '../../src/services/database.service.js';
import { cache } from '../../src/services/cache.service.js';
import { rateLimiter } from '../../src/services/rate-limiter.service.js';
import { logger } from '../../src/utils/logger.js';
import { SignalProcessorWorker } from '../../src/workers/signal-processor.js';
import { OrderCreatorWorker } from '../../src/workers/order-creator.js';
import { PaperExecutorWorker } from '../../src/workers/paper-executor.js';
import { PositionRefresherWorker } from '../../src/workers/position-refresher.js';
import { ExitMonitorWorker } from '../../src/workers/exit-monitor.js';

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function testDbQueryPerformance(): Promise<void> {
  const timings: number[] = [];
  for (let i = 0; i < 50; i += 1) {
    const start = performance.now();
    await db.query('SELECT 1');
    timings.push(performance.now() - start);
  }

  const p95 = percentile(timings, 95);
  logger.info('DB query performance', {
    samples: timings.length,
    p95Ms: Math.round(p95),
  });
}

function testCacheHitRate(): void {
  cache.clear();
  for (let i = 0; i < 200; i += 1) {
    cache.set(`key-${i}`, i);
  }

  for (let i = 0; i < 200; i += 1) {
    cache.get(`key-${i}`);
  }

  const stats = cache.getStats();
  logger.info('Cache hit rate', stats);
}

async function testRateLimiter(): Promise<void> {
  rateLimiter.resetAll();
  const attempts = 50;
  let allowed = 0;
  for (let i = 0; i < attempts; i += 1) {
    if (await rateLimiter.tryAcquire('alpaca')) {
      allowed += 1;
    }
  }

  logger.info('Rate limiter checks', {
    attempts,
    allowed,
    stats: rateLimiter.getStats('alpaca'),
  });
}

async function testWorkerExecution(): Promise<void> {
  const workers = [
    { name: 'signal_processor', instance: new SignalProcessorWorker() },
    { name: 'order_creator', instance: new OrderCreatorWorker() },
    { name: 'paper_executor', instance: new PaperExecutorWorker() },
    { name: 'position_refresher', instance: new PositionRefresherWorker() },
    { name: 'exit_monitor', instance: new ExitMonitorWorker() },
  ];

  for (const worker of workers) {
    const start = performance.now();
    try {
      await worker.instance.run();
      const durationMs = Math.round(performance.now() - start);
      logger.info('Worker execution time', { worker: worker.name, durationMs });
    } catch (error) {
      logger.error('Worker execution failed', error, { worker: worker.name });
    }
  }
}

async function main(): Promise<void> {
  try {
    await testDbQueryPerformance();
  } catch (error) {
    logger.error('DB performance test failed', error);
  }

  testCacheHitRate();
  await testRateLimiter();
  await testWorkerExecution();
}

main().catch((error) => {
  logger.error('Performance checks failed', error);
  process.exit(1);
});
