const symbols = ['SPY', 'QQQ', 'AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMD', 'META', 'NFLX', 'IWM'];

export const portfolioMetrics = [
  {
    label: 'Total P&L',
    value: '$12,450.82',
    delta: '+15.3%',
    trend: 'up',
  },
  {
    label: 'Win Rate',
    value: '68.5%',
    delta: '+2.1%',
    trend: 'up',
  },
  {
    label: 'Active Positions',
    value: '8',
    delta: '-1',
    trend: 'down',
  },
  {
    label: 'Profit Factor',
    value: '2.34',
    delta: '+0.12%',
    trend: 'up',
  },
];

export const performanceSeries = [
  { name: 'Jan', value: 8200 },
  { name: 'Feb', value: 9400 },
  { name: 'Mar', value: 10150 },
  { name: 'Apr', value: 11200 },
  { name: 'May', value: 10850 },
  { name: 'Jun', value: 12450 },
];

export const recentActivity = [
  { symbol: 'SPY', action: 'Opened', time: '2 hours ago', pnl: '+3.2%' },
  { symbol: 'QQQ', action: 'Closed', time: '4 hours ago', pnl: '-1.5%' },
  { symbol: 'AAPL', action: 'Opened', time: '1 day ago', pnl: '+5.8%' },
  { symbol: 'TSLA', action: 'Closed', time: '1 day ago', pnl: '+12.3%' },
  { symbol: 'MSFT', action: 'Opened', time: '2 days ago', pnl: '+2.1%' },
];

export const trades = Array.from({ length: 22 }).map((_, idx) => {
  const symbol = symbols[idx % symbols.length];
  const isCall = idx % 2 === 0;
  const sign = idx % 3 === 0 ? '-' : '+';
  return {
    id: `TRD-${1000 + idx}`,
    symbol,
    type: isCall ? 'Call' : 'Put',
    strike: 350 + idx * 5,
    expiry: '2024-03-15',
    qty: 5 + (idx % 5),
    price: (2.1 + idx * 0.15).toFixed(2),
    status: idx % 4 === 0 ? 'pending' : 'filled',
    time: `${8 + (idx % 5)}:${idx % 2 === 0 ? '30' : '15'} AM`,
    pnl: `${sign}${(1.2 + idx * 0.3).toFixed(1)}%`,
  };
});

export const positioningData = {
  gex: {
    total: '$2.4B',
    call: '$1.8B',
    put: '$600M',
  },
  optionsFlow: {
    premium: '$420M',
    bullish: 72,
    bearish: 28,
  },
  maxPain: {
    strike: '$445.00',
    note: 'Price level with maximum options pain',
  },
  correlation: [
    { label: 'GEX vs Price', value: 0.82, color: 'bg-sky-400' },
    { label: 'Flow vs Momentum', value: 0.76, color: 'bg-emerald-400' },
    { label: 'Volume vs Volatility', value: 0.64, color: 'bg-fuchsia-400' },
  ],
};

export const historyStats = {
  totalPnl: '$12,450.82',
  winRate: '68.5%',
  profitFactor: '2.34',
  avgHold: '3.2 days',
};

export const tradeTimeline = [
  { symbol: 'SPY', type: 'Call', date: '2024-02-04', pnl: '+8.5%', value: '$1,250' },
  { symbol: 'AAPL', type: 'Put', date: '2024-02-03', pnl: '-2.3%', value: '$850' },
  { symbol: 'TSLA', type: 'Call', date: '2024-02-02', pnl: '+15.7%', value: '$2,100' },
  { symbol: 'NVDA', type: 'Call', date: '2024-02-01', pnl: '+4.2%', value: '$640' },
  { symbol: 'MSFT', type: 'Put', date: '2024-01-31', pnl: '-1.2%', value: '$310' },
];

export const systemStatus = {
  health: 'Healthy',
  database: 'Connected',
  uptime: '5d 12h 34m',
  features: [
    { name: 'Live Trading', enabled: false },
    { name: 'Auto-hedging', enabled: true },
    { name: 'Risk Limits', enabled: true },
    { name: 'Email Alerts', enabled: false },
  ],
  mode: 'Paper',
};

export const monitoringStatus = {
  timestamp: new Date().toISOString(),
  webhooks: {
    recent: [
      {
        event_id: 'evt-1',
        status: 'accepted',
        symbol: 'SPY',
        direction: 'long',
        timeframe: '5m',
        variant: 'A',
        processing_time_ms: 412,
        created_at: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
      },
      {
        event_id: 'evt-2',
        status: 'duplicate',
        symbol: 'QQQ',
        direction: 'short',
        timeframe: '15m',
        variant: 'B',
        processing_time_ms: 120,
        created_at: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
      },
    ],
    summary_24h: {
      total: 42,
      accepted: 35,
      duplicate: 5,
      invalid_signature: 1,
      invalid_payload: 0,
      error: 1,
    },
  },
  engines: {
    by_variant_24h: { A: 28, B: 14 },
  },
  websocket: {
    enabled: false,
    connected: false,
    subscribedSymbols: [],
    lastQuoteAt: null,
  },
  providers: {
    circuit_breakers: {
      alpaca: { state: 'closed', failures: 0 },
      polygon: { state: 'closed', failures: 0 },
      marketdata: { state: 'closed', failures: 0 },
      twelvedata: { state: 'half-open', failures: 2 },
    },
    down: ['twelvedata'],
    rate_limits: [
      { provider: 'alpaca', capacity: 200, currentTokens: 150, utilizationPercent: '25.00%', requestsAllowed: 120, requestsBlocked: 0 },
      { provider: 'polygon', capacity: 5, currentTokens: 4, utilizationPercent: '20.00%', requestsAllowed: 8, requestsBlocked: 0 },
      { provider: 'marketdata', capacity: 100, currentTokens: 96, utilizationPercent: '4.00%', requestsAllowed: 4, requestsBlocked: 0 },
      { provider: 'twelvedata', capacity: 800, currentTokens: 780, utilizationPercent: '2.50%', requestsAllowed: 10, requestsBlocked: 0 },
    ],
  },
};

export const winLossDistribution = [
  { name: 'Wins', value: 68 },
  { name: 'Losses', value: 32 },
];

export function getOrders() {
  return trades.map((trade, index) => ({
    ...trade,
    status: index % 5 === 0 ? 'cancelled' : trade.status,
  }));
}

export function getPositioningForSymbol(symbol) {
  return {
    symbol,
    ...positioningData,
  };
}
