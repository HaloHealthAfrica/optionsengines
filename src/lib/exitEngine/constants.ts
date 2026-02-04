import type { ExitPolicy } from './types.js';
import type { SetupType } from '../shared/types.js';

export const EXIT_POLICIES: Record<SetupType, ExitPolicy> = {
  SCALP_GUARDED: {
    maxHoldMinutes: 90,
    progressChecks: [
      { atMinute: 15, minProfitPercent: 5 },
      { atMinute: 30, minProfitPercent: 10 },
    ],
    thetaBurnLimit: 20,
    profitPartials: [
      { atPercent: 15, exitPercent: 50 },
      { atPercent: 30, exitPercent: 75 },
    ],
    timeStops: [],
  },
  SWING: {
    maxHoldMinutes: 14 * 24 * 60,
    progressChecks: [
      { atMinute: 3 * 24 * 60, minProfitPercent: 10 },
      { atMinute: 7 * 24 * 60, minProfitPercent: 15 },
    ],
    thetaBurnLimit: 30,
    profitPartials: [
      { atPercent: 25, exitPercent: 33 },
      { atPercent: 50, exitPercent: 50 },
      { atPercent: 80, exitPercent: 75 },
    ],
    timeStops: [
      { atDay: 7, action: 'CHECK_PROGRESS' },
      { atDay: 14, action: 'EXIT_IF_FLAT' },
    ],
  },
  POSITION: {
    maxHoldMinutes: 60 * 24 * 60,
    progressChecks: [
      { atMinute: 14 * 24 * 60, minProfitPercent: 15 },
      { atMinute: 30 * 24 * 60, minProfitPercent: 20 },
    ],
    thetaBurnLimit: 40,
    profitPartials: [
      { atPercent: 30, exitPercent: 33 },
      { atPercent: 60, exitPercent: 50 },
      { atPercent: 100, exitPercent: 75 },
    ],
    timeStops: [
      { atDay: 30, action: 'CHECK_PROGRESS' },
      { atDay: 45, action: 'TIGHTEN_STOP' },
    ],
  },
  LEAPS: {
    maxHoldMinutes: 365 * 24 * 60,
    progressChecks: [
      { atMinute: 60 * 24 * 60, minProfitPercent: 20 },
      { atMinute: 120 * 24 * 60, minProfitPercent: 30 },
    ],
    thetaBurnLimit: 50,
    profitPartials: [
      { atPercent: 40, exitPercent: 25 },
      { atPercent: 80, exitPercent: 50 },
      { atPercent: 150, exitPercent: 75 },
    ],
    timeStops: [
      { atDay: 90, action: 'REVIEW_THESIS' },
      { atDay: 180, action: 'CHECK_PROGRESS' },
    ],
  },
};
