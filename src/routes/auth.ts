// Authentication routes
import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { authService } from '../services/auth.service.js';
import { logger } from '../utils/logger.js';

const router = Router();

// In-memory user store (replace with database in production)
const users = new Map<string, { email: string; passwordHash: string; role: string }>();

// Initialize with a default admin user
const initDefaultUser = async () => {
  const defaultEmail = 'admin@optionagents.com';
  const defaultPassword = 'admin123'; // Change this in production!
  const passwordHash = await bcrypt.hash(defaultPassword, 10);
  
  users.set(defaultEmail, {
    email: defaultEmail,
    passwordHash,
    role: 'admin',
  });
  
  logger.info('Default admin user initialized', { email: defaultEmail });
};

initDefaultUser();

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

    const user = users.get(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials',
      });
    }

    const result = authService.generateToken({
      userId: email,
      email: user.email,
      role: user.role,
    });

    logger.info('User logged in', { email: user.email });

    res.json({
      success: true,
      token: result.token,
      expiresAt: result.expiresAt,
      user: {
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    logger.error('Login failed', error as Error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
    });
  }
});

// Register endpoint (optional - for creating new users)
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { email, password, role = 'user' } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Email and password are required',
      });
    }

    if (users.has(email)) {
      return res.status(409).json({
        success: false,
        error: 'User already exists',
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters',
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    users.set(email, {
      email,
      passwordHash,
      role,
    });

    const result = authService.generateToken({
      userId: email,
      email,
      role,
    });

    logger.info('User registered', { email, role });

    res.json({
      success: true,
      token: result.token,
      expiresAt: result.expiresAt,
      user: {
        email,
        role,
      },
    });
  } catch (error) {
    logger.error('Registration failed', error as Error);
    res.status(500).json({
      success: false,
      error: 'Registration failed',
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

export default router;
