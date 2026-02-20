/**
 * Market Hours Utility - Centralized Eastern Time, trading windows, holidays, session labels.
 * Uses Intl.DateTimeFormat('America/New_York') for reliable DST-aware ET conversion.
 * Used by orchestrator, cron workers, market-data fallbacks, and provider clients.
 */

const ET_TIMEZONE = 'America/New_York';

const ET_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

const ET_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export type ETTime = {
  hour: number;
  minute: number;
  minuteOfDay: number;
  weekday: string;
  isWeekend: boolean;
  dateStr: string;       // YYYY-MM-DD in ET
  displayTime: string;   // "14:54 ET"
};

export type MarketClock = ETTime & {
  isHoliday: boolean;
  isMarketOpen: boolean;
  minutesUntilClose: number | null;
  minutesSinceOpen: number | null;
  session: SessionLabel;
  closingSoon: boolean;   // <=15 min until close
  powerHour: boolean;     // 14:00-16:00 ET
};

const MARKET_HOLIDAYS: Set<string> = new Set([
  // 2025
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-04-18',
  '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01',
  '2025-11-27', '2025-12-25',
  // 2026
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03',
  '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07',
  '2026-11-26', '2026-12-25',
  // 2027
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26',
  '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06',
  '2027-11-25', '2027-12-24',
]);

const RTH_OPEN = 9 * 60 + 30;  // 570
const RTH_CLOSE = 16 * 60;     // 960
const PRE_START = 8 * 60;      // 480
const CLOSING_SOON_THRESHOLD = 15; // minutes

/**
 * Get current Eastern Time components using Intl.DateTimeFormat (DST-safe).
 */
export function getETTime(now: Date = new Date()): ETTime {
  const timeParts = ET_TIME_FORMATTER.formatToParts(now);
  const tv: Record<string, string> = {};
  for (const p of timeParts) tv[p.type] = p.value;

  const dateParts = ET_DATE_FORMATTER.formatToParts(now);
  const dv: Record<string, string> = {};
  for (const p of dateParts) dv[p.type] = p.value;

  const hour = Number(tv.hour ?? 0);
  const minute = Number(tv.minute ?? 0);
  const minuteOfDay = hour * 60 + minute;
  const weekday = tv.weekday ?? '';
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const dateStr = `${dv.year}-${dv.month}-${dv.day}`;
  const displayTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ET`;

  return { hour, minute, minuteOfDay, weekday, isWeekend, dateStr, displayTime };
}

/**
 * Full market clock: session, minutes until close, holiday check, closing-soon flag.
 */
export function getMarketClock(now: Date = new Date()): MarketClock {
  const et = getETTime(now);
  const isHoliday = MARKET_HOLIDAYS.has(et.dateStr);
  const isTradingDay = !et.isWeekend && !isHoliday;
  const isMarketOpen = isTradingDay && et.minuteOfDay >= RTH_OPEN && et.minuteOfDay < RTH_CLOSE;

  const minutesUntilClose = isMarketOpen ? RTH_CLOSE - et.minuteOfDay : null;
  const minutesSinceOpen = isMarketOpen ? et.minuteOfDay - RTH_OPEN : null;
  const closingSoon = isMarketOpen && minutesUntilClose !== null && minutesUntilClose <= CLOSING_SOON_THRESHOLD;
  const powerHour = isMarketOpen && et.minuteOfDay >= 14 * 60;
  const session = getSessionFromMinute(et.minuteOfDay, isTradingDay);

  return {
    ...et,
    isHoliday,
    isMarketOpen,
    minutesUntilClose,
    minutesSinceOpen,
    session,
    closingSoon,
    powerHour,
  };
}

export type SessionLabel = 'premarket' | 'open' | 'midday' | 'power_hour' | 'afterhours';

function getSessionFromMinute(minuteOfDay: number, isTradingDay: boolean): SessionLabel {
  if (!isTradingDay) return 'afterhours';
  if (minuteOfDay < RTH_OPEN) return 'premarket';
  if (minuteOfDay < 10 * 60 + 30) return 'open';        // 9:30 - 10:30
  if (minuteOfDay < 14 * 60) return 'midday';            // 10:30 - 14:00
  if (minuteOfDay < RTH_CLOSE) return 'power_hour';      // 14:00 - 16:00
  return 'afterhours';
}

// --- Legacy API (backward-compatible) ---

export function isMarketOpen(): boolean {
  return getMarketClock().isMarketOpen;
}

export function isPreMarket(): boolean {
  const clock = getMarketClock();
  if (clock.isWeekend || clock.isHoliday) return false;
  return clock.minuteOfDay >= PRE_START && clock.minuteOfDay < RTH_OPEN;
}

export function isWithinTradingWindow(): boolean {
  return isMarketOpen() || isPreMarket();
}

export function getCurrentSession(): SessionLabel {
  return getMarketClock().session;
}

export function isLastTradingDayOfMonth(): boolean {
  const et = getETTime();
  if (et.isWeekend) return false;
  const parts = et.dateStr.split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const lastDay = new Date(year, month, 0).getDate();
  if (day === lastDay) return true;
  const lastDate = new Date(year, month, 0);
  const lastDayOfWeek = lastDate.getDay();
  if (lastDayOfWeek === 0) return day === lastDay - 2;
  if (lastDayOfWeek === 6) return day === lastDay - 1;
  return false;
}

export function is4HCandleClose(): { atClose: boolean; label?: string } {
  const { hour, minute } = getETTime();
  if (minute >= 25 && minute <= 35 && hour === 9) return { atClose: true, label: '9:30' };
  if (minute >= 25 && minute <= 35 && hour === 13) return { atClose: true, label: '13:30' };
  if (minute >= 55 || (hour === 16 && minute <= 5)) return { atClose: true, label: '16:00' };
  return { atClose: false };
}
