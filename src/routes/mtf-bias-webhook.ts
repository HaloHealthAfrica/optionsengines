/**
 * MTF Bias Webhook - POST /api/webhooks/mtf-bias
 * Also handled at POST /webhook when payload has event_type=BIAS_SNAPSHOT
 */

import { Router, Request, Response } from 'express';
import { config } from '../config/index.js';
import { authService } from '../services/auth.service.js';
import { handleMTFBiasWebhook } from '../services/mtf-bias-webhook-handler.service.js';

const router = Router();

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

router.post('/mtf-bias', async (req: Request, res: Response) => {
  if (!verifySignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const body = req.body;
  const { shouldRouteToV3, update } = await import(
    '../services/bias-state-aggregator/bias-state-aggregator.service.js'
  );

  if (shouldRouteToV3(body)) {
    const result = await update(body);
    if (result.ok) {
      return res.status(200).json({
        success: true,
        event_id: result.eventId,
        symbol: result.state?.symbol ?? (body as { symbol?: string })?.symbol,
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
});

export default router;
