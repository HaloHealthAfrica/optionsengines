import { requireAuth } from '@/lib/request-auth';
import { backendFetch } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const response = await backendFetch('/api/udc/mode', {
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });

    if (!response.ok) {
      return Response.json({ mode: 'LEGACY_ONLY' });
    }

    const data = await response.json();
    return Response.json(data);
  } catch {
    return Response.json({ mode: 'LEGACY_ONLY' });
  }
}

export async function POST(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();

    const response = await backendFetch('/api/udc/mode', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      return Response.json(
        { error: error?.error || 'Failed to update mode' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: 'Failed to update trading mode' },
      { status: 500 },
    );
  }
}
