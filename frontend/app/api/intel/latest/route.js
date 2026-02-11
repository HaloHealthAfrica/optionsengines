import { requireAuth } from '@/lib/request-auth';
import { backendGetIntelLatest } from '@/lib/backend-api';
import { getMarketIntelSnapshot } from '@/lib/mock-data';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || 'SPY').toUpperCase();

  try {
    const data = await backendGetIntelLatest(auth.token, symbol);
    const response = Response.json(data);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'backend');
    return response;
  } catch (error) {
    console.error('Backend intel fetch failed, using mock data:', error);
    const response = Response.json(getMarketIntelSnapshot(symbol));
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'mock');
    return response;
  }
}
