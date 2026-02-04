import { Router, Request, Response } from 'express';
import { EntryDecisionInputSchema, evaluateEntryDecision } from '../lib/entryEngine/index.js';
import { StrikeSelectionInputSchema, selectStrike } from '../lib/strikeSelection/index.js';
import { ExitDecisionInputSchema, evaluateExitDecision } from '../lib/exitEngine/index.js';
import { parseWithSchema } from '../lib/shared/validators.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.post('/entry-decision', (req: Request, res: Response) => {
  const parsed = parseWithSchema(EntryDecisionInputSchema, req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error);
  }

  try {
    const result = evaluateEntryDecision(parsed.data);
    return res.json(result);
  } catch (error) {
    logger.error('Entry decision evaluation failed', error);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});

router.post('/strike-selection', (req: Request, res: Response) => {
  const parsed = parseWithSchema(StrikeSelectionInputSchema, req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error);
  }

  try {
    const result = selectStrike(parsed.data);
    return res.json(result);
  } catch (error) {
    logger.error('Strike selection evaluation failed', error);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});

router.post('/exit-decision', (req: Request, res: Response) => {
  const parsed = parseWithSchema(ExitDecisionInputSchema, req.body);
  if (!parsed.success) {
    return res.status(400).json(parsed.error);
  }

  try {
    const result = evaluateExitDecision(parsed.data);
    return res.json(result);
  } catch (error) {
    logger.error('Exit decision evaluation failed', error);
    return res.status(500).json({
      error: 'Internal server error',
    });
  }
});

export default router;
