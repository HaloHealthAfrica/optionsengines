import type { StrategyCandidate, UDCSignal } from '../types.js';

/**
 * Rob Smith Strat methodology — candle combination pattern recognition.
 *
 * Candle types:
 *   1  = Inside bar  (H ≤ prev H AND L ≥ prev L)
 *   2U = Directional up  (H > prev H)
 *   2D = Directional down (L < prev L)
 *   3  = Outside bar (H > prev H AND L < prev L)
 *
 * Ranked patterns (most profitable first for SPY / QQQ / IWM):
 *
 *   Tier 1 — Highest win-rate on liquid ETFs
 *     2-1-2U Rev   Bullish reversal  (2D → 1 → break C1 high)
 *     2-1-2D Rev   Bearish reversal  (2U → 1 → break C1 low)
 *
 *   Tier 2 — Strong continuation setups
 *     2-1-2U Cont  Bullish continuation (2U → 1 → break C1 high)
 *     2-1-2D Cont  Bearish continuation (2D → 1 → break C1 low)
 *
 *   Tier 3 — Outside-bar combos
 *     3-1-2U Rev   Bullish reversal after outside bar squeeze
 *     3-1-2D Rev   Bearish reversal after outside bar squeeze
 *     3-2U-2U Cont Bullish continuation (broadening → directional)
 *     3-2D-2D Cont Bearish continuation (broadening → directional)
 *
 * Invalidation is the `stop` level from the signal payload.
 * When not provided, derived from `c1_low` (bull) or `c1_high` (bear),
 * falling back to a percentage of price.
 */

const INTRADAY_TIMEFRAMES = new Set(['1', '3', '5', '15']);
const FALLBACK_INVALIDATION_PCT = 0.015;

interface PatternConfig {
  baseConfidence: number;
  tier: 1 | 2 | 3;
}

const PATTERN_MAP: Record<string, PatternConfig> = {
  '2-1-2u rev':   { baseConfidence: 0.80, tier: 1 },
  '2-1-2d rev':   { baseConfidence: 0.80, tier: 1 },
  '2-1-2u cont':  { baseConfidence: 0.75, tier: 2 },
  '2-1-2d cont':  { baseConfidence: 0.75, tier: 2 },
  '3-1-2u rev':   { baseConfidence: 0.72, tier: 3 },
  '3-1-2d rev':   { baseConfidence: 0.72, tier: 3 },
  '3-2u-2u cont': { baseConfidence: 0.68, tier: 3 },
  '3-2d-2d cont': { baseConfidence: 0.68, tier: 3 },
};

const PATTERN_ALIASES: [RegExp, string][] = [
  [/2[-_]?1[-_]?2\s*u\s*rev/i,    '2-1-2u rev'],
  [/2[-_]?1[-_]?2\s*d\s*rev/i,    '2-1-2d rev'],
  [/2[-_]?1[-_]?2\s*u\s*cont/i,   '2-1-2u cont'],
  [/2[-_]?1[-_]?2\s*d\s*cont/i,   '2-1-2d cont'],
  [/3[-_]?1[-_]?2\s*u\s*rev/i,    '3-1-2u rev'],
  [/3[-_]?1[-_]?2\s*d\s*rev/i,    '3-1-2d rev'],
  [/3[-_]?2\s*u[-_]?2\s*u\s*cont/i, '3-2u-2u cont'],
  [/3[-_]?2\s*d[-_]?2\s*d\s*cont/i, '3-2d-2d cont'],
  // Shorthand aliases
  [/2[-_]?1[-_]?2\s*u/i,          '2-1-2u rev'],
  [/2[-_]?1[-_]?2\s*d/i,          '2-1-2d rev'],
  [/3[-_]?1[-_]?2\s*u/i,          '3-1-2u rev'],
  [/3[-_]?1[-_]?2\s*d/i,          '3-1-2d rev'],
  [/3[-_]?2[-_]?2/i,              '3-2u-2u cont'],
];

