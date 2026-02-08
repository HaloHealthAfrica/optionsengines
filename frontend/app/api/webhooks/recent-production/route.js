import { requireAuth } from '@/lib/request-auth';
import { backendGetRecentProductionWebhooks } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get('limit') || 10);
  const status = searchParams.get('status') || '';

  const data = await backendGetRecentProductionWebhooks(auth.token, limit, status);
  return Response.json(data);
}
