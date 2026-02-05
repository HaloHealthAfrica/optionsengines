// Express app setup for the dual-engine options trading platform
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import webhookRoutes from './routes/webhook.js';
import featureFlagRoutes from './routes/feature-flags.js';
import engine2Routes from './routes/engine2.js';
import positioningRoutes from './routes/positioning.js';
import optionsEnginesRoutes from './routes/options-engines.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';

const app: Express = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://optionsengines.vercel.app',
    /^https:\/\/optionsengines-.*\.vercel\.app$/, // Allow preview deployments
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// Routes
app.use('/auth', authRoutes);
app.use('/webhook', webhookRoutes);
app.use('/feature-flags', featureFlagRoutes);
app.use('/positioning', positioningRoutes);
app.use('/dashboard', dashboardRoutes);
app.use('/api', optionsEnginesRoutes);
app.use('/', engine2Routes);

// Root endpoint
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Dual-Engine Options Trading Platform',
    version: '1.0.0',
    engines: {
      engine1: 'Traditional Signal Processing (Production)',
      engine2: 'Multi-Agent Swarm Decision System (Shadow)',
    },
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error', err, {
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    error: 'Internal server error',
    message: config.nodeEnv === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path,
  });
});

export { app };
