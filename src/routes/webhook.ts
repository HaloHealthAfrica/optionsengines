// Webhook Handler - Receives TradingView signals
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { db } from '../services/database.service.js';
import { authService } from '../services/auth.service.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { strategyRouter } from '../services/strategy-router.service.js';
import { marketData } from '../services/market-data.js';
import { eventLogger } from '../services/event-logger.service.js';
import { shadowExecutor } from '../services/shadow-executor.service.js';
import { featureFlags } from '../services/feature-flag.service.js';
import { positioningService } from '../services/positioning.service.js';
import { TechnicalAgent } from '../agents/core/technical-agent.js';
import { ContextAgent } from '../agents/core/context-agent.js';
import { RiskAgent } from '../agents/core/risk-agent.js';
import { MetaDecisionAgent } from '../agents/core/meta-decision-agent.js';
import { ORBSpecialist } from '../agents/specialists/orb-specialist.js';
import { StratSpecialist } from '../agents/specialists/strat-specialist.js';
import { TTMSpecialist } from '../agents/specialists/ttm-specialist.js';
import { GammaFlowSpecialist } from '../agents/specialists/gamma-flow-specialist.js';
import { SatylandSubAgent } from '../agents/subagents/satyland-sub-agent.js';
import { AgentOutput, EnrichedSignal, MarketData, SessionContext } from '../types/index.js';

const router = Router();
const metaDecisionAgent = new MetaDecisionAgent();
const coreAgents = [new TechnicalAgent(), new ContextAgent(), new RiskAgent()];
const specialistAgents = [
  new ORBSpecialist(),
  new StratSpecialist(),
  new TTMSpecialist(),
  new GammaFlowSpecialist(),
];
const subAgents = [new SatylandSubAgent()];

