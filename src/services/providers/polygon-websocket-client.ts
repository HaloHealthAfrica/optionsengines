// Polygon.io WebSocket Client - Real-time streaming data
import WebSocket from 'ws';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { EventEmitter } from 'events';

// WebSocket message types
interface PolygonWSMessage {
  ev: string; // event type
  sym?: string; // symbol
  p?: number; // price
  s?: number; // size
  t?: number; // timestamp
  bp?: number; // bid price
  ap?: number; // ask price
  bs?: number; // bid size
  as?: number; // ask size
  o?: number; // open
  h?: number; // high
  l?: number; // low
  c?: number; // close
  v?: number; // volume
  vw?: number; // volume weighted average
}

interface PolygonQuoteUpdate {
  symbol: string;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  timestamp: Date;
}

interface PolygonTradeUpdate {
  symbol: string;
  price: number;
  size: number;
  timestamp: Date;
}

interface PolygonAggUpdate {
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap: number;
  timestamp: Date;
}

export class PolygonWebSocketClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private readonly apiKey: string;
  private readonly wsUrl: string;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 10;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private subscribedSymbols: Set<string> = new Set();
  private isAuthenticated: boolean = false;
  private isConnecting: boolean = false;

  constructor() {
    super();
    this.apiKey = config.polygonApiKey || '';
    
    // Polygon WebSocket URLs
    // Stocks: wss://socket.polygon.io/stocks
    // Options: wss://socket.polygon.io/options
    // Forex: wss://socket.polygon.io/forex
    // Crypto: wss://socket.polygon.io/crypto
    this.wsUrl = 'wss://socket.polygon.io/stocks';

    if (!this.apiKey) {
      logger.warn('Polygon API key not configured for WebSocket');
    }
  }

  /**
   * Connect to Polygon WebSocket
   */
  async connect(): Promise<void> {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      logger.debug('WebSocket already connected or connecting');
      return;
    }

    if (!this.apiKey) {
      throw new Error('Polygon API key not configured');
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      try {
        logger.info('Connecting to Polygon WebSocket', { url: this.wsUrl });

        this.ws = new WebSocket(this.wsUrl);

        this.ws.on('open', () => {
          logger.info('Polygon WebSocket connected');
          this.isConnecting = false;
          this.reconnectAttempts = 0;
          
          // Authenticate
          this.authenticate();
          
          // Start heartbeat
          this.startHeartbeat();
          
          resolve();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          this.handleMessage(data);
        });

        this.ws.on('error', (error) => {
          logger.error('Polygon WebSocket error', error);
          this.isConnecting = false;
          this.emit('error', error);
          reject(error);
        });

        this.ws.on('close', (code, reason) => {
          logger.warn('Polygon WebSocket closed', { code, reason: reason.toString() });
          this.isConnecting = false;
          this.isAuthenticated = false;
          this.stopHeartbeat();
          this.emit('close', { code, reason });
          
          // Attempt reconnection
          this.scheduleReconnect();
        });

      } catch (error) {
        this.isConnecting = false;
        logger.error('Failed to create WebSocket connection', error);
        reject(error);
      }
    });
  }

  /**
   * Authenticate with Polygon WebSocket
   */
  private authenticate(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.error('Cannot authenticate: WebSocket not open');
      return;
    }

    const authMessage = {
      action: 'auth',
      params: this.apiKey,
    };

    logger.debug('Authenticating with Polygon WebSocket');
    this.ws.send(JSON.stringify(authMessage));
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(data: WebSocket.Data): void {
    try {
      const messages: PolygonWSMessage[] = JSON.parse(data.toString());

      for (const message of messages) {
        switch (message.ev) {
          case 'status':
            this.handleStatusMessage(message);
            break;
          
          case 'Q': // Quote
            this.handleQuoteMessage(message);
            break;
          
          case 'T': // Trade
            this.handleTradeMessage(message);
            break;
          
          case 'A': // Aggregate (second)
          case 'AM': // Aggregate (minute)
            this.handleAggregateMessage(message);
            break;
          
          default:
            logger.debug('Unknown message type', { event: message.ev });
        }
      }
    } catch (error) {
      logger.error('Failed to parse WebSocket message', error);
    }
  }

  /**
   * Handle status messages (auth confirmation, etc.)
   */
  private handleStatusMessage(message: any): void {
    logger.info('Polygon WebSocket status', { message: message.message, status: message.status });

    if (message.status === 'auth_success') {
      this.isAuthenticated = true;
      this.emit('authenticated');
      
      // Resubscribe to symbols if reconnecting
      if (this.subscribedSymbols.size > 0) {
        logger.info('Resubscribing to symbols after reconnection', {
          count: this.subscribedSymbols.size,
        });
        this.resubscribeAll();
      }
    } else if (message.status === 'auth_failed') {
      logger.error('Polygon WebSocket authentication failed');
      this.emit('auth_failed');
      this.disconnect();
    }
  }

  /**
   * Handle quote messages (bid/ask updates)
   */
  private handleQuoteMessage(message: PolygonWSMessage): void {
    if (!message.sym || !message.bp || !message.ap) return;

    const quote: PolygonQuoteUpdate = {
      symbol: message.sym,
      bid: message.bp,
      ask: message.ap,
      bidSize: message.bs || 0,
      askSize: message.as || 0,
      timestamp: new Date(message.t || Date.now()),
    };

    this.emit('quote', quote);
  }

  /**
   * Handle trade messages (actual trades)
   */
  private handleTradeMessage(message: PolygonWSMessage): void {
    if (!message.sym || !message.p) return;

    const trade: PolygonTradeUpdate = {
      symbol: message.sym,
      price: message.p,
      size: message.s || 0,
      timestamp: new Date(message.t || Date.now()),
    };

    this.emit('trade', trade);
  }

  /**
   * Handle aggregate messages (OHLCV bars)
   */
  private handleAggregateMessage(message: PolygonWSMessage): void {
    if (!message.sym || !message.o || !message.h || !message.l || !message.c) return;

    const agg: PolygonAggUpdate = {
      symbol: message.sym,
      open: message.o,
      high: message.h,
      low: message.l,
      close: message.c,
      volume: message.v || 0,
      vwap: message.vw || 0,
      timestamp: new Date(message.t || Date.now()),
    };

    this.emit('aggregate', agg);
  }

  /**
   * Subscribe to real-time quotes for symbols
   */
  subscribeQuotes(symbols: string[]): void {
    if (!this.isAuthenticated) {
      logger.warn('Cannot subscribe: not authenticated yet');
      // Store for later subscription after auth
      symbols.forEach(sym => this.subscribedSymbols.add(sym));
      return;
    }

    const subscribeMessage = {
      action: 'subscribe',
      params: symbols.map(sym => `Q.${sym}`).join(','),
    };

    logger.info('Subscribing to quotes', { symbols });
    this.send(subscribeMessage);
    
    symbols.forEach(sym => this.subscribedSymbols.add(sym));
  }

  /**
   * Subscribe to real-time trades for symbols
   */
  subscribeTrades(symbols: string[]): void {
    if (!this.isAuthenticated) {
      logger.warn('Cannot subscribe: not authenticated yet');
      symbols.forEach(sym => this.subscribedSymbols.add(sym));
      return;
    }

    const subscribeMessage = {
      action: 'subscribe',
      params: symbols.map(sym => `T.${sym}`).join(','),
    };

    logger.info('Subscribing to trades', { symbols });
    this.send(subscribeMessage);
    
    symbols.forEach(sym => this.subscribedSymbols.add(sym));
  }

  /**
   * Subscribe to aggregates (minute bars) for symbols
   */
  subscribeAggregates(symbols: string[]): void {
    if (!this.isAuthenticated) {
      logger.warn('Cannot subscribe: not authenticated yet');
      symbols.forEach(sym => this.subscribedSymbols.add(sym));
      return;
    }

    const subscribeMessage = {
      action: 'subscribe',
      params: symbols.map(sym => `AM.${sym}`).join(','), // AM = minute aggregates
    };

    logger.info('Subscribing to aggregates', { symbols });
    this.send(subscribeMessage);
    
    symbols.forEach(sym => this.subscribedSymbols.add(sym));
  }

  /**
   * Unsubscribe from symbols
   */
  unsubscribe(symbols: string[]): void {
    const unsubscribeMessage = {
      action: 'unsubscribe',
      params: symbols.map(sym => `Q.${sym},T.${sym},AM.${sym}`).join(','),
    };

    logger.info('Unsubscribing from symbols', { symbols });
    this.send(unsubscribeMessage);
    
    symbols.forEach(sym => this.subscribedSymbols.delete(sym));
  }

  /**
   * Resubscribe to all symbols (after reconnection)
   */
  private resubscribeAll(): void {
    if (this.subscribedSymbols.size === 0) return;

    const symbols = Array.from(this.subscribedSymbols);
    
    // Subscribe to quotes, trades, and aggregates
    this.subscribeQuotes(symbols);
    this.subscribeTrades(symbols);
    this.subscribeAggregates(symbols);
  }

  /**
   * Send message to WebSocket
   */
  private send(message: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      logger.error('Cannot send message: WebSocket not open');
      return;
    }

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Start heartbeat to keep connection alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Polygon doesn't require explicit ping, but we can check connection
        logger.debug('WebSocket heartbeat check');
      }
    }, 30000); // Every 30 seconds
  }

  /**
   * Stop heartbeat
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached, giving up');
      this.emit('max_reconnect_attempts');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    logger.info('Scheduling reconnection', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });

    this.reconnectTimeout = setTimeout(() => {
      logger.info('Attempting to reconnect', { attempt: this.reconnectAttempts });
      this.connect().catch((error) => {
        logger.error('Reconnection failed', error);
      });
    }, delay);
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    logger.info('Disconnecting from Polygon WebSocket');

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isAuthenticated = false;
    this.isConnecting = false;
  }

  /**
   * Get connection status
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN && this.isAuthenticated;
  }

  /**
   * Get subscribed symbols
   */
  getSubscribedSymbols(): string[] {
    return Array.from(this.subscribedSymbols);
  }
}

// Singleton instance
export const polygonWebSocket = new PolygonWebSocketClient();
