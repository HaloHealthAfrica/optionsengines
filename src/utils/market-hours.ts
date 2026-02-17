/**
 * Market Hours Utility - Trading window, holidays, session labels
 * Used by Tier 1/2 cron workers to gate scans during market hours.
 * Times in America/New_York (EST/EDT).
 */

const MARKET_HOLIDAYS_2026 = [
  '2026-01-01', // New Year's Day
  '2026-01-19', // MLK Day
  '2026-02-16', // Presidents' Day
  '2026-04-03', // Good Friday
  '2026-05-25', // Memorial Day
  '2026-06-19', // Juneteenth
  '2026-07-03', // Independence Day (observed)
  '2026-09-07', // Labor Day
  '2026-11-26', // Thanksgiving
  '2026-12-25', // Christmas
];

const ET_TIMEZONE = 'America/New_York';

function getESTDate(): Date {
  const now = new Date();
  return new Date(now.toLocaleString('en-US', { timeZone: ET_TIMEZONE }));
}

function getDateStr(d: Date): string {
  return d.toISOString().split('T')[0] ?? '';
}

export function isMarketOpen(): boolean {
  const est = getESTDate();
  const day = est.getDay();
  if (day === 0 || day === 6) return false; // Weekend

  const dateStr = getDateStr(est);
  if (MARKET_HOLIDAYS_2026.includes(dateStr)) return false;

  const hours = est.getHours();
  const minutes = est.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // 9:30 AM to 4:00 PM EST
  return timeInMinutes >= 570 && timeInMinutes <= 960;
}

export function isPreMarket(): boolean {
  const est = getESTDate();
  const day = est.getDay();
  if (day === 0 || day === 6) return false;

  const hours = est.getHours();
  const minutes = est.getMinutes();
  const timeInMinutes = hours * 60 + minutes;

  // 8:00 AM to 9:30 AM EST
  return timeInMinutes >= 480 && timeInMinutes < 570;
}

export function isWithinTradingWindow(): boolean {
  return isMarketOpen() || isPreMarket();
}

export type SessionLabel = 'premarket' | 'open' | 'midday' | 'power_hour' | 'afterhours';

export function getCurrentSession(): SessionLabel {
  const est = getESTDate();
  const day = est.getDay();
  if (day === 0 || day === 6) return 'afterhours';

  const dateStr = getDateStr(est);
  if (MARKET_HOLIDAYS_2026.includes(dateStr)) return 'afterhours';

  const mins = est.getHours() * 60 + est.getMinutes();

  if (mins < 570) return 'premarket';
  if (mins < 630) return 'open'; // 9:30 - 10:30
  if (mins < 840) return 'midday'; // 10:30 - 2:00
  if (mins < 960) return 'power_hour'; // 2:00 - 4:00
  return 'afterhours';
}

/** Check if it's the last trading day of the month */
export function isLastTradingDayOfMonth(): boolean {
  const est = getESTDate();
  const day = est.getDay();
  const date = est.getDate();
  const month = est.getMonth();

  // Skip weekends
  if (day === 0 || day === 6) return false;

  // Get last day of month
  const lastDay = new Date(est.getFullYear(), month + 1, 0).getDate();

  // If today is last day, we're good
  if (date === lastDay) return true;

  // If last day falls on weekend, check if we're on the last trading day
  const lastDate = new Date(est.getFullYear(), month + 1, 0);
  const lastDayOfWeek = lastDate.getDay();
  if (lastDayOfWeek === 0) {
    // Sunday - last trading day is Friday before
    return date === lastDay - 2;
  }
  if (lastDayOfWeek === 6) {
    // Saturday - last trading day is Friday before
    return date === lastDay - 1;
  }
  return false;
}

/** Check if we're at a 4H candle close (9:30, 13:30, 16:00 EST) */
export function is4HCandleClose(): { atClose: boolean; label?: string } {
  const est = getESTDate();
  const hours = est.getHours();
  const minutes = est.getMinutes();

  if (minutes >= 25 && minutes <= 35 && hours === 9) return { atClose: true, label: '9:30' };
  if (minutes >= 25 && minutes <= 35 && hours === 13) return { atClose: true, label: '13:30' };
  if (minutes >= 55 || (hours === 16 && minutes <= 5)) return { atClose: true, label: '16:00' };
  return { atClose: false };
}
