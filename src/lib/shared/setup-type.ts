/**
 * Shared setup type derivation from signal timeframe.
 * Used by entry adapter, exit adapter, and advanced strike selection.
 */
import type { SetupType } from './types.js';

/**
 * Derive SetupType from signal timeframe.
 * Intraday (<=15m) → SCALP_GUARDED, daily/4h → SWING, weekly → POSITION, monthly → LEAPS
 */
export function deriveSetupType(timeframe: string): SetupType {
  const tf = String(timeframe || '').toLowerCase();
  if (tf.includes('1m') || tf.includes('3m') || tf.includes('5m') || tf.includes('15m') || tf === 'scalp') {
    return 'SCALP_GUARDED';
  }
  if (tf.includes('30m') || tf.includes('1h') || tf.includes('4h') || tf.includes('d') || tf === 'swing') {
    return 'SWING';
  }
  if (tf.includes('w') || tf === 'position') {
    return 'POSITION';
  }
  if (tf.includes('m') && (tf.includes('month') || parseInt(tf, 10) > 30)) {
    return 'LEAPS';
  }
  return 'SWING'; // safe default
}

/**
 * Derive SetupType from DTE at entry (for positions without stored timeframe).
 */
export function deriveSetupTypeFromDte(dteAtEntry: number): SetupType {
  if (dteAtEntry < 14) return 'SCALP_GUARDED';
  if (dteAtEntry < 90) return 'SWING';
  if (dteAtEntry < 180) return 'POSITION';
  return 'LEAPS';
}
