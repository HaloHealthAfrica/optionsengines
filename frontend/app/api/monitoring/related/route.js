import { requireAuth } from '@/lib/request-auth';
import { backendGetRelatedWebhooks } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol');
  const timeframe = searchParams.get('timeframe');
  const hours = Number(searchParams.get('hours') || 24);

  if (!symbol || !timeframe) {
    return Response.json({ error: 'symbol and timeframe are required' }, { status: 400 });
  }

  try {
    const data = await backendGetRelatedWebhooks(auth.token, symbol, timeframe, hours);
    const response = Response.json(data);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    console.error('Backend related webhooks fetch failed:', error);
    return Response.json({ error: 'Failed to fetch related webhooks' }, { status: 502 });
  }
}
