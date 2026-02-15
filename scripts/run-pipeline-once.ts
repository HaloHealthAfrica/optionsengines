#!/usr/bin/env npx tsx
/**
 * Run full pipeline once: Orchestrator → Order Creator → Paper Executor
 *
 * Runs directly against the database (no HTTP). Use when you want to process
 * pending signals immediately without waiting for workers.
 *
 * Usage:
 *   npx tsx scripts/run-pipeline-once.ts
 *
 * Env: DATABASE_URL (from .env)
 */

import 'dotenv/config';
import { config } from '../src/config/index.js';
import { createOrchestratorService } from '../src/orchestrator/container.js';
import { createEngineAInvoker, createEngineBInvoker } from '../src/orchestrator/engine-invokers.js';
import { OrderCreatorWorker } from '../src/workers/order-creator.js';
import { PaperExecutorWorker } from '../src/workers/paper-executor.js';
import { PositionRefresherWorker } from '../src/workers/position-refresher.js';
import { ExitMonitorWorker } from '../src/workers/exit-monitor.js';

async function run(): Promise<void> {
  console.log('═'.repeat(60));
  console.log('  Full Pipeline: Orchestrator → Order Creator → Paper Executor');
  console.log('═'.repeat(60));

  const batchSize = config.orchestratorBatchSize ?? 10;
  const orchestrator = createOrchestratorService({
    engineA: createEngineAInvoker(),
    engineB: createEngineBInvoker(),
  });

  const orderCreator = new OrderCreatorWorker();
  const paperExecutor = new PaperExecutorWorker();
  const positionRefresher = new PositionRefresherWorker();
  const exitMonitor = new ExitMonitorWorker();

  const start = Date.now();

  try {
    console.log('\n1. Orchestrator (process pending signals)...');
    const results = await orchestrator.processSignals(batchSize, undefined, {
      concurrency: config.orchestratorConcurrency ?? 1,
      timeoutMs: config.orchestratorSignalTimeoutMs ?? 30000,
      retryDelayMs: config.orchestratorRetryDelayMs ?? 60000,
    });
    console.log(`   Processed: ${results.length} signals`);

    console.log('\n2. Order Creator...');
    await orderCreator.run();
    console.log('   Done');

    console.log('\n3. Paper Executor...');
    await paperExecutor.run();
    console.log('   Done');

    console.log('\n4. Position Refresher...');
    await positionRefresher.run();
    console.log('   Done');

    console.log('\n5. Exit Monitor...');
    await exitMonitor.run();
    console.log('   Done');

    const duration = ((Date.now() - start) / 1000).toFixed(1);
    console.log('\n' + '═'.repeat(60));
    console.log(`  Completed in ${duration}s`);
    console.log('═'.repeat(60));
  } catch (err) {
    console.error('\nPipeline failed:', err);
    process.exit(1);
  }
}

run();
