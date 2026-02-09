// Main server entry point for the dual-engine options trading platform
import { config, validateConfig } from './config/index.js';
import { logger } from './utils/logger.js';
import { app } from './app.js';
import { startWorkers, stopWorkers } from './workers/index.js';
import { db } from './services/database.service.js';
import { featureFlags } from './services/feature-flag.service.js';
import { cache } from './services/cache.service.js';
import { redisCache } from './services/redis-cache.service.js';
import { cacheWarmer } from './services/cache-warmer.service.js';
import { createShutdownHandler } from './utils/shutdown.js';
import { MigrationRunner } from './migrations/runner.js';
import { logConfigSummary } from './utils/config-log.js';
import { createTestingWebSocketServer } from './services/testing-live.service.js';
import { webhookIngestionService } from './services/webhook-ingestion.service.js';
import { startRealtimeWebSocketServer, stopRealtimeWebSocketServer } from './services/realtime-websocket.service.js';

async function bootstrap(): Promise<void> {
  try {
    validateConfig();
    logger.info('Configuration validated successfully');
    logConfigSummary(config);
  } catch (error) {
    logger.error('Configuration validation failed', error);
    process.exit(1);
  }

  if (config.nodeEnv !== 'test' && process.env.SKIP_MIGRATIONS !== 'true') {
    const runner = new MigrationRunner();
    try {
      await runner.connect();
      await runner.migrateUp();
    } finally {
      await runner.close();
    }
  }

  // Initialize Redis cache
  if (config.redisUrl) {
    await redisCache.connect(config.redisUrl);
    await webhookIngestionService.connect();
    // Start cache warmer after Redis is connected
    await cacheWarmer.start();
  } else {
    logger.warn('Redis not configured, caching disabled');
  }

  const server = app.listen(config.port, () => {
    logger.info(`Server started`, {
      port: config.port,
      environment: config.nodeEnv,
      mode: config.appMode,
      variantB: config.enableVariantB ? 'ENABLED' : 'DISABLED',
    });
  });

  createTestingWebSocketServer(server);
  startRealtimeWebSocketServer(server);

  const shutdownHandler = createShutdownHandler({
    server,
    stopWorkers,
    featureFlags,
    db,
    cache,
    redisCache,
    webhookIngestion: webhookIngestionService,
    cacheWarmer,
    logger,
    stopRealtimeWebSocketServer,
  });

  // Register shutdown handlers
  process.on('SIGTERM', () => shutdownHandler('SIGTERM'));
  process.on('SIGINT', () => shutdownHandler('SIGINT'));

  startWorkers();
  featureFlags.init().catch((error) => {
    logger.error('Feature flag service failed to initialize', error);
  });
}

bootstrap().catch((error) => {
  logger.error('Server bootstrap failed', error);
  process.exit(1);
});
