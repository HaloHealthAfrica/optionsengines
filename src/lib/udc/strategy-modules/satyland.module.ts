import type { StrategyCandidate, UDCSignal } from '../types.js';

/**
 * Satyland Phase Oscillator strategy — multi-timeframe trend confirmation.
 *
 * Based on the Satyland methodology:
 *   1. Pivot Ribbon  — EMA alignment (8, 13, 21, 48, 200)
 *   2. ATR Levels    — Level-to-level price progression
 *   3. Phase Oscillator — Trend phase identification
 *   4. Volume Stack  — Relative volume quality
 *
 * Phase names (from SATY_PO indicator):
 *   MARKUP   — Bullish trend confirmed (oscillator positive & rising)
 *   MARKDOWN — Bearish trend confirmed (oscillator negative & falling)
 *   ACCUMULATION — Early reversal, building long base
 *   DISTRIBUTION — Late topping, building short base
 *
 * Webhook source field: meta.engine = 'SATY_PO'
 *
 * Invalidation is derived from ATR levels when available,
 * otherwise from a percentage of price.
 */

const INTRADAY_TIMEFRAMES = new Set(['1', '3', '5', '15']);
const INTRADAY_INVALIDATION_PCT = 0.012;
const SWING_INVALIDATION_PCT = 0.025;

interface PhaseConfig {
  baseConfidence: number;
  dteMultiplier: number;
}

const PHASE_MAP: Record<string, PhaseConfig> = {
  markup:        { baseConfidence: 0.72, dteMultiplier: 1.0 },
  markdown:      { baseConfidence: 0.72, dteMultiplier: 1.0 },
  accumulation:  { baseConfidence: 0.58, dteMultiplier: 1.3 },
  distribution:  { baseConfidence: 0.58, dteMultiplier: 1.3 },
};

function isSatylandSignal(pattern: string, raw: Record<string, unknown>): boolean {
  const lower = pattern.toLowerCase();

  if (
    lower.includes('saty') ||
    lower.includes('satyland') ||
    lower.includes('phase_osc') ||
    lower.includes('pivot_ribbon') ||
    lower.includes('markup') ||
    lower.includes('markdown') ||
    lower.includes('accumulation') ||
    lower.includes('distribution') ||
    lower.includes('mtf_trend')
  ) {
    return true;
  }

  const meta = raw.meta as Record<string, unknown> | undefined;
  const engine = String(meta?.engine ?? raw.engine ?? '').toUpperCase();
  if (engine === 'SATY_PO' || engine === 'SATYLAND') return true;

  const source = String(meta?.source ?? raw.source ?? '').toLowerCase();
  if (source.includes('satyland') || source.includes('saty')) return true;

  return false;
}

function resolvePhase(pattern: string, raw: Record<string, unknown>): string | null {
  const lower = pattern.toLowerCase();

  for (const phase of Object.keys(PHASE_MAP)) {
    if (lower.includes(phase)) return phase;
  }

  const event = raw.event as Record<string, unknown> | undefined;
  const phaseName = String(event?.phase_name ?? raw.phase_name ?? raw.phase ?? '').toLowerCase();
  if (PHASE_MAP[phaseName]) return phaseName;

  return null;
}

function resolveDirection(
  signal: UDCSignal,
  phase: string | null,
): 'BULL' | 'BEAR' {
  const dir = signal.direction?.toLowerCase();
  if (dir === 'long' || dir === 'bull' || dir === 'bullish') return 'BULL';
  if (dir === 'short' || dir === 'bear' || dir === 'bearish') return 'BEAR';

  const raw = signal.raw_payload ?? {};
  const regimeBias = String(
    (raw.regime_context as Record<string, unknown>)?.local_bias ??
    (raw.execution_guidance as Record<string, unknown>)?.bias ??
    '',
  ).toLowerCase();

  if (regimeBias === 'bullish') return 'BULL';
  if (regimeBias === 'bearish') return 'BEAR';

  if (phase === 'markup' || phase === 'accumulation') return 'BULL';
  if (phase === 'markdown' || phase === 'distribution') return 'BEAR';

  return 'BULL';
}

export function evaluateSatyland(signal: UDCSignal): StrategyCandidate | null {
  const pattern = signal.pattern ?? '';
  const raw = signal.raw_payload ?? {};

  if (!isSatylandSignal(pattern, raw)) {
    return null;
  }

  const phase = resolvePhase(pattern, raw);
  const phaseConfig = phase ? PHASE_MAP[phase] : null;

  const tradeDirection = resolveDirection(signal, phase);
  const isIntraday = INTRADAY_TIMEFRAMES.has(signal.timeframe);

  let confidence = signal.confidence ?? phaseConfig?.baseConfidence ?? 0.55;

  const ribbonAlign = String(raw.ribbonAlignment ?? raw.ribbon_alignment ?? '').toLowerCase();
  if (
    (ribbonAlign === 'bullish' && tradeDirection === 'BULL') ||
    (ribbonAlign === 'bearish' && tradeDirection === 'BEAR')
  ) {
    confidence = Math.min(0.95, confidence + 0.08);
  }

  const volumeQuality = String(raw.volumeQuality ?? raw.volume_quality ?? '').toLowerCase();
  if (volumeQuality === 'high') {
    confidence = Math.min(0.95, confidence + 0.05);
  }

  const atLevel = raw.atLevelToLevel ?? raw.at_level_to_level;
  if (atLevel === true) {
    confidence = Math.min(0.95, confidence + 0.04);
  }

  const dteMultiplier = phaseConfig?.dteMultiplier ?? 1.0;
  const baseDteMin = isIntraday ? 1 : 5;
  const baseDteMax = isIntraday ? 7 : 21;

  const invalidation = resolveInvalidation(signal, tradeDirection === 'BULL', isIntraday);

  const strategyLabel = phase
    ? `SATYLAND_${phase.toUpperCase()}`
    : 'SATYLAND';

  return {
    intent: {
      strategy: strategyLabel,
      symbol: signal.symbol,
      direction: tradeDirection,
      structure: tradeDirection === 'BULL' ? 'LONG_CALL' : 'LONG_PUT',
      invalidation,
      dteMin: Math.round(baseDteMin * dteMultiplier),
      dteMax: Math.round(baseDteMax * dteMultiplier),
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

  const explicit = Number(raw.invalidation ?? raw.stop_loss ?? raw.stop ?? 0);
  if (explicit > 0) return explicit;

  const atrLevel = Number(raw.atr_support ?? raw.atr_resistance ?? 0);
  if (atrLevel > 0) return atrLevel;

  const price = Number(raw.price ?? 0);
  if (price <= 0) return 0;

  const pct = isIntraday ? INTRADAY_INVALIDATION_PCT : SWING_INVALIDATION_PCT;
  return Math.round(price * (isBull ? 1 - pct : 1 + pct) * 100) / 100;
}
