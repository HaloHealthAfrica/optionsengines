// Webhook Handler - Receives TradingView signals
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../services/database.service.js';
import { authService } from '../services/auth.service.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Webhook payload schema
export const webhookSchema = z
  .object({
    symbol: z.string().min(1).max(20).optional(),
    ticker: z.string().min(1).max(20).optional(),
    action: z.enum(['BUY', 'SELL']).optional(),
    direction: z
      .enum(['long', 'short', 'LONG', 'SHORT', 'CALL', 'PUT', 'BUY', 'SELL'])
      .optional(),
    side: z.string().min(1).max(20).optional(),
    trend: z.string().min(1).max(20).optional(),
    bias: z.string().min(1).max(20).optional(),
    signal: z
      .object({
        type: z.string().min(1).max(20).optional(),
        direction: z.string().min(1).max(20).optional(),
      })
      .optional(),
    timeframe: z.union([z.string().min(1).max(20), z.number()]).optional(),
    tf: z.union([z.string().min(1).max(20), z.number()]).optional(),
    interval: z.union([z.string().min(1).max(20), z.number()]).optional(),
    trigger_timeframe: z.union([z.string().min(1).max(20), z.number()]).optional(),
    triggerTimeframe: z.union([z.string().min(1).max(20), z.number()]).optional(),
    strike: z.number().optional(),
    expiration: z.string().optional(), // ISO date string
    timestamp: z.union([z.string(), z.number()]).optional(),
    secret: z.string().min(1).max(128).optional(),
  })
  .refine((data) => Boolean(data.symbol || data.ticker), {
    message: 'symbol is required',
    path: ['symbol'],
  });

export type WebhookPayload = z.infer<typeof webhookSchema>;

/**
 * Generate signal hash for deduplication
 */
export function generateSignalHash(
  symbol: string,
  direction: 'long' | 'short',
  timeframe: string,
  timestamp: string
): string {
  const hashInput = `${symbol}:${direction}:${timeframe}:${timestamp}`;
  return crypto.createHash('sha256').update(hashInput).digest('hex');
}

/**
 * Check for duplicate signals within time window
 */
export async function isDuplicate(
  ticker: string,
  direction: 'long' | 'short',
  timeframe: string,
  windowSeconds: number = 60
): Promise<boolean> {
  const cutoffTime = new Date(Date.now() - windowSeconds * 1000);

  const result = await db.query(
    `SELECT signal_id FROM signals 
     WHERE symbol = $1 
       AND direction = $2 
       AND timeframe = $3 
       AND created_at > $4 
     LIMIT 1`,
    [ticker, direction.toLowerCase(), timeframe, cutoffTime]
  );

  return result.rows.length > 0;
}

export function normalizeDirection(payload: WebhookPayload): 'long' | 'short' | null {
  const rawDirection =
    payload.direction ??
    payload.side ??
    payload.trend ??
    payload.bias ??
    payload.signal?.type ??
    payload.signal?.direction;
  const normalized = rawDirection?.toString().toLowerCase();

  if (!normalized) {
    if (payload.action === 'BUY') return 'long';
    if (payload.action === 'SELL') return 'short';
    return null;
  }

  if (normalized === 'long' || normalized === 'bull' || normalized === 'bullish' || normalized === 'up') {
    return 'long';
  }
  if (normalized === 'short' || normalized === 'bear' || normalized === 'bearish' || normalized === 'down') {
    return 'short';
  }
  if (normalized === 'call' || normalized === 'buy' || normalized === 'longs') {
    return 'long';
  }
  if (normalized === 'put' || normalized === 'sell' || normalized === 'shorts') {
    return 'short';
  }
  return null;
}

function normalizeTimeframe(payload: WebhookPayload): string | null {
  const raw =
    payload.timeframe ??
    payload.tf ??
    payload.interval ??
    payload.trigger_timeframe ??
    payload.triggerTimeframe;

  if (raw === undefined || raw === null) {
    return null;
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return `${Math.max(1, Math.round(raw))}m`;
  }

  const value = raw.toString().trim().toLowerCase();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    return `${value}m`;
  }

  const normalized = value
    .replace(/minutes?|mins?/g, 'm')
    .replace(/hours?|hrs?/g, 'h')
    .replace(/days?/g, 'd')
    .replace(/weeks?/g, 'w');

  if (/^\d+[mhdw]$/.test(normalized)) {
    return normalized;
  }

  return value;
}

function normalizeTimestamp(raw: WebhookPayload['timestamp']): Date {
  if (raw === undefined || raw === null) {
    return new Date();
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw < 1_000_000_000_000 ? raw * 1000 : raw;
    return new Date(ms);
  }

  const value = raw.toString().trim();
  if (!value) return new Date();

  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    const ms = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    return new Date(ms);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }

  return parsed;
}

