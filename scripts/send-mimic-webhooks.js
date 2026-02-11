import crypto from 'crypto';

const ENDPOINT = 'https://optionsengines.vercel.app/webhook';
const TOTAL_PER_SOURCE = 10;
const SYMBOLS = ['SPY', 'IWM'];
const TIMEFRAMES = ['3', '5', '15'];

function pick(list, index) {
  return list[index % list.length];
}

function timestampSeconds() {
  return Math.floor(Date.now() / 1000);
}

function baseFields(index) {
  const symbol = pick(SYMBOLS, index);
  const timeframe = pick(TIMEFRAMES, index);
  return { symbol, ticker: symbol, timeframe, timestamp: timestampSeconds() };
}

function buildSignalsPayload(index) {
  const base = baseFields(index);
  const isShort = index % 2 === 0;
  return {
    ...base,
    score: 6,
    trend: isShort ? 'BEARISH' : 'BULLISH',
    signal: { type: isShort ? 'SHORT' : 'LONG' },
    exchange: 'AMEX',
    components: ['TREND_ALIGN', 'GAMMA_BEAR'],
    instrument: { ticker: base.symbol, exchange: 'AMEX', current_price: 690.25 },
    time_context: { day_of_week: 'MONDAY', market_session: 'REGULAR' },
  };
}

function buildSatyPayload(index) {
  const base = baseFields(index);
  const isLong = index % 2 === 0;
  return {
    ...base,
    meta: { engine: 'SATY_PO', source: 'tradingview_indicator' },
    regime_context: { local_bias: isLong ? 'BULLISH' : 'BEARISH' },
    execution_guidance: { bias: isLong ? 'BULLISH' : 'BEARISH' },
    event: { phase_name: isLong ? 'MARKUP' : 'MARKDOWN' },
  };
}

function buildTrendPayload(index) {
  const base = baseFields(index);
  const isLong = index % 2 === 0;
  return {
    ...base,
    bias: isLong ? 'BULLISH' : 'BEARISH',
    timeframes: {
      '1h': { chg: true, dir: isLong ? 'bullish' : 'bearish' },
      '3m': { chg: false, dir: 'neutral' },
    },
    meta: { source: 'tradingview_indicator', indicator_name: 'Multi-Timeframe Trend Dots' },
  };
}

function buildOrbPayload(index) {
  const base = baseFields(index);
  const isBuy = index % 2 === 0;
  return {
    ...base,
    indicator: 'ORB',
    action: isBuy ? 'BUY' : 'SELL',
    side: isBuy ? 'LONG' : 'SHORT',
    entry: 690.1,
    stop: 689.4,
  };
}

function buildStratPayload(index) {
  const base = baseFields(index);
  const isLong = index % 2 === 0;
  return {
    ...base,
    journal: { engine: 'STRAT_V6_FULL' },
    signal: { side: isLong ? 'LONG' : 'SHORT' },
    trend: isLong ? 'BULLISH' : 'BEARISH',
    score: 4.5,
  };
}

function buildUnknownPayload(index) {
  const base = baseFields(index);
  return {
    ...base,
    session: 'ACTIVE',
    confidence: 2,
    // Intentionally omit direction fields to mimic failing format.
  };
}

async function postPayload(payload) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  return { status: response.status, body: text };
}

async function sendBatch(name, builder) {
  console.log(`\nSending ${TOTAL_PER_SOURCE} ${name} webhooks...`);
  const results = [];
  for (let i = 0; i < TOTAL_PER_SOURCE; i += 1) {
    const payload = builder(i);
    // eslint-disable-next-line no-await-in-loop
    const result = await postPayload(payload);
    results.push(result);
    console.log(`${name} ${i + 1}/${TOTAL_PER_SOURCE} -> ${result.status}`);
  }
  return results;
}

async function main() {
  const summary = {
    SIGNALS: await sendBatch('SIGNALS', buildSignalsPayload),
    SATY_PHASE: await sendBatch('SATY_PHASE', buildSatyPayload),
    TREND: await sendBatch('TREND', buildTrendPayload),
    ORB: await sendBatch('ORB', buildOrbPayload),
    STRAT: await sendBatch('STRAT', buildStratPayload),
    UNKNOWN: await sendBatch('UNKNOWN', buildUnknownPayload),
  };

  const counts = Object.entries(summary).reduce((acc, [key, entries]) => {
    acc[key] = entries.reduce((inner, entry) => {
      inner[entry.status] = (inner[entry.status] || 0) + 1;
      return inner;
    }, {});
    return acc;
  }, {});

  console.log('\nStatus summary by source:');
  console.log(JSON.stringify(counts, null, 2));
}

main().catch((error) => {
  console.error('Failed to send webhooks', error);
  process.exit(1);
});
