import { requireAuth } from '@/lib/request-auth';
import { backendFetch, backendGetMonitoringStatus } from '@/lib/backend-api';

async function checkEndpoint(token, name, path) {
  const start = Date.now();
  try {
    const response = await backendFetch(path, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return {
      name,
      ok: response.ok,
      status: response.status,
      latency_ms: Date.now() - start,
    };
  } catch (error) {
    return {
      name,
      ok: false,
      status: 0,
      latency_ms: Date.now() - start,
      error: error?.message || 'Request failed',
    };
  }
}

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const token = auth.token;
  const endpoints = await Promise.all([
    checkEndpoint(token, 'dashboard', '/dashboard'),
    checkEndpoint(token, 'orders', '/orders'),
    checkEndpoint(token, 'history', '/history/stats'),
    checkEndpoint(token, 'monitoring', '/monitoring/status?limit=1'),
    checkEndpoint(token, 'intel', '/intel/latest?symbol=SPY'),
    checkEndpoint(token, 'positioning', '/positioning/gex?symbol=SPY'),
  ]);

  let monitoring = null;
  try {
    monitoring = await backendGetMonitoringStatus(token, 1, 'all');
  } catch {
    monitoring = null;
  }

  return Response.json({
    timestamp: new Date().toISOString(),
    endpoints,
    providers: monitoring?.providers || null,
    websocket: monitoring?.websocket || null,
  });
}
