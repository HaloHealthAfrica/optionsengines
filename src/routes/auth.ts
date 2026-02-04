// Authentication routes
import { Router, Request, Response } from 'express';
import { authService } from '../services/auth.service.js';
import { userService } from '../services/user.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Login endpoint
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required',
      });
    }

    const user = await userService.verifyPassword(email, password);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
    }

    const result = authService.generateToken({
      userId: user.user_id,
      email: user.email,
      role: user.role,
    });

    logger.info('User logged in', { email: user.email, userId: user.user_id });

    res.json({
      success: true,
      token: result.token,
      expiresAt: result.expiresAt,
      user: userService.toPublic(user),
    });
  } catch (error) {
    logger.error('Login failed', error as Error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
    });
  }
});

// Register endpoint
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, role = 'user' } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required',
      });
    }

    const user = await userService.createUser({ email, password, role });

    const result = authService.generateToken({
      userId: user.user_id,
      email: user.email,
      role: user.role,
    });

    logger.info('User registered', { email, userId: user.user_id });

    res.json({
      success: true,
      token: result.token,
      expiresAt: result.expiresAt,
      user,
    });
  } catch (error) {
    const errorMessage = (error as Error).message;
    const statusCode = 
      errorMessage.includes('already exists') ? 409 :
      errorMessage.includes('Invalid email') || errorMessage.includes('Password must') ? 400 :
      500;

    logger.error('Registration failed', error as Error);
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
    });
  }
});

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

// Logout endpoint (client-side token removal, but useful for logging)
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const result = authService.verifyToken(token);
      if (result.valid && result.payload) {
        logger.info('User logged out', { email: result.payload.email });
      }
    }

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    logger.error('Logout failed', error as Error);
    res.status(500).json({
      success: false,
      error: 'Logout failed',
    });
  }
});

// Get current user info
router.get('/me', async (req: Request, res: Response) => {
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

    if (!result.valid || !result.payload) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
      });
    }

    const user = await userService.findById(result.payload.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    res.json({
      success: true,
      user: userService.toPublic(user),
    });
  } catch (error) {
    logger.error('Get user info failed', error as Error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user info',
    });
  }
});

export default router;