export async function handleWebhook(req: Request, res: Response): Promise<Response> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();
  let symbolForLog: string | undefined;
  let directionForLog: 'long' | 'short' | undefined;
  let timeframeForLog: string | undefined;
  let signalIdForLog: string | undefined;
  let experimentIdForLog: string | undefined;
  let variantForLog: 'A' | 'B' | undefined;

  const logWebhookEvent = async (input: {
    status: 'accepted' | 'duplicate' | 'invalid_signature' | 'invalid_payload' | 'error';
    errorMessage?: string;
  }): Promise<void> => {
    try {
      await db.query(
        `INSERT INTO webhook_events (
          request_id,
          signal_id,
          experiment_id,
          variant,
          status,
          error_message,
          symbol,
          direction,
          timeframe,
          processing_time_ms
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          requestId,
          signalIdForLog || null,
          experimentIdForLog || null,
          variantForLog || null,
          input.status,
          input.errorMessage || null,
          symbolForLog || null,
          directionForLog || null,
          timeframeForLog || null,
          Date.now() - startTime,
        ]
      );
    } catch (error) {
      logger.warn('Failed to log webhook event', { requestId, error });
    }
  };

  try {
    // Log incoming request
    const logBody =
      req.body && typeof req.body === 'object' && 'secret' in req.body
        ? { ...req.body, secret: '[REDACTED]' }
        : req.body;
    logger.info('Webhook received', {
      requestId,
      ip: req.ip,
      body: logBody,
    });

    // Validate HMAC signature if provided
    const signature = req.headers['x-webhook-signature'] as string | undefined;
    const hmacEnabled =
      config.hmacSecret &&
      config.hmacSecret !== 'change-this-to-another-secure-random-string-for-webhooks';

    if (hmacEnabled && signature) {
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      const payload = rawBody ? rawBody.toString('utf8') : JSON.stringify(req.body);
      const isValid = authService.verifyHmacSignature(payload, signature);

      if (!isValid) {
        logger.warn('Invalid webhook signature', { requestId });
        await logWebhookEvent({ status: 'invalid_signature', errorMessage: 'Invalid signature' });
        return res.status(401).json({
          status: 'REJECTED',
          error: 'Invalid signature',
          request_id: requestId,
        });
      }
    }

    // Validate payload structure
    const parseResult = webhookSchema.safeParse(req.body);

    if (!parseResult.success) {
      logger.warn('Invalid webhook payload', {
        requestId,
        errors: parseResult.error.errors,
      });
      await logWebhookEvent({ status: 'invalid_payload', errorMessage: 'Invalid payload' });

      return res.status(400).json({
        status: 'REJECTED',
        error: 'Invalid payload',
        details: parseResult.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
        request_id: requestId,
      });
    }

    const payload = parseResult.data;
    const { secret: _secret, ...payloadForStorage } = payload;
    const symbol = payload.symbol ?? payload.ticker;
    symbolForLog = symbol;
    const normalizedTimeframe = normalizeTimeframe(payload);
    timeframeForLog = normalizedTimeframe ?? undefined;
    if (!symbol) {
      await logWebhookEvent({ status: 'invalid_payload', errorMessage: 'Missing symbol' });
      return res.status(400).json({
        status: 'REJECTED',
        error: 'Missing symbol',
        request_id: requestId,
      });
    }

    if (!normalizedTimeframe) {
      await logWebhookEvent({ status: 'invalid_payload', errorMessage: 'Missing or invalid timeframe' });
      return res.status(400).json({
        status: 'REJECTED',
        error: 'Missing or invalid timeframe',
        request_id: requestId,
      });
    }

    // After this check, normalizedTimeframe is guaranteed to be a string
    const timeframe: string = normalizedTimeframe;

    const normalizedDirection = normalizeDirection(payload);

    if (!normalizedDirection) {
      await logWebhookEvent({ status: 'invalid_payload', errorMessage: 'Missing or invalid direction' });
      return res.status(400).json({
        status: 'REJECTED',
        error: 'Missing or invalid direction',
        request_id: requestId,
      });
    }
    directionForLog = normalizedDirection;

    // Check for duplicates
    const duplicate = await isDuplicate(symbol, normalizedDirection, timeframe, 60);

    if (duplicate) {
      logger.info('Duplicate signal detected', {
        requestId,
        ticker: symbol,
        direction: normalizedDirection,
      });

      await logWebhookEvent({ status: 'duplicate' });
      return res.status(200).json({
        status: 'DUPLICATE',
        message: 'Signal already received',
        request_id: requestId,
        processing_time_ms: Date.now() - startTime,
      });
    }

    // Generate signal hash
    const signalTimestamp = normalizeTimestamp(payload.timestamp);
    const signalHash = generateSignalHash(
      symbol,
      normalizedDirection,
      timeframe,
      signalTimestamp.toISOString()
    );

    // Store signal in database
    const result = await db.query(
      `INSERT INTO signals (
        symbol, 
        direction, 
        timeframe, 
        timestamp, 
        status, 
        raw_payload, 
        signal_hash
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING signal_id`,
      [
        symbol,
        normalizedDirection,
        timeframe,
        signalTimestamp,
        'pending',
        JSON.stringify(payloadForStorage),
        signalHash,
      ]
    );

    const signalId = result.rows[0].signal_id;
    signalIdForLog = signalId;
    logger.info('Signal stored successfully', {
      requestId,
      signalId,
      ticker: symbol,
      direction: normalizedDirection,
    });

    // Return success response
    await logWebhookEvent({ status: 'accepted' });
    return res.status(200).json({
      status: 'ACCEPTED',
      signal_id: signalId,
      request_id: requestId,
      processing_time_ms: Date.now() - startTime,
    });
  } catch (error: any) {
    logger.error('Webhook processing failed', error, { requestId });
    await logWebhookEvent({ status: 'error', errorMessage: error?.message || 'Internal server error' });

    return res.status(500).json({
      status: 'ERROR',
      error: 'Internal server error',
      request_id: requestId,
      processing_time_ms: Date.now() - startTime,
    });
  }
}

/**
 * POST /webhook - Receive TradingView signals
 */
router.post('/', (req: Request, res: Response) => {
  handleWebhook(req, res);
});

/**
 * GET /webhook/test - Test endpoint
 */
router.get('/test', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    message: 'Webhook endpoint is ready',
    timestamp: new Date().toISOString(),
  });
});

export default router;
