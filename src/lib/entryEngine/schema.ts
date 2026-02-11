import { z } from 'zod';

export const EntryDecisionInputSchema = z.object({
  symbol: z.string().min(1).max(10),
  timestamp: z.number().positive(),
  direction: z.enum(['CALL', 'PUT']),
  setupType: z.enum(['SCALP_GUARDED', 'SWING', 'POSITION', 'LEAPS']),
  signal: z.object({
    confidence: z.number().min(0).max(100),
    pattern: z.string().min(1),
    timeframe: z.string().min(1),
    confirmationPending: z.boolean().optional(),
  }),
  marketContext: z.object({
    price: z.number().positive(),
    regime: z.enum(['STRONG_BULL', 'BULL', 'NEUTRAL', 'BEAR', 'STRONG_BEAR', 'CHOPPY', 'BREAKOUT', 'BREAKDOWN']),
    gexState: z.enum(['POSITIVE_HIGH', 'POSITIVE_LOW', 'NEUTRAL', 'NEGATIVE_LOW', 'NEGATIVE_HIGH']),
    volatility: z.number().nonnegative(),
    ivPercentile: z.number().min(0).max(100),
  }),
  timingContext: z.object({
    session: z.enum(['PRE_MARKET', 'OPEN', 'MORNING', 'LUNCH', 'AFTERNOON', 'CLOSE', 'AFTER_HOURS']),
    minutesFromOpen: z.number().nonnegative(),
    liquidityState: z.enum(['HIGH', 'NORMAL', 'LOW', 'ILLIQUID']),
  }),
  riskContext: z.object({
    dailyPnL: z.number(),
    openTradesCount: z.number().nonnegative(),
    portfolioDelta: z.number(),
    portfolioTheta: z.number(),
  }),
});
