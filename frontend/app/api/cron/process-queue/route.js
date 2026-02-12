/**
 * Cron proxy: forwards process-queue to backend
 * Vercel Cron hits this route; it proxies to BACKEND_URL/api/cron/process-queue
 */

const BACKEND_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const CRON_SECRET = process.env.CRON_SECRET;

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request) {
  // Vercel Cron uses GET by default
  return proxyToBackend(request);
}

export async function POST(request) {
  return proxyToBackend(request);
}

async function proxyToBackend(request) {
  if (!CRON_SECRET) {
    console.error('[cron] CRON_SECRET not set');
    return Response.json({ error: 'Cron not configured' }, { status: 503 });
  }

  const auth = request.headers.get('authorization');
  const headerSecret = request.headers.get('x-cron-secret');
  const provided =
    (auth?.startsWith('Bearer ') && auth.slice(7) === CRON_SECRET) ||
    headerSecret === CRON_SECRET;

  if (!provided) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = `${BACKEND_URL}/api/cron/process-queue`;
  const headers = {
    'Content-Type': 'application/json',
    authorization: auth || `Bearer ${CRON_SECRET}`,
    'x-cron-secret': CRON_SECRET,
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
    });
    const body = await res.text();
    let data;
    try {
      data = body ? JSON.parse(body) : {};
    } catch {
      data = { raw: body };
    }
    return Response.json(data, { status: res.status });
  } catch (err) {
    console.error('[cron] Backend request failed:', err);
    return Response.json(
      { error: 'Backend unreachable', message: err?.message },
      { status: 502 }
    );
  }
}
