// Feature Flags API - admin updates for Engine 2 toggles
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { featureFlags } from '../services/feature-flag.service.js';
import { authService } from '../services/auth.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

const allowedFlags = [
  'enable_variant_b',
  'enable_orb_specialist',
  'enable_strat_specialist',
  'enable_ttm_specialist',
  'enable_satyland_subagent',
  'enable_shadow_execution',
] as const;

const updateSchema = z.object({
  name: z.enum(allowedFlags),
  enabled: z.boolean(),
});

router.get('/', async (req: Request, res: Response) => {
  const token = authService.extractTokenFromHeader(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = authService.verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (payload.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const flags = await featureFlags.getAllFlags();
    return res.json({ data: flags });
  } catch (error) {
    logger.error('Failed to fetch feature flags', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', async (req: Request, res: Response) => {
  const token = authService.extractTokenFromHeader(req.headers.authorization);
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = authService.verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (payload.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid payload',
      details: parsed.error.errors.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
      })),
    });
  }

  const { name, enabled } = parsed.data;

  try {
    const updated = await featureFlags.updateFlag(name, enabled, payload.userId);
    if (!updated) {
      return res.status(404).json({ error: 'Flag not found' });
    }
    logger.info('Feature flag updated via API', {
      name,
      enabled,
      updatedBy: payload.userId,
    });

    return res.json({ status: 'ok', name, enabled });
  } catch (error) {
    logger.error('Failed to update feature flag', error, { name, enabled });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