function resolvePatternKey(pattern: string, setup?: string): string | null {
  const candidates = [setup, pattern].filter(Boolean).map(s => s!.toLowerCase());

  for (const candidate of candidates) {
    const direct = PATTERN_MAP[candidate];
    if (direct) return candidate;

    for (const [regex, key] of PATTERN_ALIASES) {
      if (regex.test(candidate)) return key;
    }
  }

  return null;
}

function isStratSignal(pattern: string, raw: Record<string, unknown>): boolean {
  const lower = pattern.toLowerCase();

  if (lower.includes('strat') || lower.includes('inside_bar') || lower.includes('outside_bar')) {
    return true;
  }

  const setup = String(raw.setup ?? '').toLowerCase();
  if (setup && resolvePatternKey('', setup)) return true;

  const engine = String((raw.meta as Record<string, unknown>)?.engine ?? raw.engine ?? '').toLowerCase();
  if (engine.includes('strat')) return true;

  const components = raw.components;
  if (Array.isArray(components)) {
    const lower = components.map((c: unknown) => String(c).toLowerCase());
    if (lower.some(c => c.includes('strat_setup') || c.includes('htf_ignition'))) return true;
  }

  return false;
}

export function evaluateStrat(signal: UDCSignal): StrategyCandidate | null {
  const pattern = signal.pattern ?? '';
  const raw = signal.raw_payload ?? {};

  if (!isStratSignal(pattern, raw)) {
    return null;
  }

  const setup = String(raw.setup ?? '');
  const patternKey = resolvePatternKey(pattern, setup);
  const config = patternKey ? PATTERN_MAP[patternKey] : null;

  const direction = signal.direction?.toLowerCase();
  const isBull = direction === 'long' || direction === 'bull' || direction === 'bullish';
  const tradeDirection = isBull ? 'BULL' as const : 'BEAR' as const;
  const isIntraday = INTRADAY_TIMEFRAMES.has(signal.timeframe);

  const baseConfidence = config?.baseConfidence ?? 0.60;
  let confidence = signal.confidence ?? baseConfidence;

  const score = Number(raw.score ?? raw.current_score ?? 0);
  if (score > 0) {
    confidence = Math.min(0.95, confidence + (score / 100) * 0.15);
  }

  const tfConfluence = Number(raw.tf_confluence_count ?? 0);
  if (tfConfluence >= 2) {
    confidence = Math.min(0.95, confidence + tfConfluence * 0.03);
  }

  const invalidation = resolveInvalidation(signal, isBull, isIntraday);

  const strategyLabel = patternKey
    ? `STRAT_${patternKey.replace(/[\s-]/g, '_').toUpperCase()}`
    : 'STRAT';

  return {
    intent: {
      strategy: strategyLabel,
      symbol: signal.symbol,
      direction: tradeDirection,
      structure: tradeDirection === 'BULL' ? 'LONG_CALL' : 'LONG_PUT',
      invalidation,
      dteMin: isIntraday ? 1 : 5,
      dteMax: isIntraday ? 7 : 21,
      confidence,
    },
    confidence,
  };
}

function resolveInvalidation(
  signal: UDCSignal,
  isBull: boolean,
  isIntraday: boolean,
): number {
  const raw = signal.raw_payload ?? {};

  const stop = Number(raw.stop ?? raw.stop_loss ?? raw.invalidation ?? 0);
  if (stop > 0) return stop;

  if (isBull) {
    const c1Low = Number(raw.c1_low ?? 0);
    if (c1Low > 0) return c1Low;
  } else {
    const c1High = Number(raw.c1_high ?? 0);
    if (c1High > 0) return c1High;
  }

  const price = Number(raw.price ?? raw.entry ?? 0);
  if (price <= 0) return 0;

  return Math.round(
    price * (isBull ? 1 - FALLBACK_INVALIDATION_PCT : 1 + FALLBACK_INVALIDATION_PCT) * 100,
  ) / 100;
}
