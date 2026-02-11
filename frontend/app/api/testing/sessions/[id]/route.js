import { requireAuth } from '@/lib/request-auth';
import { backendClearTestSession, backendGetTestSession } from '@/lib/backend-api';

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const data = await backendGetTestSession(auth.token, params.id);
  return Response.json(data);
}

export async function DELETE(request, { params }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const data = await backendClearTestSession(auth.token, params.id);
  return Response.json(data);
}
