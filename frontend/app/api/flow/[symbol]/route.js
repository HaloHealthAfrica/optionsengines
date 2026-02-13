import { requireAuth } from '@/lib/request-auth';
import { backendGetFlow } from '@/lib/backend-api';
import { getFlowForSymbol } from '@/lib/mock-data';

function getFailReason(error) {
  const msg = error?.message || String(error);
  if (msg.includes('timed out')) return 'timeout';
  if (msg.includes('401')) return 'unauthorized';
  if (msg.includes('500') || msg.includes('502') || msg.includes('503')) return 'backend_error';
  if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND')) return 'backend_unreachable';
  return 'unknown';
}

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const symbol = params.symbol?.toUpperCase() || 'SPY';

  try {
    const data = await backendGetFlow(auth.token, symbol);
    const response = Response.json(data);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'backend');
    return response;
  } catch (error) {
    const reason = getFailReason(error);
    console.error('[Flow API] Backend fetch failed, using mock:', { reason, error: error?.message });
    const response = Response.json(getFlowForSymbol(symbol));
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'mock');
    response.headers.set('x-fail-reason', reason);
    return response;
  }
}
