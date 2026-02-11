type SessionLabel = 'RTH' | 'PRE' | 'POST' | 'CLOSED';

export type MarketSessionHint = 'RTH' | 'PRE' | 'POST' | 'OPEN' | 'ETH' | 'CLOSED';

export type MarketSessionEvaluation = {
  sessionLabel: SessionLabel;
  sessionType: 'RTH' | 'ETH' | 'CLOSED';
  isOpen: boolean;
  withinGrace: boolean;
  minuteOfDay: number;
  isWeekend: boolean;
};

const ET_TIMEZONE = 'America/New_York';
const ET_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

export function normalizeMarketSession(raw: unknown): MarketSessionHint | null {
  if (!raw) return null;
  const value = String(raw).trim().toUpperCase();
  if (!value) return null;

  if (['RTH', 'REGULAR', 'OPEN'].includes(value)) return 'RTH';
  if (['PRE', 'PREMARKET', 'PRE-MARKET', 'PM'].includes(value)) return 'PRE';
  if (['POST', 'AFTERHOURS', 'AFTER-HOURS', 'AH'].includes(value)) return 'POST';
  if (['ETH', 'EXTENDED', 'EXT'].includes(value)) return 'ETH';
  if (['CLOSED', 'OFF'].includes(value)) return 'CLOSED';

  return null;
}

export function evaluateMarketSession(input: {
  timestamp: Date;
  allowPremarket: boolean;
  allowAfterhours: boolean;
  gracePeriodMinutes: number;
}): MarketSessionEvaluation {
  const parts = ET_FORMATTER.formatToParts(input.timestamp);
  const values = parts.reduce<Record<string, string>>((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  const hour = Number(values.hour ?? 0);
  const minute = Number(values.minute ?? 0);
  const weekday = values.weekday ?? '';
  const minuteOfDay = hour * 60 + minute;
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';

  const rthStart = 9 * 60 + 30;
  const rthEnd = 16 * 60;
  const preStart = 4 * 60;
  const postEnd = 20 * 60;

  const withinGrace =
    input.gracePeriodMinutes > 0 &&
    minuteOfDay >= rthEnd &&
    minuteOfDay < rthEnd + input.gracePeriodMinutes;

  let sessionLabel: SessionLabel = 'CLOSED';
  if (!isWeekend) {
    if (minuteOfDay >= rthStart && minuteOfDay < rthEnd) {
      sessionLabel = 'RTH';
    } else if (minuteOfDay >= preStart && minuteOfDay < rthStart) {
      sessionLabel = 'PRE';
    } else if (minuteOfDay >= rthEnd && minuteOfDay < postEnd) {
      sessionLabel = 'POST';
    }
  }

  let isOpen = false;
  if (sessionLabel === 'RTH') {
    isOpen = true;
  } else if (sessionLabel === 'PRE') {
    isOpen = input.allowPremarket;
  } else if (sessionLabel === 'POST') {
    isOpen = input.allowAfterhours;
  }

  if (withinGrace && !isWeekend) {
    isOpen = true;
    sessionLabel = 'RTH';
  }

  const sessionType = sessionLabel === 'RTH' ? 'RTH' : sessionLabel === 'CLOSED' ? 'CLOSED' : 'ETH';

  return {
    sessionLabel,
    sessionType,
    isOpen,
    withinGrace,
    minuteOfDay,
    isWeekend,
  };
}
