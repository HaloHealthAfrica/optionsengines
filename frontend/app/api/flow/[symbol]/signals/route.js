import { requireAuth } from '@/lib/request-auth';
import { backendGetFlowSignals } from '@/lib/backend-api';

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const symbol = params.symbol?.toUpperCase() || 'SPY';
  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);

  try {
    const data = await backendGetFlowSignals(auth.token, symbol, limit);
    return Response.json(data);
  } catch (error) {
    console.error('Flow signals fetch failed:', error);
    return Response.json({ symbol, signals: [] }, { status: 200 });
  }
}
