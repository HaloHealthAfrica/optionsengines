// Webhook Handler - Receives TradingView signals
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../services/database.service.js';
import { authService } from '../services/auth.service.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

const router = Router();

const MAX_PAYLOAD_BYTES = 128 * 1024; // 128KB
const MAX_RAW_PAYLOAD_BYTES = 32 * 1024; // 32KB for DB storage

function safeStringifyForPayload(obj: unknown, maxBytes: number): string {
  try {
    const str = JSON.stringify(obj ?? null);
    if (Buffer.byteLength(str, 'utf8') <= maxBytes) return str;
    return JSON.stringify({ _truncated: true, _preview: str.slice(0, 500) + '...' });
  } catch {
    return 'null';
  }
}

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
    price: z.number().optional(),
    indicators: z.record(z.any()).optional(),
    is_test: z.boolean().optional(),
    test_session_id: z.string().min(1).max(128).optional(),
    test_scenario: z.string().min(1).max(128).optional(),
    sequence_number: z.number().int().positive().optional(),
    metadata: z
      .object({
        is_test: z.boolean().optional(),
        test_session_id: z.string().min(1).max(128).optional(),
        test_scenario: z.string().min(1).max(128).optional(),
        sequence_number: z.number().int().positive().optional(),
      })
      .optional(),
    secret: z.string().min(1).max(128).optional(),
  })
  .passthrough()
  .refine((data) => {
    const d = data as Record<string, unknown>;
    return Boolean(d.symbol || d.ticker || (d.meta as Record<string, unknown> | undefined)?.ticker);
  }, {
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
  windowSeconds: number = 60,
  isTest: boolean = false
): Promise<boolean> {
  const cutoffTime = new Date(Date.now() - windowSeconds * 1000);

  const result = await db.query(
    `SELECT signal_id FROM signals 
     WHERE symbol = $1 
       AND direction = $2 
       AND timeframe = $3 
       AND created_at > $4 
       AND COALESCE(is_test, false) = $5
     LIMIT 1`,
    [ticker, direction.toLowerCase(), timeframe, cutoffTime, isTest]
  );

  return result.rows.length > 0;
}

type DirectionCandidate = string | null | undefined;

function detectIndicatorSource(payload: WebhookPayload): string {
  const metaEngine = (payload as any)?.meta?.engine;
  const journalEngine = (payload as any)?.journal?.engine;
  if (metaEngine === 'SATY_PO') return 'SATY_PHASE';
  if (journalEngine === 'STRAT_V6_FULL') return 'STRAT';
  if ((payload as any)?.timeframes && (payload as any)?.bias && (payload as any)?.ticker) return 'TREND';
  if ((payload as any)?.indicator && ['ORB', 'Stretch', 'BHCH', 'EMA'].includes((payload as any)?.indicator)) {
    return 'ORB';
  }
  if ((payload as any)?.trend && (payload as any)?.score !== undefined && (payload as any)?.signal) {
    return 'SIGNALS';
  }
  return 'UNKNOWN / GENERIC_TV';
}

function extractDirectionCandidate(payload: WebhookPayload): DirectionCandidate {
  const anyPayload = payload as Record<string, unknown>;
  const signal = anyPayload.signal as Record<string, unknown> | undefined;
  const pattern = signal?.pattern ?? anyPayload.pattern;
  const patternStr = typeof pattern === 'string' ? pattern.toLowerCase() : '';
  if (patternStr.includes('bear') || patternStr.includes('short')) return 'short';
  if (patternStr.includes('bull') || patternStr.includes('long')) return 'long';

  const raw =
    payload.direction ??
    payload.side ??
    payload.trend ??
    payload.bias ??
    payload.signal?.type ??
    payload.signal?.direction ??
    (anyPayload.signal as Record<string, unknown> | undefined)?.side ??
    (anyPayload.regime_context as Record<string, unknown> | undefined)?.local_bias ??
    (anyPayload.execution_guidance as Record<string, unknown> | undefined)?.bias ??
    anyPayload.order_action ??
    (anyPayload.strategy as Record<string, unknown> | undefined)?.order_action ??
    anyPayload.action ??
    (anyPayload.event as Record<string, unknown> | undefined)?.phase_name ??
    (anyPayload.market as Record<string, unknown> | undefined)?.market_bias ??
    (anyPayload.market as Record<string, unknown> | undefined)?.spy_trend ??
    (anyPayload.market as Record<string, unknown> | undefined)?.qqq_trend ??
    (anyPayload.candle as Record<string, unknown> | undefined)?.pattern_bias;
  return raw as DirectionCandidate;
}

export function normalizeDirection(payload: WebhookPayload): 'long' | 'short' | null {
  const rawDirection = extractDirectionCandidate(payload);
  const normalized = rawDirection?.toString().trim().toLowerCase();

  if (!normalized) {
    if (payload.action === 'BUY') return 'long';
    if (payload.action === 'SELL') return 'short';
    return null;
  }

  if (['long', 'bull', 'bullish', 'up', 'buy', 'call', 'markup', 'breakout'].includes(normalized)) {
    return 'long';
  }
  if (['short', 'bear', 'bearish', 'down', 'sell', 'put', 'markdown', 'breakdown'].includes(normalized)) {
    return 'short';
  }

  return null;
}

function normalizeTimeframe(payload: WebhookPayload): string | null {
  const anyPayload = payload as Record<string, unknown>;
  const raw =
    payload.timeframe ??
    payload.tf ??
    payload.interval ??
    payload.trigger_timeframe ??
    payload.triggerTimeframe ??
    (anyPayload.meta as Record<string, unknown> | undefined)?.timeframe;

  if (raw === undefined || raw === null) {
    // Fallback: session "OPEN" = daily, "PRE"/"POST" = daily
    const session = String(anyPayload.session ?? '').toUpperCase();
    if (['OPEN', 'PRE', 'POST', 'REGULAR'].includes(session)) return '1d';
    // Fallback: Adaptive Strat / strat_details style payloads → daily
    if (anyPayload.strat_details && typeof anyPayload.strat_details === 'object') return '1d';
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

type TestMetadata = {
  isTest: boolean;
  testSessionId: string | null;
  testScenario: string | null;
  sequenceNumber: number | null;
};

function extractTestMetadata(payload: WebhookPayload): TestMetadata {
  const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};
  const isTest = Boolean(
    (payload as WebhookPayload & { is_test?: boolean }).is_test ?? (metadata as any).is_test
  );
  const testSessionId =
    (payload as WebhookPayload & { test_session_id?: string }).test_session_id ??
    (metadata as any).test_session_id ??
    null;
  const testScenario =
    (payload as WebhookPayload & { test_scenario?: string }).test_scenario ??
    (metadata as any).test_scenario ??
    null;
  const sequenceNumber =
    (payload as WebhookPayload & { sequence_number?: number }).sequence_number ??
    (metadata as any).sequence_number ??
    null;

  return {
    isTest,
    testSessionId,
    testScenario,
    sequenceNumber,
  };
}

export async function processWebhookPayload(input: {
  payload: unknown;
  signature?: string;
  ip?: string;
  rawBody?: Buffer;
  requestId?: string;
}): Promise<{
  httpStatus: number;
  response: Record<string, any>;
  status: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED' | 'ERROR';
  requestId: string;
}> {
  const startTime = Date.now();
  const requestId = input.requestId || crypto.randomUUID();
  let symbolForLog: string | undefined;
  let directionForLog: 'long' | 'short' | undefined;
  let timeframeForLog: string | undefined;
  let signalIdForLog: string | undefined;
  let experimentIdForLog: string | undefined;
  let variantForLog: 'A' | 'B' | undefined;
  let testMetaForLog: TestMetadata | null = null;
  let webhookEventId: string | null = null;
  let logBody: unknown = null;

  const logWebhookEvent = async (input: {
    status: 'accepted' | 'duplicate' | 'invalid_signature' | 'invalid_payload' | 'error';
    errorMessage?: string;
  }): Promise<void> => {
    try {
      const result = await db.query(
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
          processing_time_ms,
          is_test,
          test_session_id,
          test_scenario,
          raw_payload
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        RETURNING event_id`,
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
          testMetaForLog?.isTest || false,
          testMetaForLog?.testSessionId || null,
          testMetaForLog?.testScenario || null,
          safeStringifyForPayload(logBody, MAX_RAW_PAYLOAD_BYTES),
        ]
      );
      webhookEventId = result.rows[0]?.event_id || webhookEventId;
    } catch (error) {
      logger.warn('Failed to log webhook event', { requestId, error });
    }
  };

  try {
    // Reject oversized payloads early
    if (input.rawBody && input.rawBody.length > MAX_PAYLOAD_BYTES) {
      logger.warn('Webhook payload too large', { requestId, bytes: input.rawBody.length, maxBytes: MAX_PAYLOAD_BYTES });
      await logWebhookEvent({ status: 'invalid_payload', errorMessage: 'Payload too large' });
      return {
        httpStatus: 413,
        status: 'REJECTED',
        requestId,
        response: {
          status: 'REJECTED',
          error: 'Payload too large',
          request_id: requestId,
          webhook_event_id: webhookEventId,
        },
      };
    }

    // Log incoming request (wrap in try/catch to avoid logging failures from crashing)
    logBody =
      input.payload && typeof input.payload === 'object' && 'secret' in (input.payload as Record<string, any>)
        ? { ...(input.payload as Record<string, any>), secret: '[REDACTED]' }
        : input.payload;
    try {
      logger.info('Webhook received', {
        requestId,
        ip: input.ip,
        body: logBody,
      });
    } catch (logErr) {
      logger.warn('Failed to log webhook body', { requestId, error: logErr });
    }

    // Validate HMAC signature if provided
    const signature = input.signature;
    const hmacEnabled =
      config.hmacSecret &&
      config.hmacSecret !== 'change-this-to-another-secure-random-string-for-webhooks';

    if (hmacEnabled && signature) {
      const rawBody = input.rawBody;
      const payload = rawBody ? rawBody.toString('utf8') : JSON.stringify(input.payload);
      const isValid = authService.verifyHmacSignature(payload, signature);

      if (!isValid) {
        logger.warn('Invalid webhook signature', { requestId });
        await logWebhookEvent({ status: 'invalid_signature', errorMessage: 'Invalid signature' });
        return {
          httpStatus: 401,
          status: 'REJECTED',
          requestId,
          response: {
            status: 'REJECTED',
            error: 'Invalid signature',
            request_id: requestId,
            webhook_event_id: webhookEventId,
          },
        };
      }
    }

    // Validate payload structure
    const parseResult = webhookSchema.safeParse(input.payload);

    if (!parseResult.success) {
      logger.warn('Invalid webhook payload', {
        requestId,
        errors: parseResult.error.errors,
      });
      await logWebhookEvent({ status: 'invalid_payload', errorMessage: 'Invalid payload' });

      return {
        httpStatus: 400,
        status: 'REJECTED',
        requestId,
        response: {
          status: 'REJECTED',
          error: 'Invalid payload',
          details: parseResult.error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
          request_id: requestId,
          webhook_event_id: webhookEventId,
        },
      };
    }

    const payload = parseResult.data;
    const { secret: _secret, ...payloadForStorage } = payload;
    testMetaForLog = extractTestMetadata(payload);
    const symbol = payload.symbol ?? payload.ticker ?? (payload as { meta?: { ticker?: string } }).meta?.ticker;
    symbolForLog = symbol;
    const normalizedTimeframe = normalizeTimeframe(payload);
    timeframeForLog = normalizedTimeframe ?? undefined;
    if (!symbol) {
      await logWebhookEvent({ status: 'invalid_payload', errorMessage: 'Missing symbol' });
      return {
        httpStatus: 400,
        status: 'REJECTED',
        requestId,
        response: {
          status: 'REJECTED',
          error: 'Missing symbol',
          request_id: requestId,
          webhook_event_id: webhookEventId,
        },
      };
    }

    if (!normalizedTimeframe) {
      await logWebhookEvent({ status: 'invalid_payload', errorMessage: 'Missing or invalid timeframe' });
      return {
        httpStatus: 400,
        status: 'REJECTED',
        requestId,
        response: {
          status: 'REJECTED',
          error: 'Missing or invalid timeframe',
          request_id: requestId,
          webhook_event_id: webhookEventId,
        },
      };
    }

    // After this check, normalizedTimeframe is guaranteed to be a string
    const timeframe: string = normalizedTimeframe;

    const normalizedDirection = normalizeDirection(payload);

    if (!normalizedDirection) {
      logger.warn('Missing or invalid direction', {
        requestId,
        detected_source: detectIndicatorSource(payload),
        direction_candidate: extractDirectionCandidate(payload) ?? null,
        payload_keys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
      });
      await logWebhookEvent({ status: 'invalid_payload', errorMessage: 'Missing or invalid direction' });
      return {
        httpStatus: 400,
        status: 'REJECTED',
        requestId,
        response: {
          status: 'REJECTED',
          error: 'Missing or invalid direction',
          request_id: requestId,
          webhook_event_id: webhookEventId,
        },
      };
    }
    directionForLog = normalizedDirection;

    // Check for duplicates
    const duplicate = await isDuplicate(symbol, normalizedDirection, timeframe, 60, testMetaForLog?.isTest || false);

    if (duplicate) {
      logger.info('Duplicate signal detected', {
        requestId,
        ticker: symbol,
        direction: normalizedDirection,
      });

      await logWebhookEvent({ status: 'duplicate' });
      return {
        httpStatus: 200,
        status: 'DUPLICATE',
        requestId,
        response: {
          status: 'DUPLICATE',
          message: 'Signal already received',
          request_id: requestId,
          processing_time_ms: Date.now() - startTime,
          webhook_event_id: webhookEventId,
          test_session_id: testMetaForLog?.testSessionId || null,
        },
      };
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
        signal_hash,
        is_test,
        test_session_id,
        test_scenario
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING signal_id`,
      [
        symbol,
        normalizedDirection,
        timeframe,
        signalTimestamp,
        'pending',
        JSON.stringify(payloadForStorage),
        signalHash,
        testMetaForLog?.isTest || false,
        testMetaForLog?.testSessionId || null,
        testMetaForLog?.testScenario || null,
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
    return {
      httpStatus: 200,
      status: 'ACCEPTED',
      requestId,
      response: {
        status: 'ACCEPTED',
        signal_id: signalId,
        request_id: requestId,
        processing_time_ms: Date.now() - startTime,
        webhook_event_id: webhookEventId,
        test_session_id: testMetaForLog?.testSessionId || null,
        is_test: testMetaForLog?.isTest || false,
      },
    };
  } catch (error: any) {
    logger.error('Webhook processing failed', error, { requestId });
    await logWebhookEvent({ status: 'error', errorMessage: error?.message || 'Internal server error' });

    return {
      httpStatus: 500,
      status: 'ERROR',
      requestId,
      response: {
        status: 'ERROR',
        error: 'Internal server error',
        request_id: requestId,
        processing_time_ms: Date.now() - startTime,
        webhook_event_id: webhookEventId,
      },
    };
  }
}

export async function handleWebhook(req: Request, res: Response): Promise<Response> {
  const result = await processWebhookPayload({
    payload: req.body,
    signature: req.headers['x-webhook-signature'] as string | undefined,
    ip: req.ip,
    rawBody: (req as Request & { rawBody?: Buffer }).rawBody,
  });
  return res.status(result.httpStatus).json(result.response);
}

/**
 * POST /webhook - Receive TradingView signals and MTF Bias payloads
 * V3 (source=MTF_BIAS_ENGINE_V3) → BiasStateAggregator
 * Legacy BIAS_SNAPSHOT → handleMTFBiasWebhook (V1 pipeline)
 */
router.post('/', async (req: Request, res: Response) => {
  const body = req.body;
  if (body && typeof body === 'object' && typeof body.event_id_raw === 'string') {
    const { shouldRouteToV3, update } = await import(
      '../services/bias-state-aggregator/bias-state-aggregator.service.js'
    );
    if (shouldRouteToV3(body)) {
      const result = await update(body);
      if (result.ok) {
        return res.status(200).json({
          success: true,
          event_id: result.eventId,
          symbol: result.state?.symbol ?? (body as { symbol?: string }).symbol,
          status: result.status,
        });
      }
      if (result.status === 422) {
        return res.status(422).json({ error: result.error, details: result.details });
      }
      if (result.status === 400) {
        return res.status(400).json({ error: result.error, details: result.details });
      }
      return res.status(500).json({ error: result.error });
    }
    if (body.event_type === 'BIAS_SNAPSHOT') {
      const { handleMTFBiasWebhook } = await import(
        '../services/mtf-bias-webhook-handler.service.js'
      );
      const result = await handleMTFBiasWebhook(body);
      if (result.ok) {
        return res.status(200).json({
          success: true,
          event_id: result.eventId,
          symbol: result.symbol,
          status: result.status,
        });
      }
      if (result.status === 422) {
        return res.status(422).json({ error: result.error, details: result.details });
      }
      return res.status(500).json({ error: result.error });
    }
  }
  return handleWebhook(req, res);
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
