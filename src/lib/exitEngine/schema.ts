import { z } from 'zod';

const GreeksSchema = z.object({
  delta: z.number(),
  gamma: z.number(),
  theta: z.number(),
  vega: z.number(),
});

const GuardrailsSchema = z.object({
  maxHoldTime: z.number().nonnegative(),
  timeStops: z.array(z.number().nonnegative()),
  progressChecks: z.array(
    z.object({
      atMinute: z.number().nonnegative(),
      minProfitPercent: z.number(),
    })
  ),
  thetaBurnLimit: z.number().nonnegative(),
  invalidationLevels: z.object({
    stopLoss: z.number(),
    thesisInvalidation: z.number(),
  }),
});

export const ExitDecisionInputSchema = z.object({
  tradePosition: z.object({
    id: z.string().min(1),
    symbol: z.string().min(1).max(10),
    direction: z.enum(['CALL', 'PUT']),
    setupType: z.enum(['SCALP_GUARDED', 'SWING', 'POSITION', 'LEAPS']),
  }),
  entryData: z.object({
    timestamp: z.number().positive(),
    underlyingEntryPrice: z.number().positive(),
    optionEntryPrice: z.number().positive(),
    contracts: z.number().int().positive(),
  }),
  contractDetails: z.object({
    expiry: z.string().min(1),
    dteAtEntry: z.number().positive(),
    strike: z.number().positive(),
    greeksAtEntry: GreeksSchema,
    ivAtEntry: z.number().nonnegative().optional(),
  }),
  guardrails: GuardrailsSchema,
  targets: z.object({
    partialTakeProfitPercent: z.array(z.number()),
    fullTakeProfitPercent: z.number(),
    stopLossPercent: z.number(),
  }),
  liveMarket: z.object({
    timestamp: z.number().positive(),
    underlyingPrice: z.number().positive(),
    optionBid: z.number().nonnegative(),
    optionAsk: z.number().nonnegative(),
    optionMid: z.number().nonnegative(),
    currentGreeks: GreeksSchema,
    currentIV: z.number().nonnegative(),
    currentDTE: z.number().nonnegative(),
    spreadPercent: z.number().nonnegative(),
    regime: z.enum(['STRONG_BULL', 'BULL', 'NEUTRAL', 'BEAR', 'STRONG_BEAR', 'CHOPPY', 'BREAKOUT', 'BREAKDOWN']),
    gexState: z.enum(['POSITIVE_HIGH', 'POSITIVE_LOW', 'NEUTRAL', 'NEGATIVE_LOW', 'NEGATIVE_HIGH']),
  }),
  thesisStatus: z
    .object({
      confidenceNow: z.number().min(0).max(100),
      thesisValid: z.boolean(),
      htfInvalidation: z.boolean(),
    })
    .optional(),
});
