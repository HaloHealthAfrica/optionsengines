import { requireAuth } from '@/lib/request-auth';
import { backendSendBatchCustomWebhooks } from '@/lib/backend-api';

export async function POST(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const data = await backendSendBatchCustomWebhooks(auth.token, body);
  return Response.json(data);
}
