const { URL } = require('url');

const originalFetch = global.fetch;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function seededRandom(seed) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function seedFromText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) + 1;
}

function basePrice(symbol) {
  if (symbol === 'SPX') return 4950;
  if (symbol === 'QQQ') return 420;
  return 500;
}

function alpacaBars(symbol, timeframe, limit) {
  const stepMs = timeframe === '5Min' ? 5 * 60000 : timeframe === '15Min' ? 15 * 60000 : 60000;
  const now = Date.now();
  const rng = seededRandom(seedFromText(`${symbol}:${timeframe}`));
  const bars = [];
  let last = basePrice(symbol);
  for (let i = limit - 1; i >= 0; i -= 1) {
    const ts = new Date(now - i * stepMs).toISOString();
    const drift = (rng() - 0.5) * 0.8;
    const open = last;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) + rng() * 0.3;
    const low = Math.min(open, close) - rng() * 0.3;
    const volume = Math.floor(100000 + rng() * 250000);
    bars.push({ t: ts, o: Number(open.toFixed(2)), h: Number(high.toFixed(2)), l: Number(low.toFixed(2)), c: Number(close.toFixed(2)), v: volume });
    last = close;
  }
  return bars;
}

function alpacaQuote(symbol) {
  const mid = basePrice(symbol);
  const bid = Number((mid - 0.05).toFixed(2));
  const ask = Number((mid + 0.05).toFixed(2));
  return {
    quote: {
      ap: ask,
      bp: bid,
      as: 12,
      bs: 10,
      t: new Date().toISOString(),
    },
    symbol,
  };
}

function marketDataOptionsChain(symbol) {
  const base = basePrice(symbol);
  const strikes = [base - 10, base - 5, base, base + 5, base + 10];
  return {
    options: strikes.flatMap((strike) => [
      {
        option_symbol: `${symbol}C${strike}`,
        strike,
        expiration: new Date(Date.now() + 14 * 86400000).toISOString(),
        option_type: 'call',
        open_interest: 1200,
        gamma: 0.02,
      },
      {
        option_symbol: `${symbol}P${strike}`,
        strike,
        expiration: new Date(Date.now() + 14 * 86400000).toISOString(),
        option_type: 'put',
        open_interest: 900,
        gamma: 0.018,
      },
    ]),
  };
}

function marketDataFlow(symbol, limit) {
  const entries = [];
  for (let i = 0; i < Math.min(limit, 10); i += 1) {
    entries.push({
      option_symbol: `${symbol}${i}`,
      strike: basePrice(symbol) + i,
      expiration: new Date(Date.now() + 7 * 86400000).toISOString(),
      option_type: i % 2 === 0 ? 'call' : 'put',
      volume: 50 + i * 3,
      open_interest: 100 + i * 7,
      gamma: 0.01,
      premium: 2000 + i * 120,
      timestamp: new Date().toISOString(),
    });
  }
  return { data: entries };
}

function marketDataCandles(symbol, resolution) {
  const stepMs = resolution === '5' ? 5 * 60000 : resolution === '15' ? 15 * 60000 : 60000;
  const count = 100;
  const now = Math.floor(Date.now() / 1000);
  const t = [];
  const o = [];
  const h = [];
  const l = [];
  const c = [];
  const v = [];
  const rng = seededRandom(seedFromText(`${symbol}:${resolution}`));
  let last = basePrice(symbol);
  for (let i = count - 1; i >= 0; i -= 1) {
    const drift = (rng() - 0.5) * 0.6;
    const open = last;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) + rng() * 0.2;
    const low = Math.min(open, close) - rng() * 0.2;
    t.push(now - i * Math.floor(stepMs / 1000));
    o.push(Number(open.toFixed(2)));
    h.push(Number(high.toFixed(2)));
    l.push(Number(low.toFixed(2)));
    c.push(Number(close.toFixed(2)));
    v.push(Math.floor(90000 + rng() * 180000));
    last = close;
  }
  return { s: 'ok', t, o, h, l, c, v };
}

function marketDataQuote(symbol) {
  const mid = basePrice(symbol);
  return {
    s: 'ok',
    symbol: [symbol],
    ask: [mid + 0.06],
    bid: [mid - 0.06],
    mid: [mid],
    last: [mid],
    volume: [1000000],
    updated: [Math.floor(Date.now() / 1000)],
  };
}

global.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (!url) return originalFetch(input, init);

  const parsed = new URL(url);

  if (parsed.hostname === 'data.alpaca.markets') {
    if (parsed.pathname === '/v2/clock') {
      return jsonResponse({
        timestamp: new Date().toISOString(),
        is_open: true,
        next_open: new Date(Date.now() + 3600000).toISOString(),
        next_close: new Date(Date.now() + 6 * 3600000).toISOString(),
      });
    }

    if (parsed.pathname.endsWith('/bars')) {
      const symbol = parsed.pathname.split('/')[3];
      const timeframe = parsed.searchParams.get('timeframe') ?? '1Min';
      const limit = Number(parsed.searchParams.get('limit') ?? 100);
      return jsonResponse({ bars: alpacaBars(symbol, timeframe, limit), symbol });
    }

    if (parsed.pathname.endsWith('/quotes/latest')) {
      const symbol = parsed.pathname.split('/')[3];
      return jsonResponse(alpacaQuote(symbol));
    }
  }

  if (parsed.hostname === 'api.marketdata.app') {
    if (parsed.pathname.startsWith('/v1/options/chain/')) {
      const symbol = parsed.pathname.split('/')[4];
      return jsonResponse(marketDataOptionsChain(symbol));
    }

    if (parsed.pathname.startsWith('/v1/options/flow/')) {
      const symbol = parsed.pathname.split('/')[4];
      const limit = Number(parsed.searchParams.get('limit') ?? 50);
      return jsonResponse(marketDataFlow(symbol, limit));
    }

    if (parsed.pathname.startsWith('/v1/stocks/quotes/')) {
      const symbol = parsed.pathname.split('/')[4];
      return jsonResponse(marketDataQuote(symbol));
    }

    if (parsed.pathname.startsWith('/v1/stocks/candles/')) {
      const resolution = parsed.pathname.split('/')[4];
      const symbol = parsed.pathname.split('/')[5];
      return jsonResponse(marketDataCandles(symbol, resolution));
    }
  }

  return originalFetch(input, init);
};
