import { requireAuth } from '@/lib/request-auth';
import { backendGetPositioning } from '@/lib/backend-api';
import { getPositioningForSymbol } from '@/lib/mock-data';

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const symbol = params.symbol?.toUpperCase() || 'SPY';
  try {
    const data = await backendGetPositioning(auth.token, symbol);
    const response = Response.json(data);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'backend');
    return response;
  } catch (error) {
    console.error('Backend positioning fetch failed, using mock data:', error);
    const response = Response.json(getPositioningForSymbol(symbol));
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('x-data-source', 'mock');
    return response;
  }
}
