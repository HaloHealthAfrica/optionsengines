// Authentication routes
import { Router, Request, Response } from 'express';
import { authService } from '../services/auth.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Simple token generation endpoint for development/demo
router.post('/generate-token', async (req: Request, res: Response) => {
  try {
    const { userId = 'demo-user', email = 'demo@example.com', role = 'admin' } = req.body;

    const result = authService.generateToken({
      userId,
      email,
      role,
    });

    logger.info('Token generated', { userId, email, role });

    res.json({
      success: true,
      token: result.token,
      expiresAt: result.expiresAt,
    });
  } catch (error) {
    logger.error('Token generation failed', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate token',
    });
  }
});

// Verify token endpoint
router.post('/verify-token', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided',
      });
    }

    const token = authHeader.substring(7);
    const result = authService.verifyToken(token);

    if (!result.valid) {
      return res.status(401).json({
        success: false,
        error: result.error || 'Invalid token',
      });
    }

    res.json({
      success: true,
      payload: result.payload,
    });
  } catch (error) {
    logger.error('Token verification failed', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify token',
    });
  }
});

export default router;
