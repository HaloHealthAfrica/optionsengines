// Main server entry point for the dual-engine options trading platform
import { config, validateConfig } from './config/index.js';
import { logger } from './utils/logger.js';
import { app } from './app.js';
import { startWorkers, stopWorkers } from './workers/index.js';
import { db } from './services/database.service.js';
import { featureFlags } from './services/feature-flag.service.js';
import { cache } from './services/cache.service.js';
import { createShutdownHandler } from './utils/shutdown.js';
import { MigrationRunner } from './migrations/runner.js';
import { logConfigSummary } from './utils/config-log.js';

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

  const server = app.listen(config.port, () => {
    logger.info(`Server started`, {
      port: config.port,
      environment: config.nodeEnv,
      mode: config.appMode,
      variantB: config.enableVariantB ? 'ENABLED' : 'DISABLED',
    });
  });

  const shutdownHandler = createShutdownHandler({
    server,
    stopWorkers,
    featureFlags,
    db,
    cache,
    logger,
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
