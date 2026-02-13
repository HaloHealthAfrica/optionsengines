import * as Sentry from '@sentry/node';
import { db } from './database.service.js';
import { redisCache } from './redis-cache.service.js';
import { logger } from '../utils/logger.js';

type WorkerStatus = {
  running: boolean;
  lastRunAt?: Date;
  lastDurationMs?: number;
  lastErrorAt?: Date;
  backoffMs?: number;
};

const workerStatus = new Map<string, WorkerStatus>();
let lastSignalProcessedAt: Date | null = null;
let lastSignalId: string | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

const heartbeatIntervalMs = Number(process.env.TRADE_ENGINE_HEARTBEAT_MS ?? 60000);
const idleMinutes = Number(process.env.TRADE_ENGINE_IDLE_MINUTES ?? 2);
const stallMinutes = Number(process.env.TRADE_ENGINE_STALL_MINUTES ?? 5);

export function setLastSignalProcessed(signalId: string | null, timestamp: Date = new Date()): void {
  lastSignalProcessedAt = timestamp;
  lastSignalId = signalId;
}

export function updateWorkerStatus(name: string, update: Partial<WorkerStatus>): void {
  const existing = workerStatus.get(name) || { running: false };
  workerStatus.set(name, { ...existing, ...update });
}

async function getQueueDepth(): Promise<number | null> {
  try {
    const result = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM signals
       WHERE processed = FALSE
         AND processing_lock = FALSE
         AND (status IS NULL OR status = 'pending')
         AND (queued_until IS NULL OR queued_until <= NOW())
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())`
    );
    return result.rows[0]?.count ?? 0;
  } catch (error) {
    logger.warn('Failed to fetch queue depth for heartbeat', { error });
    Sentry.captureException(error, { tags: { stage: 'health', step: 'queue_depth' } });
    return null;
  }
}

export function startTradeEngineHeartbeat(): void {
  if (heartbeatTimer) {
    return;
  }

  heartbeatTimer = setInterval(async () => {
    const now = new Date();
    const queueDepth = await getQueueDepth();
    const dbStatus = db.getConnectionStatus();
    const redisAvailable = redisCache.isAvailable();

    const lastProcessedAgeMin = lastSignalProcessedAt
      ? (now.getTime() - lastSignalProcessedAt.getTime()) / 60000
      : null;

    logger.debug('Trade engine heartbeat', {
      queueDepth,
      dbConnected: dbStatus.connected,
      redisAvailable,
      lastProcessedAgeMin,
      lastSignalId,
    });

    const isStalled =
      lastProcessedAgeMin !== null &&
      lastProcessedAgeMin >= stallMinutes &&
      (queueDepth ?? 0) > 0;

    if (isStalled) {
      logger.warn('Trade engine stalled - queue has pending signals but no processing', {
        lastProcessedAgeMin,
        queueDepth,
        lastSignalProcessedAt: lastSignalProcessedAt?.toISOString() ?? null,
      });
    } else if (
      lastProcessedAgeMin !== null &&
      lastProcessedAgeMin >= idleMinutes &&
      (queueDepth ?? 0) === 0
    ) {
      logger.debug('Trade engine idle', { lastProcessedAgeMin, queueDepth });
    }
  }, Number.isFinite(heartbeatIntervalMs) ? heartbeatIntervalMs : 60000);

  logger.info('Trade engine heartbeat started', { heartbeatIntervalMs });
}

export function stopTradeEngineHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}
