import { requireAuth } from '@/lib/request-auth';
import { getPositioningForSymbol } from '@/lib/mock-data';

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const symbol = params.symbol?.toUpperCase() || 'SPY';
  const response = Response.json(getPositioningForSymbol(symbol));
  response.headers.set('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
  return response;
}
