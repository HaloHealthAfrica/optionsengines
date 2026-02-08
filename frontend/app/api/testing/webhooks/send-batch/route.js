import { requireAuth } from '@/lib/request-auth';
import { backendSendBatchTestWebhooks } from '@/lib/backend-api';

export async function POST(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const body = await request.json();
  const data = await backendSendBatchTestWebhooks(auth.token, body);
  return Response.json(data);
}
