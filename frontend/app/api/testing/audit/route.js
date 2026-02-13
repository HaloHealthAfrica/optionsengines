import { requireAuth } from '@/lib/request-auth';
import { backendRunTradeAudit } from '@/lib/backend-api';

export async function POST(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const result = await backendRunTradeAudit(auth.token, body);
  return Response.json(result);
}
