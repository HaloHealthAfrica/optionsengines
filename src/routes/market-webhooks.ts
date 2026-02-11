import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { webhookIngestionService } from '../services/webhook-ingestion.service.js';

const router = Router();

const flowSchema = z.object({
  symbol: z.string().min(1),
  timestamp: z.number().optional(),
  type: z.enum(['call', 'put']),
  strike: z.number(),
  expiry: z.string(),
  premium: z.number(),
  size: z.number(),
  sentiment: z.enum(['bullish', 'bearish', 'neutral']),
  unusual: z.boolean().optional(),
});

const priceSchema = z.object({
  symbol: z.string().min(1),
  price: z.number(),
  timestamp: z.number().optional(),
  volume: z.number().optional().default(0),
  high: z.number().optional().default(0),
  low: z.number().optional().default(0),
  open: z.number().optional().default(0),
});

const chainSchema = z
  .object({
    symbol: z.string().min(1),
  })
  .passthrough();

function verifySignature(req: Request): boolean {
  const signature = req.headers['x-webhook-signature'];
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;

  const hmacEnabled =
    config.hmacSecret &&
    config.hmacSecret !== 'change-this-to-another-secure-random-string-for-webhooks';
  if (!hmacEnabled || !signature) {
    return true;
  }

  const payload = rawBody ? rawBody.toString('utf8') : JSON.stringify(req.body);
  return authService.verifyHmacSignature(payload, String(signature));
}

router.post('/flow', async (req: Request, res: Response) => {
  if (!verifySignature(req)) {
    logger.warn('Invalid flow webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const parsed = flowSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  const payload = parsed.data;
  const normalized = {
    symbol: payload.symbol.toUpperCase(),
    timestamp: payload.timestamp ?? Date.now(),
    type: payload.type,
    strike: payload.strike,
    expiry: payload.expiry,
    premium: payload.premium,
    size: payload.size,
    sentiment: payload.sentiment,
    unusual: payload.unusual ?? false,
    source: 'webhook' as const,
    receivedAt: Date.now(),
  };

  try {
    await webhookIngestionService.storeFlow(normalized);

    if (normalized.unusual || normalized.premium > 100000) {
      await webhookIngestionService.publishPipelineTrigger({
        reason: 'unusual_flow',
        symbol: normalized.symbol,
        timestamp: Date.now(),
      });
    }

    return res.status(200).json({
      success: true,
      symbol: normalized.symbol,
      timestamp: normalized.timestamp,
    });
  } catch (error) {
    logger.error('Flow webhook error', error);
    return res.status(500).json({ error: 'Processing failed' });
  }
});

router.post('/price', async (req: Request, res: Response) => {
  if (!verifySignature(req)) {
    logger.warn('Invalid price webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const parsed = priceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  const payload = parsed.data;
  const tick = {
    symbol: payload.symbol.toUpperCase(),
    price: payload.price,
    timestamp: payload.timestamp ?? Date.now(),
    volume: payload.volume,
    high: payload.high,
    low: payload.low,
    open: payload.open,
  };

  try {
    const atr = await webhookIngestionService.storePriceTick(tick);
    return res.status(200).json({ success: true, atr });
  } catch (error) {
    logger.error('Price webhook error', error);
    return res.status(500).json({ error: 'Processing failed' });
  }
});

router.post('/chain', async (req: Request, res: Response) => {
  if (!verifySignature(req)) {
    logger.warn('Invalid chain webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const parsed = chainSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid payload', details: parsed.error.errors });
  }

  const payload = parsed.data;
  const symbol = payload.symbol.toUpperCase();

  try {
    await webhookIngestionService.storeChainSnapshot({
      symbol,
      payload,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Chain webhook error', error);
    return res.status(500).json({ error: 'Processing failed' });
  }
});

export default router;
