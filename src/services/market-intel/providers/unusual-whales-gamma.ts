import { config } from '../../../config/index.js';
import { logger } from '../../../utils/logger.js';
import { UnusualWhalesGammaSnapshot } from '../../../types/index.js';
import { rateLimiter } from '../../rate-limiter.service.js';

type RawGammaPayload = Record<string, any>;

export class UnusualWhalesGammaProvider {
  private readonly apiKey = config.unusualWhalesApiKey;
  private readonly gammaUrl = config.unusualWhalesGammaUrl;

  async fetchGammaSnapshot(symbol: string): Promise<UnusualWhalesGammaSnapshot | null> {
    if (!this.gammaUrl || !this.apiKey) {
      logger.warn('Unusual Whales gamma not configured', {
        hasApiKey: Boolean(this.apiKey),
        hasGammaUrl: Boolean(this.gammaUrl),
      });
      return null;
    }

    const minuteAllowed = await rateLimiter.tryAcquire('unusualwhales-minute');
    const dayAllowed = await rateLimiter.tryAcquire('unusualwhales-day');
    if (!minuteAllowed || !dayAllowed) {
      logger.warn('Unusual Whales rate limit exceeded', {
        symbol,
        minuteAllowed,
        dayAllowed,
      });
      return null;
    }

    const url = this.buildUrl(symbol);

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Unusual Whales gamma request failed: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const payload = (await response.json()) as RawGammaPayload;
    const normalized = this.normalizePayload(symbol, payload);

    if (!normalized) {
      logger.warn('Unusual Whales gamma payload missing net gamma', { symbol });
      return null;
    }

    return normalized;
  }

  private buildUrl(symbol: string): string {
    if (this.gammaUrl.includes('{symbol}')) {
      return this.gammaUrl.replace('{symbol}', encodeURIComponent(symbol));
    }

    try {
      const url = new URL(this.gammaUrl);
      if (!url.searchParams.has('symbol')) {
        url.searchParams.set('symbol', symbol);
      }
      return url.toString();
    } catch {
      const separator = this.gammaUrl.includes('?') ? '&' : '?';
      return `${this.gammaUrl}${separator}symbol=${encodeURIComponent(symbol)}`;
    }
  }

  private normalizePayload(
    symbol: string,
    payload: RawGammaPayload
  ): UnusualWhalesGammaSnapshot | null {
    const data = payload?.data ?? payload?.result ?? payload;

    const netGamma = this.toNumber(
      data?.net_gamma ??
        data?.netGamma ??
        data?.net_gex ??
        data?.netGex ??
        data?.gamma?.net ??
        data?.gex?.net
    );

    if (netGamma === null) {
      return null;
    }

    const zeroGammaLevel = this.toNumber(
      data?.zero_gamma ??
        data?.zeroGammaLevel ??
        data?.zero_gamma_level ??
        data?.zeroGamma ??
        data?.gex?.zero_gamma
    );

    const gammaByStrike = this.normalizeGammaByStrike(
      data?.gamma_by_strike ?? data?.gammaByStrike ?? data?.by_strike ?? data?.strikes
    );

    const timestamp =
      this.toDate(data?.timestamp ?? data?.updated_at ?? data?.updatedAt ?? payload?.timestamp) ??
      new Date();

    return {
      symbol,
      netGamma,
      zeroGammaLevel: zeroGammaLevel ?? undefined,
      gammaByStrike: gammaByStrike.length > 0 ? gammaByStrike : undefined,
      timestamp,
      source: 'unusualwhales',
    };
  }

  private normalizeGammaByStrike(value: any): Array<{ strike: number; netGamma: number }> {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((entry) => ({
        strike: this.toNumber(entry?.strike ?? entry?.k ?? entry?.price) ?? NaN,
        netGamma:
          this.toNumber(
            entry?.netGamma ??
              entry?.net_gamma ??
              entry?.net_gex ??
              entry?.gamma ??
              entry?.gex ??
              entry?.value
          ) ?? NaN,
      }))
      .filter((entry) => Number.isFinite(entry.strike) && Number.isFinite(entry.netGamma));
  }

  private toNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  private toDate(value: unknown): Date | null {
    if (!value) {
      return null;
    }

    if (value instanceof Date) {
      return value;
    }

    const asNumber = Number(value);
    if (Number.isFinite(asNumber)) {
      const ms = asNumber < 1e12 ? asNumber * 1000 : asNumber;
      const date = new Date(ms);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    const parsed = new Date(String(value));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
}