// Webhook payload schema
export const webhookSchema = z
  .object({
    symbol: z.string().min(1).max(20).optional(),
    ticker: z.string().min(1).max(20).optional(),
    action: z.enum(['BUY', 'SELL']).optional(),
    direction: z
      .enum(['long', 'short', 'LONG', 'SHORT', 'CALL', 'PUT', 'BUY', 'SELL'])
      .optional(),
    timeframe: z.string().min(1).max(10),
    strike: z.number().optional(),
    expiration: z.string().optional(), // ISO date string
    timestamp: z.string(),
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
  const rawDirection = payload.direction?.toLowerCase();
  if (rawDirection === 'long' || rawDirection === 'short') {
    return rawDirection;
  }
  if (rawDirection === 'call' || rawDirection === 'buy') {
    return 'long';
  }
  if (rawDirection === 'put' || rawDirection === 'sell') {
    return 'short';
  }
  if (payload.action === 'BUY') {
    return 'long';
  }
  if (payload.action === 'SELL') {
    return 'short';
  }
  return null;
}

export async function handleWebhook(req: Request, res: Response): Promise<Response> {
  const startTime = Date.now();
  const requestId = crypto.randomUUID();

  try {
    // Log incoming request
    logger.info('Webhook received', {
      requestId,
      ip: req.ip,
      body: req.body,
    });

    // Validate HMAC signature if configured
    const signature = req.headers['x-webhook-signature'] as string;
    if (config.hmacSecret && config.hmacSecret !== 'change-this-to-another-secure-random-string-for-webhooks') {
      if (!signature) {
        logger.warn('Missing webhook signature', { requestId });
        return res.status(401).json({
          status: 'REJECTED',
          error: 'Missing signature',
          request_id: requestId,
        });
      }

      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      const payload = rawBody ? rawBody.toString('utf8') : JSON.stringify(req.body);
      const isValid = authService.verifyHmacSignature(payload, signature);

      if (!isValid) {
        logger.warn('Invalid webhook signature', { requestId });
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
    const symbol = payload.symbol ?? payload.ticker;
    if (!symbol) {
      return res.status(400).json({
        status: 'REJECTED',
        error: 'Missing symbol',
        request_id: requestId,
      });
    }

    const normalizedDirection = normalizeDirection(payload);

    if (!normalizedDirection) {
      return res.status(400).json({
        status: 'REJECTED',
        error: 'Missing or invalid direction',
        request_id: requestId,
      });
    }

    // Check for duplicates
    const duplicate = await isDuplicate(symbol, normalizedDirection, payload.timeframe, 60);

    if (duplicate) {
      logger.info('Duplicate signal detected', {
        requestId,
        ticker: symbol,
        direction: normalizedDirection,
      });

      return res.status(200).json({
        status: 'DUPLICATE',
        message: 'Signal already received',
        request_id: requestId,
        processing_time_ms: Date.now() - startTime,
      });
    }

    // Generate signal hash
    const signalHash = generateSignalHash(
      symbol,
      normalizedDirection,
      payload.timeframe,
      payload.timestamp
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
        payload.timeframe,
        payload.timestamp ? new Date(payload.timestamp) : new Date(),
        'pending',
        JSON.stringify(payload),
        signalHash,
      ]
    );

    const signalId = result.rows[0].signal_id;
    const signalTimestamp = payload.timestamp ? new Date(payload.timestamp) : new Date();

    logger.info('Signal stored successfully', {
      requestId,
      signalId,
      ticker: symbol,
      direction: normalizedDirection,
    });

    // Route signal to Engine 1 (A) or Engine 2 (B)
    const routingDecision = await strategyRouter.route({
      signalId,
      symbol,
      timeframe: payload.timeframe,
      sessionId: payload.timestamp,
    });

    if (routingDecision.variant === 'B') {
      const marketHours = await marketData.getMarketHours();
      const sessionContext: SessionContext = {
        sessionType: marketHours.isMarketOpen ? 'RTH' : 'ETH',
        isMarketOpen: marketHours.isMarketOpen,
        minutesUntilClose: marketHours.minutesUntilClose,
      };

      const [candles, indicators, currentPrice] = await Promise.all([
        marketData.getCandles(symbol, payload.timeframe, 200),
        marketData.getIndicators(symbol, payload.timeframe),
        marketData.getStockPrice(symbol),
      ]);

      let gexData = null;
      let optionsFlow = null;
      try {
        gexData = await positioningService.getGexSnapshot(symbol);
      } catch (error) {
        logger.warn('GEX data unavailable', { error, symbol });
      }
      try {
        optionsFlow = await positioningService.getOptionsFlowSnapshot(symbol, 50);
      } catch (error) {
        logger.warn('Options flow data unavailable', { error, symbol });
      }

      const riskLimitResult = await db.query(
        `SELECT * FROM risk_limits WHERE enabled = true ORDER BY created_at DESC LIMIT 1`
      );
      const riskLimit = riskLimitResult.rows[0] || {};

      const exposureResult = await db.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(entry_price * quantity * 100), 0) AS exposure
         FROM refactored_positions WHERE status IN ('open', 'closing')`
      );
      const openPositions = exposureResult.rows[0]?.count || 0;
      const exposure = Number(exposureResult.rows[0]?.exposure || 0);
      const maxTotalExposure =
        riskLimit.max_total_exposure !== undefined ? Number(riskLimit.max_total_exposure) : null;

      const marketContext: MarketData = {
        candles,
        indicators,
        currentPrice,
        sessionContext,
        gex: gexData,
        optionsFlow,
        risk: {
          positionLimitExceeded: openPositions >= config.maxOpenPositions,
          exposureExceeded: maxTotalExposure !== null && exposure > maxTotalExposure,
        },
      };

      const enrichedSignal: EnrichedSignal = {
        signalId,
        symbol,
        direction: normalizedDirection,
        timeframe: payload.timeframe,
        timestamp: signalTimestamp,
        sessionType: sessionContext.sessionType,
      };

      const allAgents = [...coreAgents, ...specialistAgents, ...subAgents];
      const outputs: AgentOutput[] = [];

      for (const agent of allAgents) {
        if (!agent.shouldActivate(enrichedSignal, marketContext)) {
          continue;
        }
        const output = await agent.analyze(enrichedSignal, marketContext);
        outputs.push({
          ...output,
          metadata: {
            ...output.metadata,
            agentType: agent.type,
          },
        });
      }

      const metaDecision = metaDecisionAgent.aggregate(outputs);
      await eventLogger.logDecision({
        experimentId: routingDecision.experimentId,
        signalId,
        outputs,
        metaDecision,
      });

      if (metaDecision.decision === 'approve') {
        if (featureFlags.isEnabled('enable_shadow_execution')) {
          await shadowExecutor.simulateExecution(metaDecision, enrichedSignal, routingDecision.experimentId);
        } else {
          logger.info('Shadow execution disabled, skipping', {
            experimentId: routingDecision.experimentId,
            signalId,
          });
        }
      }
    }

    // Return success response
    return res.status(201).json({
      status: 'ACCEPTED',
      signal_id: signalId,
      experiment_id: routingDecision.experimentId,
      variant: routingDecision.variant,
      request_id: requestId,
      processing_time_ms: Date.now() - startTime,
    });
  } catch (error: any) {
    logger.error('Webhook processing failed', error, { requestId });

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
