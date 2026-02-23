import * as Sentry from '@sentry/node';
import { logger } from '../../utils/logger.js';
import { getEngineConfig } from '../config/loader.js';
import { RejectionCode } from '../types/enums.js';

export interface SessionCheckResult {
  allowed: boolean;
  rejectionCode: RejectionCode | null;
  reason: string | null;
  sessionInfo: SessionInfo;
}

export interface SessionInfo {
  marketOpen: boolean;
  currentTimeET: string;
  marketOpenET: string;
  marketCloseET: string;
  minutesSinceOpen: number;
  minutesUntilClose: number;
  isHalted: boolean;
  dayOfWeek: number;
}

export class SessionGuard {
  private haltedSymbols: Set<string> = new Set();
  private haltResumedAt: Map<string, Date> = new Map();

  /**
   * Gate check — rejects entry if market is closed or within buffer zones.
   */
  check(underlying?: string): SessionCheckResult {
    const cfg = getEngineConfig().session;
    const now = this.getNowET();
    const info = this.buildSessionInfo(now, cfg);

    // Weekend check
    if (info.dayOfWeek === 0 || info.dayOfWeek === 6) {
      return this.reject(RejectionCode.SESSION_CLOSED, 'Market closed (weekend)', info);
    }

    // Market not yet open (before 9:30 ET + buffer)
    if (!info.marketOpen) {
      if (info.minutesSinceOpen < 0) {
        return this.reject(RejectionCode.SESSION_CLOSED, 'Market not yet open', info);
      }
      return this.reject(RejectionCode.SESSION_CLOSED, 'Market closed', info);
    }

    // Open buffer: first N minutes after open
    if (info.minutesSinceOpen < cfg.openBufferMinutes) {
      return this.reject(
        RejectionCode.SESSION_CLOSED,
        `Within open buffer (${info.minutesSinceOpen}min < ${cfg.openBufferMinutes}min)`,
        info
      );
    }

    // Close buffer: last N minutes before close
    if (info.minutesUntilClose < cfg.closeBufferMinutes) {
      return this.reject(
        RejectionCode.SESSION_CLOSED,
        `Within close buffer (${info.minutesUntilClose}min < ${cfg.closeBufferMinutes}min)`,
        info
      );
    }

    // Halt check for specific underlying
    if (underlying && this.isHalted(underlying, cfg.haltResumeBufferMinutes)) {
      return this.reject(
        RejectionCode.SESSION_CLOSED,
        `${underlying} is halted or within halt resume buffer`,
        { ...info, isHalted: true }
      );
    }

    return {
      allowed: true,
      rejectionCode: null,
      reason: null,
      sessionInfo: info,
    };
  }

  /**
   * Register a halt event for a symbol.
   */
  registerHalt(symbol: string): void {
    this.haltedSymbols.add(symbol);
    this.haltResumedAt.delete(symbol);
    logger.warn('Symbol halt registered', { symbol });
    Sentry.addBreadcrumb({
      category: 'engine',
      message: `Symbol halt registered: ${symbol}`,
      level: 'warning',
      data: { symbol },
    });
  }

  /**
   * Register halt resume for a symbol.
   */
  registerHaltResume(symbol: string): void {
    this.haltedSymbols.delete(symbol);
    this.haltResumedAt.set(symbol, new Date());
    logger.info('Symbol halt resumed', { symbol });
    Sentry.addBreadcrumb({
      category: 'engine',
      message: `Symbol halt resumed: ${symbol}`,
      level: 'info',
      data: { symbol },
    });
  }

  /**
   * Check if a symbol is currently halted or within resume buffer.
   */
  private isHalted(symbol: string, resumeBufferMinutes: number): boolean {
    if (this.haltedSymbols.has(symbol)) {
      return true;
    }

    const resumedAt = this.haltResumedAt.get(symbol);
    if (resumedAt) {
      const elapsedMs = Date.now() - resumedAt.getTime();
      const bufferMs = resumeBufferMinutes * 60 * 1000;
      if (elapsedMs < bufferMs) {
        return true;
      }
      this.haltResumedAt.delete(symbol);
    }

    return false;
  }

  // ─── Time Calculations (ET-safe) ───

  private getNowET(): Date {
    const cfg = getEngineConfig().session;
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: cfg.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(new Date());
    const get = (type: string): string => parts.find(p => p.type === type)?.value ?? '0';

    const year = parseInt(get('year'));
    const month = parseInt(get('month')) - 1;
    const day = parseInt(get('day'));
    const hour = parseInt(get('hour'));
    const minute = parseInt(get('minute'));
    const second = parseInt(get('second'));

    const etDate = new Date(year, month, day, hour, minute, second);
    return etDate;
  }

  private buildSessionInfo(now: Date, cfg: { openBufferMinutes: number; closeBufferMinutes: number; dayCloseTimeET: string; timezone: string }): SessionInfo {
    const hour = now.getHours();
    const minute = now.getMinutes();
    const currentMinutes = hour * 60 + minute;
    const dayOfWeek = now.getDay();

    const marketOpenMinutes = 9 * 60 + 30; // 9:30 ET
    const [closeH, closeM] = cfg.dayCloseTimeET.split(':').map(Number);
    const marketCloseMinutes = closeH * 60 + closeM;

    const minutesSinceOpen = currentMinutes - marketOpenMinutes;
    const minutesUntilClose = marketCloseMinutes - currentMinutes;
    const marketOpen = currentMinutes >= marketOpenMinutes && currentMinutes < marketCloseMinutes
      && dayOfWeek >= 1 && dayOfWeek <= 5;

    return {
      marketOpen,
      currentTimeET: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      marketOpenET: '09:30',
      marketCloseET: cfg.dayCloseTimeET,
      minutesSinceOpen,
      minutesUntilClose,
      isHalted: false,
      dayOfWeek,
    };
  }

  private reject(code: RejectionCode, reason: string, info: SessionInfo): SessionCheckResult {
    return {
      allowed: false,
      rejectionCode: code,
      reason,
      sessionInfo: info,
    };
  }
}

export const sessionGuard = new SessionGuard();
