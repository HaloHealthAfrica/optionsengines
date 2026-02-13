import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { processWebhookPayload, webhookSchema } from './webhook.js';
import {
  buildTestWebhookPayload,
  generateIndicators,
  generateRealisticPrice,
  TEST_SIGNAL_TYPES,
  TEST_SYMBOLS,
  TEST_TIMEFRAMES,
  TestWebhookFormat,
  TestSignalType,
} from '../services/testing-webhook.service.js';
import { ensureTestSession, getTestSessionSummary, markTestSessionCompleted, clearTestSession } from '../services/testing-session.service.js';
import { authService } from '../services/auth.service.js';
import { runTradeAudit } from '../services/trade-audit.service.js';

const router = Router();
const testRateLimit = new Map<string, { count: number; resetAt: number }>();
const TEST_LIMIT = 200;
const TEST_WINDOW_MS = 60 * 60 * 1000;

type AuthPayload = {
  userId: string;
  email: string;
  role: 'admin' | 'researcher' | 'user';
};

function requireAuth(req: Request, res: Response, next: NextFunction): Response | void {
  const token = authService.extractTokenFromHeader(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = authService.verifyToken(token) as AuthPayload | null;
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  (req as Request & { user?: AuthPayload }).user = payload;
  return next();
}

function requireTestingAccess(_req: Request, _res: Response, next: NextFunction): Response | void {
  return next();
}

function requireTestingRateLimit(req: Request, res: Response, next: NextFunction): Response | void {
  const user = (req as Request & { user?: AuthPayload }).user;
  const key = user?.userId || user?.email || 'anonymous';
  const now = Date.now();
  const record = testRateLimit.get(key);

  if (!record || record.resetAt < now) {
    testRateLimit.set(key, { count: 1, resetAt: now + TEST_WINDOW_MS });
    return next();
  }

  if (record.count >= TEST_LIMIT) {
    return res.status(429).json({
      error: 'Rate limit exceeded',
      limit: TEST_LIMIT,
      reset_at: new Date(record.resetAt).toISOString(),
    });
  }

  record.count += 1;
  return next();
}

const singleSchema = z.object({
  symbol: z.string().min(1),
  timeframe: z.string().min(1),
  signal_type: z.enum(TEST_SIGNAL_TYPES),
  format: z.enum(['ultimate_options', 'trend_start', 'dots_indicator', 'market_context']).optional(),
  price: z.number().optional(),
  indicators: z.record(z.any()).optional(),
  is_test: z.boolean().optional(),
  test_session_id: z.string().min(1).optional(),
  test_scenario: z.string().min(1).optional(),
  sequence_number: z.number().int().positive().optional(),
});

const batchSchema = z.object({
  scenario: z.string().optional(),
  symbols: z.array(z.string()).min(1).optional(),
  timeframes: z.array(z.string()).min(1).optional(),
  signal_types: z.array(z.enum(TEST_SIGNAL_TYPES)).min(1).optional(),
  format: z.enum(['ultimate_options', 'trend_start', 'dots_indicator', 'market_context']).optional(),
  count: z.number().int().positive().max(500),
  timing: z.enum(['immediate', 'realistic', 'rapid']).optional(),
  interval_seconds: z.number().positive().optional(),
  realistic_prices: z.boolean().optional(),
  distribution: z.record(z.number()).optional(),
  test_session_id: z.string().min(1).optional(),
});

const customSchema = z.object({
  custom_payload: z.record(z.any()),
  validation_mode: z.enum(['strict', 'lenient', 'none']).optional(),
  test_session_id: z.string().min(1).optional(),
});

const batchCustomSchema = z.object({
  webhooks: z.array(z.record(z.any())).min(1).max(100),
  validation_mode: z.enum(['strict', 'lenient', 'none']).optional(),
  test_session_id: z.string().min(1).optional(),
  timing: z.enum(['immediate', 'realistic']).optional(),
});

function pickRandom<T>(values: T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

function pickSymbolWithDistribution(symbols: string[], distribution?: Record<string, number>): string {
  if (!distribution) {
    return pickRandom(symbols);
  }
  const normalized = symbols
    .map((symbol) => ({ symbol, weight: Math.max(0, distribution[symbol] || 0) }))
    .filter((row) => row.weight > 0);
  const total = normalized.reduce((sum, row) => sum + row.weight, 0);
  if (!total) return pickRandom(symbols);
  let roll = Math.random() * total;
  for (const row of normalized) {
    roll -= row.weight;
    if (roll <= 0) return row.symbol;
  }
  return normalized[0].symbol;
}

function validationResult(payload: Record<string, any>) {
  const parsed = webhookSchema.safeParse(payload);
  const errors = parsed.success
    ? []
    : parsed.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`);
  const warnings: string[] = [];
  const rsi = payload?.indicators?.rsi;
  if (typeof rsi === 'number' && rsi > 85) {
    warnings.push(`RSI value ${rsi} is unusually high (>85)`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

function computeDelayMs(timing?: string, intervalSeconds?: number): number {
  if (intervalSeconds && intervalSeconds > 0) {
    return Math.round(intervalSeconds * 1000);
  }
  if (timing === 'rapid') return 600;
  if (timing === 'realistic') return 1000 + Math.floor(Math.random() * 2000);
  return 0;
}

async function sendPayload(payload: Record<string, any>, requestId: string, req: Request) {
  return processWebhookPayload({
    payload,
    requestId,
    ip: req.ip,
  });
}

router.post('/webhooks/send', requireAuth, requireTestingAccess, requireTestingRateLimit, async (req: Request, res: Response) => {
  const parsed = singleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  const testSessionId = parsed.data.test_session_id || `test_${crypto.randomUUID()}`;
  const payload = buildTestWebhookPayload({
    symbol: parsed.data.symbol,
    timeframe: parsed.data.timeframe,
    signalType: parsed.data.signal_type,
    price: parsed.data.price,
    indicators: parsed.data.indicators,
    testSessionId,
    testScenario: parsed.data.test_scenario || 'single',
    sequenceNumber: parsed.data.sequence_number || 1,
    isTest: parsed.data.is_test ?? true,
    format: parsed.data.format as TestWebhookFormat | undefined,
  });

  await ensureTestSession(testSessionId, parsed.data.test_scenario || 'single', 1);
  const requestId = crypto.randomUUID();
  const result = await sendPayload(payload, requestId, req);

  return res.json({
    webhook_id: requestId,
    status: result.status === 'ACCEPTED' ? 'queued' : result.status.toLowerCase(),
    test_session_id: testSessionId,
    timestamp: new Date().toISOString(),
  });
});

router.post('/webhooks/send-batch', requireAuth, requireTestingAccess, requireTestingRateLimit, async (req: Request, res: Response) => {
  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  const payload = parsed.data;
  const testSessionId = payload.test_session_id || `test_${crypto.randomUUID()}`;
  const scenario = payload.scenario || 'batch';
  const symbols = payload.symbols && payload.symbols.length ? payload.symbols : TEST_SYMBOLS;
  const timeframes = payload.timeframes && payload.timeframes.length ? payload.timeframes : TEST_TIMEFRAMES;
  const signalTypes = payload.signal_types && payload.signal_types.length ? payload.signal_types : [...TEST_SIGNAL_TYPES];
  const requestIds = Array.from({ length: payload.count }, () => crypto.randomUUID());
  const delayEstimate = computeDelayMs(payload.timing, payload.interval_seconds);
  const estimatedCompletion = new Date(Date.now() + delayEstimate * payload.count);

  await ensureTestSession(testSessionId, scenario, payload.count);

  const runBatch = async () => {
    for (let i = 0; i < payload.count; i += 1) {
      const symbol = pickSymbolWithDistribution(symbols, payload.distribution);
      const timeframe = pickRandom(timeframes);
      const signalType = pickRandom(signalTypes) as TestSignalType;
      const price = payload.realistic_prices === false ? undefined : generateRealisticPrice(symbol);
      const indicators = generateIndicators(symbol, signalType);
      const webhookPayload = buildTestWebhookPayload({
        symbol,
        timeframe,
        signalType,
        price,
        indicators,
        testSessionId,
        testScenario: scenario,
        sequenceNumber: i + 1,
        isTest: true,
        format: payload.format as TestWebhookFormat | undefined,
      });
      await sendPayload(webhookPayload, requestIds[i], req);
      const delayMs = computeDelayMs(payload.timing, payload.interval_seconds);
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
    await markTestSessionCompleted(testSessionId);
  };

  void runBatch();

  return res.json({
    batch_id: `batch_${crypto.randomUUID()}`,
    test_session_id: testSessionId,
    total_webhooks: payload.count,
    status: 'processing',
    estimated_completion: estimatedCompletion.toISOString(),
    webhook_ids: requestIds,
  });
});

router.post('/webhooks/send-custom', requireAuth, requireTestingAccess, requireTestingRateLimit, async (req: Request, res: Response) => {
  const parsed = customSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  const validationMode = parsed.data.validation_mode || 'strict';
  const payload = parsed.data.custom_payload;
  const validation = validationMode === 'none' ? { valid: true, warnings: [], errors: [] } : validationResult(payload);

  if (!validation.valid && validationMode === 'strict') {
    return res.json({
      webhook_id: null,
      status: 'validation_failed',
      validation_result: validation,
      test_session_id: parsed.data.test_session_id || null,
      timestamp: new Date().toISOString(),
    });
  }

  const testSessionId = parsed.data.test_session_id || `test_${crypto.randomUUID()}`;
  payload.is_test = payload.is_test ?? true;
  payload.test_session_id = payload.test_session_id ?? testSessionId;
  payload.metadata = {
    ...(payload.metadata || {}),
    is_test: payload.metadata?.is_test ?? true,
    test_session_id: payload.metadata?.test_session_id ?? testSessionId,
  };

  await ensureTestSession(testSessionId, 'custom', 1);
  const requestId = crypto.randomUUID();
  await sendPayload(payload, requestId, req);

  return res.json({
    webhook_id: requestId,
    status: 'queued',
    validation_result: validation,
    test_session_id: testSessionId,
    timestamp: new Date().toISOString(),
  });
});

router.post('/webhooks/send-batch-custom', requireAuth, requireTestingAccess, requireTestingRateLimit, async (req: Request, res: Response) => {
  const parsed = batchCustomSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  const validationMode = parsed.data.validation_mode || 'strict';
  const testSessionId = parsed.data.test_session_id || `test_${crypto.randomUUID()}`;
  const requestIds: string[] = [];
  let validCount = 0;
  let invalidCount = 0;

  await ensureTestSession(testSessionId, 'batch_custom', parsed.data.webhooks.length);

  const runBatch = async () => {
    for (const webhook of parsed.data.webhooks) {
      const validation = validationMode === 'none' ? { valid: true } : validationResult(webhook);
      if (!validation.valid && validationMode === 'strict') {
        invalidCount += 1;
        continue;
      }
      const requestId = crypto.randomUUID();
      requestIds.push(requestId);
      validCount += 1;
      webhook.is_test = webhook.is_test ?? true;
      webhook.test_session_id = webhook.test_session_id ?? testSessionId;
      webhook.metadata = {
        ...(webhook.metadata || {}),
        is_test: webhook.metadata?.is_test ?? true,
        test_session_id: webhook.metadata?.test_session_id ?? testSessionId,
      };
      await sendPayload(webhook, requestId, req);
      if (parsed.data.timing === 'realistic') {
        await new Promise((resolve) => setTimeout(resolve, 1000 + Math.floor(Math.random() * 1000)));
      }
    }
    await markTestSessionCompleted(testSessionId);
  };

  void runBatch();

  return res.json({
    batch_id: `batch_custom_${crypto.randomUUID()}`,
    test_session_id: testSessionId,
    total_webhooks: parsed.data.webhooks.length,
    valid_webhooks: validCount,
    invalid_webhooks: invalidCount,
    status: 'processing',
    webhook_ids: requestIds,
  });
});

router.post('/audit', requireAuth, requireTestingAccess, async (req: Request, res: Response) => {
  const dateFilter = String(req.body?.dateFilter ?? req.query?.dateFilter ?? 'CURRENT_DATE');
  try {
    const result = await runTradeAudit(dateFilter);
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({
      error: 'Audit failed',
      message: error?.message ?? String(error),
    });
  }
});

router.get('/sessions/:id', requireAuth, requireTestingAccess, async (req: Request, res: Response) => {
  const testSessionId = String(req.params.id || '');
  if (!testSessionId) {
    return res.status(400).json({ error: 'test_session_id is required' });
  }
  const summary = await getTestSessionSummary(testSessionId);
  return res.json(summary);
});

router.delete('/sessions/:id', requireAuth, requireTestingAccess, async (req: Request, res: Response) => {
  const testSessionId = String(req.params.id || '');
  if (!testSessionId) {
    return res.status(400).json({ error: 'test_session_id is required' });
  }
  const result = await clearTestSession(testSessionId);
  return res.json({
    deleted: true,
    ...result,
  });
});

export default router;
