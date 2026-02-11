import http from 'http';
import { buildSyntheticGexMap } from './fixtures.js';

const targetBase = process.env.SYNTHETIC_TARGET ?? 'http://localhost:3000';
const port = Number(process.env.SYNTHETIC_PROXY_PORT ?? 3001);

const gexMap = buildSyntheticGexMap();

function collectBody(req: http.IncomingMessage): Promise<Buffer | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => {
      if (!chunks.length) return resolve(undefined);
      resolve(Buffer.concat(chunks));
    });
  });
}

function applyCors(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Webhook-Signature');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
}

function respondJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  applyCors(res);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  if (!req.url || !req.method) {
    respondJson(res, 400, { error: 'Bad request' });
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    applyCors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/positioning/gex') {
    const symbol = String(url.searchParams.get('symbol') ?? 'SPY').toUpperCase();
    const data = gexMap[symbol] ?? gexMap.SPY;
    respondJson(res, 200, { data });
    return;
  }

  if (pathname === '/positioning/options-flow') {
    const symbol = String(url.searchParams.get('symbol') ?? 'SPY').toUpperCase();
    respondJson(res, 200, {
      data: {
        symbol,
        entries: [],
        updatedAt: new Date().toISOString(),
        synthetic: true,
      },
    });
    return;
  }

  if (pathname === '/positioning/max-pain') {
    const symbol = String(url.searchParams.get('symbol') ?? 'SPY').toUpperCase();
    respondJson(res, 200, {
      data: {
        symbol,
        maxPainStrike: null,
        distancePercent: null,
        magnetStrength: null,
        updatedAt: new Date().toISOString(),
        synthetic: true,
      },
    });
    return;
  }

  if (pathname === '/positioning/signal-correlation') {
    const symbol = String(url.searchParams.get('symbol') ?? 'SPY').toUpperCase();
    respondJson(res, 200, {
      data: {
        symbol,
        correlationScore: 0,
        sampleSize: 0,
        bias: 'neutral',
        notes: 'synthetic',
        updatedAt: new Date().toISOString(),
        synthetic: true,
      },
    });
    return;
  }

  const body = await collectBody(req);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue;
    if (key.toLowerCase() === 'host') continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }

  const targetUrl = `${targetBase}${pathname}${url.search}`;
  const proxyResponse = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: body && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
  });

  const responseBuffer = Buffer.from(await proxyResponse.arrayBuffer());
  applyCors(res);
  res.writeHead(proxyResponse.status, Object.fromEntries(proxyResponse.headers.entries()));
  res.end(responseBuffer);
});

server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Synthetic proxy listening on http://localhost:${port} -> ${targetBase}`);
});
