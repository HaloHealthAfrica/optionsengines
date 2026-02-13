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
  gamma: {
    regime: 'LONG_GAMMA',
    zeroGammaLevel: 445.2,
    expectedBehavior: 'MEAN_REVERT',
    distanceATR: 0.35,
  },
  optionsFlow: {
    premium: '$420M',
    netflow: '$120M',
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
  decision_engine: {
    overview: {
      decisions_per_min: 3.2,
      decisions_per_hour: 192,
      success_rate: 94.2,
      failure_rate: 5.8,
      avg_latency_ms: 32,
      utilization_pct: 76,
      failures_24h: 14,
      total_decisions: 234,
    },
    comparison: {
      A: {
        decisions: 233,
        success_rate: 95,
        avg_latency_ms: 30,
        queue_depth: 2,
        volume_label: 'Primary',
        volume_reason: 'Higher availability',
      },
      B: {
        decisions: 1,
        success_rate: 100,
        avg_latency_ms: 45,
        queue_depth: 0,
        volume_label: 'Low activity',
        volume_reason: 'Sparse signals',
      },
    },
    pipeline: {
      signals_received: 256,
      decisions_made: 234,
      orders_placed: 220,
      queue_depth_a: 2,
      queue_depth_b: 0,
      stuck_stage: 'None',
    },
    breakdown: {
      by_symbol: [
        { label: 'SPY', value: 78 },
        { label: 'QQQ', value: 55 },
        { label: 'AAPL', value: 42 },
        { label: 'TSLA', value: 28 },
      ],
      by_decision: [
        { label: 'Buy', value: 132 },
        { label: 'Sell', value: 64 },
        { label: 'Hold', value: 24 },
        { label: 'Close', value: 14 },
      ],
      by_outcome: [
        { label: 'Success', value: 202 },
        { label: 'Failed', value: 14 },
        { label: 'Pending', value: 18 },
      ],
      by_timeframe: [
        { label: '1m', value: 44 },
        { label: '5m', value: 120 },
        { label: '15m', value: 52 },
        { label: '1h', value: 18 },
      ],
    },
    decision_log: Array.from({ length: 12 }).map((_, idx) => {
      const symbol = symbols[idx % symbols.length];
      const decisionTypes = ['Buy', 'Sell', 'Hold', 'Close'];
      const outcomes = ['Success', 'Pending', 'Failed'];
      const engine = idx % 3 === 0 ? 'B' : 'A';
      return {
        id: `dec-${1000 + idx}`,
        timestamp: new Date(Date.now() - idx * 60 * 1000).toISOString(),
        symbol,
        timeframe: idx % 2 === 0 ? '5m' : '15m',
        decision: decisionTypes[idx % decisionTypes.length],
        confidence: 60 + (idx % 5) * 8,
        outcome: outcomes[idx % outcomes.length],
        processing_ms: 24 + idx * 3,
        engine,
      };
    }),
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

export function getFlowForSymbol(symbol) {
  return {
    symbol,
    netflow: {
      value: 120000000,
      formatted: '$120M',
      direction: 'bullish',
    },
    optionsFlow: {
      premium: '$420M',
      netflow: '$120M',
      bullish: 72,
      bearish: 28,
    },
    gamma: {
      regime: 'SHORT_GAMMA',
      zeroGammaLevel: 445.2,
    },
    confluence: {
      score: 82,
      aligned: true,
      alignment: 'aligned',
      factors: {
        flowGammaAlignment: 90,
        signalFlowAlignment: 50,
        signalGammaAlignment: 50,
        flowStrength: 65,
      },
      tradeGatePasses: true,
      threshold: 75,
    },
    tradeGate: {
      passes: true,
      threshold: 75,
      reason: 'Confluence above threshold',
    },
    positionSize: {
      multiplier: 1,
      tier: 'full',
    },
    gex: {
      total: '$2.4B',
      call: '$1.8B',
      put: '$600M',
    },
    maxPain: null,
  };
}

export function getMarketIntelSnapshot(symbol) {
  const gamma = positioningData.gamma;
  const noTradeDay =
    gamma?.regime === 'SHORT_GAMMA' &&
    Number.isFinite(Number(gamma?.distanceATR)) &&
    Math.abs(Number(gamma?.distanceATR)) <= 0.5;

  return {
    symbol,
    timestamp: new Date().toISOString(),
    allowTrading: !noTradeDay,
    message: noTradeDay ? 'Market structure not supportive today' : undefined,
    gamma: {
      regime: gamma?.regime ?? 'NEUTRAL',
      zeroGammaLevel: gamma?.zeroGammaLevel,
      distanceATR: gamma?.distanceATR,
      expectedBehavior: gamma?.expectedBehavior ?? 'EXPANSION',
      noTradeDay,
    },
  };
}
