import { requireAuth } from '@/lib/request-auth';
import { backendGetFlow } from '@/lib/backend-api';
import { getFlowForSymbol } from '@/lib/mock-data';

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
    console.error('Backend flow fetch failed, using mock data:', error);
    const response = Response.json(getFlowForSymbol(symbol));
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'mock');
    return response;
  }
}
