// Market Data Stream Service - Real-time quote cache via Polygon WebSocket
import { polygonWebSocket } from './providers/polygon-websocket-client.js';
import { logger } from '../utils/logger.js';

type QuoteSnapshot = {
  bid: number;
  ask: number;
  mid: number;
  timestamp: Date;
};

export class MarketDataStreamService {
  private readonly quoteCache: Map<string, QuoteSnapshot> = new Map();
  private readonly maxQuoteAgeMs: number = 10000;
  private started: boolean = false;
  private lastQuoteAt: Date | null = null;

  constructor() {
    polygonWebSocket.on('quote', (quote: any) => {
      const symbol = String(quote.symbol || '').toUpperCase();
      if (!symbol || typeof quote.bid !== 'number' || typeof quote.ask !== 'number') return;

      const mid = (quote.bid + quote.ask) / 2;
      this.lastQuoteAt = new Date();
      this.quoteCache.set(symbol, {
        bid: quote.bid,
        ask: quote.ask,
        mid,
        timestamp: quote.timestamp instanceof Date ? quote.timestamp : new Date(),
      });
    });

    polygonWebSocket.on('error', (error: any) => {
      logger.warn('Market data WebSocket error', { error });
    });

    polygonWebSocket.on('close', ({ code, reason }: any) => {
      logger.warn('Market data WebSocket closed', { code, reason: String(reason || '') });
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    polygonWebSocket.connect().catch((error) => {
      logger.warn('Failed to connect market data WebSocket', { error });
    });
  }

  ensureSubscribed(symbol: string): void {
    const normalized = symbol.toUpperCase();
    polygonWebSocket.subscribeQuotes([normalized]);
  }

  getLatestQuote(symbol: string, maxAgeMs: number = this.maxQuoteAgeMs): QuoteSnapshot | null {
    const normalized = symbol.toUpperCase();
    const cached = this.quoteCache.get(normalized);
    if (!cached) return null;

    if (Date.now() - cached.timestamp.getTime() > maxAgeMs) {
      return null;
    }

    return cached;
  }

  getStatus(): {
    enabled: boolean;
    connected: boolean;
    subscribedSymbols: string[];
    lastQuoteAt: string | null;
  } {
    return {
      enabled: this.started,
      connected: polygonWebSocket.isConnected(),
      subscribedSymbols: polygonWebSocket.getSubscribedSymbols(),
      lastQuoteAt: this.lastQuoteAt ? this.lastQuoteAt.toISOString() : null,
    };
  }
}

export const marketDataStream = new MarketDataStreamService();
