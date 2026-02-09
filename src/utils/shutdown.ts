import { logger as defaultLogger } from './logger.js';

type ServerLike = {
  close: (cb?: () => void) => void;
};

type ShutdownDeps = {
  server: ServerLike;
  stopWorkers: (timeoutMs?: number) => Promise<void>;
  featureFlags: { stop: () => void };
  db: { close: () => Promise<void> };
  cache: { close: () => void };
  redisCache?: { disconnect: () => Promise<void> };
  webhookIngestion?: { disconnect: () => Promise<void> };
  cacheWarmer?: { stop: () => Promise<void> };
  stopRealtimeWebSocketServer?: () => void;
  logger?: typeof defaultLogger;
  exit?: (code: number) => void;
  timeoutMs?: number;
  workerTimeoutMs?: number;
};

export function createShutdownHandler(deps: ShutdownDeps) {
  const logger = deps.logger ?? defaultLogger;
  const exit = deps.exit ?? process.exit;
  const timeoutMs = deps.timeoutMs ?? 30000;
  const workerTimeoutMs = deps.workerTimeoutMs ?? timeoutMs;
  let isShuttingDown = false;

  return async (signal: string): Promise<void> => {
    if (isShuttingDown) {
      logger.warn('Shutdown already in progress, forcing exit');
      exit(1);
      return;
    }

    isShuttingDown = true;
    logger.info(`Received ${signal}, starting graceful shutdown`);

    deps.server.close(() => {
      logger.info('HTTP server closed');
    });

    const shutdownTimeout = setTimeout(() => {
      logger.error('Shutdown timeout reached, forcing exit');
      exit(1);
    }, timeoutMs);

    try {
      await deps.stopWorkers(workerTimeoutMs);
      deps.featureFlags.stop();
      if (deps.cacheWarmer) {
        await deps.cacheWarmer.stop();
      }
      await deps.db.close();
      deps.cache.close();
      if (deps.redisCache) {
        await deps.redisCache.disconnect();
      }
      if (deps.webhookIngestion) {
        await deps.webhookIngestion.disconnect();
      }
      if (deps.stopRealtimeWebSocketServer) {
        deps.stopRealtimeWebSocketServer();
      }
      clearTimeout(shutdownTimeout);
      logger.info('Graceful shutdown completed');
      exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error);
      clearTimeout(shutdownTimeout);
      exit(1);
    }
  };
}
