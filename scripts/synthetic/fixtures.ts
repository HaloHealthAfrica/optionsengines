export type SyntheticScenario = {
  id: string;
  symbol: 'SPY' | 'QQQ' | 'SPX';
  timeframe: '1m' | '5m' | '15m';
  timestamp: string;
  direction: 'long' | 'short';
  sessionLabel: 'RTH_OPEN' | 'MIDDAY_CHOP' | 'POWER_HOUR';
  description: string;
  gexRegime: 'positive' | 'negative' | 'flip' | 'neutral';
};

export type SyntheticWebhookPayload = {
  symbol: string;
  direction: 'long' | 'short';
  timeframe: string;
  timestamp: string;
  session_label: string;
  synthetic_id: string;
  synthetic: true;
  ohlc: {
    open: number;
    high: number;
    low: number;
    close: number;
  };
  volume: number;
};

export type SyntheticGexLevel = {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
};

export type SyntheticGexData = {
  symbol: string;
  netGex: number;
  totalCallGex: number;
  totalPutGex: number;
  zeroGammaLevel?: number;
  dealerPosition: 'long_gamma' | 'short_gamma' | 'neutral';
  volatilityExpectation: 'compressed' | 'expanding' | 'neutral';
  updatedAt: string;
  levels: SyntheticGexLevel[];
  synthetic: true;
  syntheticRegime: string;
};

const baseDate = '2026-02-03';

export const syntheticScenarios: SyntheticScenario[] = [
  {
    id: 'orb-breakout-spy',
    symbol: 'SPY',
    timeframe: '1m',
    timestamp: `${baseDate}T13:35:00.000Z`,
    direction: 'long',
    sessionLabel: 'RTH_OPEN',
    description: 'ORB breakout during RTH open',
    gexRegime: 'negative',
  },
  {
    id: 'orb-fakeout-qqq',
    symbol: 'QQQ',
    timeframe: '1m',
    timestamp: `${baseDate}T13:42:00.000Z`,
    direction: 'short',
    sessionLabel: 'RTH_OPEN',
    description: 'ORB fakeout during RTH open',
    gexRegime: 'positive',
  },
  {
    id: 'ttm-release-spx',
    symbol: 'SPX',
    timeframe: '5m',
    timestamp: `${baseDate}T15:05:00.000Z`,
    direction: 'long',
    sessionLabel: 'MIDDAY_CHOP',
    description: 'TTM compression to expansion during midday',
    gexRegime: 'flip',
  },
  {
    id: 'strat-continuation-spy',
    symbol: 'SPY',
    timeframe: '15m',
    timestamp: `${baseDate}T19:05:00.000Z`,
    direction: 'long',
    sessionLabel: 'POWER_HOUR',
    description: 'Strat continuation into power hour',
    gexRegime: 'negative',
  },
  {
    id: 'strat-reversal-qqq',
    symbol: 'QQQ',
    timeframe: '15m',
    timestamp: `${baseDate}T19:25:00.000Z`,
    direction: 'short',
    sessionLabel: 'POWER_HOUR',
    description: 'Strat reversal with gamma flip risk',
    gexRegime: 'flip',
  },
  {
    id: 'satyland-confirmation-spy',
    symbol: 'SPY',
    timeframe: '5m',
    timestamp: `${baseDate}T16:10:00.000Z`,
    direction: 'long',
    sessionLabel: 'MIDDAY_CHOP',
    description: 'Satyland confirmation scenario',
    gexRegime: 'neutral',
  },
];

function seededRandom(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function seedFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) + 1;
}

export function buildWebhookPayload(
  scenario: SyntheticScenario,
  priceSeed: number
): SyntheticWebhookPayload {
  const rng = seededRandom(seedFromId(scenario.id));
  const open = Number((priceSeed + rng()).toFixed(2));
  const high = Number((open + 0.5 + rng()).toFixed(2));
  const low = Number((open - 0.5 - rng()).toFixed(2));
  const close = Number((low + (high - low) * 0.6).toFixed(2));

  return {
    symbol: scenario.symbol,
    direction: scenario.direction,
    timeframe: scenario.timeframe,
    timestamp: scenario.timestamp,
    session_label: scenario.sessionLabel,
    synthetic_id: scenario.id,
    synthetic: true,
    ohlc: { open, high, low, close },
    volume: Math.floor(100000 + Math.random() * 250000),
  };
}

function gexLevelsFor(symbol: string, regime: SyntheticScenario['gexRegime']): SyntheticGexLevel[] {
  const baseStrike = symbol === 'SPX' ? 4950 : symbol === 'QQQ' ? 420 : 500;
  const levels: SyntheticGexLevel[] = [];
  for (let i = -2; i <= 2; i += 1) {
    const strike = baseStrike + i * (symbol === 'SPX' ? 25 : 5);
    const bias = regime === 'negative' ? -1 : regime === 'positive' ? 1 : 0;
    const volatility = regime === 'flip' ? (i % 2 === 0 ? 1 : -1) : bias;
    const callGex = 200000 * (1 + i * 0.1) * (volatility >= 0 ? 1 : 0.4);
    const putGex = -180000 * (1 - i * 0.08) * (volatility <= 0 ? 1 : 0.35);
    levels.push({
      strike,
      callGex,
      putGex,
      netGex: callGex + putGex,
    });
  }
  return levels;
}

export function buildSyntheticGex(symbol: SyntheticScenario['symbol'], regime: SyntheticScenario['gexRegime']): SyntheticGexData {
  const levels = gexLevelsFor(symbol, regime);
  const totalCallGex = levels.reduce((sum, level) => sum + level.callGex, 0);
  const totalPutGex = levels.reduce((sum, level) => sum + level.putGex, 0);
  const netGex = totalCallGex + totalPutGex;
  const zeroGammaLevel =
    levels.reduce((closest, level) => (Math.abs(level.netGex) < Math.abs(closest.netGex) ? level : closest), levels[0])
      ?.strike ?? undefined;
  const dealerPosition =
    netGex > 0 ? 'long_gamma' : netGex < 0 ? 'short_gamma' : 'neutral';
  const volatilityExpectation =
    netGex > 0 ? 'compressed' : netGex < 0 ? 'expanding' : 'neutral';

  return {
    symbol,
    netGex,
    totalCallGex,
    totalPutGex,
    zeroGammaLevel,
    dealerPosition,
    volatilityExpectation,
    updatedAt: new Date().toISOString(),
    levels,
    synthetic: true,
    syntheticRegime: regime,
  };
}

export function buildSyntheticGexMap(): Record<string, SyntheticGexData> {
  const map: Record<string, SyntheticGexData> = {};
  for (const scenario of syntheticScenarios) {
    map[scenario.symbol] = buildSyntheticGex(scenario.symbol, scenario.gexRegime);
  }
  return map;
}
