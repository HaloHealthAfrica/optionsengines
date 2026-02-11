import { z } from 'zod';

const GreeksSchema = z.object({
  delta: z.number(),
  gamma: z.number(),
  theta: z.number(),
  vega: z.number(),
});

const EventRiskSchema = z.object({
  type: z.enum(['EARNINGS', 'FOMC', 'OPEX', 'DIVIDEND', 'ECONOMIC_DATA']),
  date: z.string().min(1),
  daysUntil: z.number().int().nonnegative(),
});

const OptionContractSchema = z.object({
  expiry: z.string().min(1),
  dte: z.number().int().positive(),
  strike: z.number().positive(),
  bid: z.number().nonnegative(),
  ask: z.number().nonnegative(),
  mid: z.number().nonnegative(),
  openInterest: z.number().nonnegative(),
  volume: z.number().nonnegative(),
  greeks: GreeksSchema,
  iv: z.number().nonnegative(),
});

export const StrikeSelectionInputSchema = z.object({
  symbol: z.string().min(1).max(10),
  spotPrice: z.number().positive(),
  direction: z.enum(['CALL', 'PUT']),
  setupType: z.enum(['SCALP_GUARDED', 'SWING', 'POSITION', 'LEAPS']),
  signalConfidence: z.number().min(0).max(100),
  expectedHoldTime: z.number().int().positive(),
  expectedMovePercent: z.number().positive(),
  regime: z.enum(['STRONG_BULL', 'BULL', 'NEUTRAL', 'BEAR', 'STRONG_BEAR', 'CHOPPY', 'BREAKOUT', 'BREAKDOWN']),
  gexState: z.enum(['POSITIVE_HIGH', 'POSITIVE_LOW', 'NEUTRAL', 'NEGATIVE_LOW', 'NEGATIVE_HIGH']),
  ivPercentile: z.number().min(0).max(100),
  eventRisk: z.array(EventRiskSchema),
  riskBudget: z.object({
    maxPremiumLoss: z.number().positive(),
    maxCapitalAllocation: z.number().positive(),
  }),
  optionChain: z.array(OptionContractSchema).min(1),
});
