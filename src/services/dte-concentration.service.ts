import { db } from './database.service.js';
import { logger } from '../utils/logger.js';

const MAX_POSITIONS_SAME_EXPIRY_WEEK = 3;
const MAX_BUCKET_CONCENTRATION = 0.60;
const EXPIRY_WINDOW_DAYS = 5;

export interface DTEConcentrationCheck {
  allowed: boolean;
  reasons: string[];
}

interface OpenPositionExpiry {
  position_id: string;
  expiration: Date;
}

function dteBucket(dte: number): string {
  if (dte <= 7) return '0-7';
  if (dte <= 30) return '7-30';
  if (dte <= 90) return '30-90';
  return '90+';
}

export async function checkDTEConcentration(
  newExpiration: Date
): Promise<DTEConcentrationCheck> {
  try {
    const result = await db.query<OpenPositionExpiry>(
      `SELECT position_id, expiration
       FROM refactored_positions
       WHERE status IN ('open', 'closing')
         AND COALESCE(is_test, false) = false`
    );

    const positions = result.rows;
    const reasons: string[] = [];
    let allowed = true;
    const now = new Date();

    const newDte = Math.max(0, (newExpiration.getTime() - now.getTime()) / 86_400_000);

    let sameWeekCount = 0;
    for (const pos of positions) {
      const expDate = new Date(pos.expiration);
      const daysDiff = Math.abs(newExpiration.getTime() - expDate.getTime()) / 86_400_000;
      if (daysDiff <= EXPIRY_WINDOW_DAYS) {
        sameWeekCount++;
      }
    }

    if (sameWeekCount >= MAX_POSITIONS_SAME_EXPIRY_WEEK) {
      allowed = false;
      reasons.push(
        `${sameWeekCount}_positions_expire_within_${EXPIRY_WINDOW_DAYS}d_of_new_trade`
      );
    }

    const newBucket = dteBucket(newDte);
    const bucketCounts: Record<string, number> = { '0-7': 0, '7-30': 0, '30-90': 0, '90+': 0 };
    for (const pos of positions) {
      const posDte = Math.max(0, (new Date(pos.expiration).getTime() - now.getTime()) / 86_400_000);
      bucketCounts[dteBucket(posDte)]++;
    }
    bucketCounts[newBucket]++;

    const totalAfterNew = positions.length + 1;
    const bucketRatio = totalAfterNew > 0 ? bucketCounts[newBucket] / totalAfterNew : 0;

    if (bucketRatio > MAX_BUCKET_CONCENTRATION && totalAfterNew > 2) {
      allowed = false;
      reasons.push(
        `dte_bucket_${newBucket}_would_be_${Math.round(bucketRatio * 100)}pct_of_portfolio`
      );
    }

    if (!allowed) {
      logger.warn('DTE concentration check BLOCKED', { reasons, newExpiration, newDte: Math.round(newDte) });
    }

    return { allowed, reasons };
  } catch (err) {
    logger.warn('DTE concentration check failed — fail-closed', { error: err });
    return { allowed: false, reasons: ['db_unavailable_fail_closed'] };
  }
}
