// Worker orchestration
import { config } from '../config/index.js';
import { SignalProcessorWorker } from './signal-processor.js';
import { OrderCreatorWorker } from './order-creator.js';
import { PaperExecutorWorker } from './paper-executor.js';
import { PositionRefresherWorker } from './position-refresher.js';
import { ExitMonitorWorker } from './exit-monitor.js';
import { logger } from '../utils/logger.js';
import { OrchestratorWorker } from './orchestrator-worker.js';
import { createOrchestratorService } from '../orchestrator/container.js';
import { createEngineAInvoker, createEngineBInvoker } from '../orchestrator/engine-invokers.js';
import { MarketWebhookPipelineWorker } from './market-webhook-pipeline.js';
import { startTradeEngineHeartbeat, stopTradeEngineHeartbeat } from '../services/trade-engine-health.service.js';

const signalProcessor = new SignalProcessorWorker();
const orderCreator = new OrderCreatorWorker();
const paperExecutor = new PaperExecutorWorker();
const positionRefresher = new PositionRefresherWorker();
const exitMonitor = new ExitMonitorWorker();
const orchestrator = new OrchestratorWorker(
  createOrchestratorService({
    engineA: createEngineAInvoker(),
    engineB: createEngineBInvoker(),
  }),
  config.orchestratorIntervalMs
);
const marketWebhookPipeline = new MarketWebhookPipelineWorker();

let workersStarted = false;

export function startWorkers(): void {
  if (workersStarted) {
    return;
  }

  if (config.nodeEnv === 'test') {
    logger.info('Workers disabled in test environment');
    return;
  }

  if (config.enableOrchestrator) {
    orchestrator.start();
  } else {
    signalProcessor.start(config.signalProcessorInterval);
    orderCreator.start(config.orderCreatorInterval);
  }
  if (config.enableMarketWebhookPipeline) {
    marketWebhookPipeline.start();
  }
  paperExecutor.start(config.paperExecutorInterval);
  positionRefresher.start(config.positionRefresherInterval);
  exitMonitor.start(config.exitMonitorInterval);

  workersStarted = true;
  logger.info('All workers started');
  startTradeEngineHeartbeat();
}

export async function stopWorkers(timeoutMs: number = 30000): Promise<void> {
  if (!workersStarted) {
    return;
  }

  await Promise.all([
    config.enableOrchestrator
      ? orchestrator.stopAndDrain(timeoutMs)
      : signalProcessor.stopAndDrain(timeoutMs),
    config.enableOrchestrator
      ? Promise.resolve()
      : orderCreator.stopAndDrain(timeoutMs),
    config.enableMarketWebhookPipeline
      ? marketWebhookPipeline.stopAndDrain(timeoutMs)
      : Promise.resolve(),
    paperExecutor.stopAndDrain(timeoutMs),
    positionRefresher.stopAndDrain(timeoutMs),
    exitMonitor.stopAndDrain(timeoutMs),
  ]);

  workersStarted = false;
  logger.info('All workers stopped');
  stopTradeEngineHeartbeat();
}
