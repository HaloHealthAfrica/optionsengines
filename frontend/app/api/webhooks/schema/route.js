import { requireAuth } from '@/lib/request-auth';
import { backendGetWebhookSchema } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const data = await backendGetWebhookSchema(auth.token);
  return Response.json(data);
}
