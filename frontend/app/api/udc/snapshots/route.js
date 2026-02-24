import { requireAuth } from '@/lib/request-auth';
import { backendFetch } from '@/lib/backend-api';

export async function GET(request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || '50';
    const offset = searchParams.get('offset') || '0';
    const status = searchParams.get('status') || '';

    const query = new URLSearchParams({ limit, offset });
    if (status) query.set('status', status);

    const response = await backendFetch(`/api/udc/snapshots?${query.toString()}`, {
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });

    if (!response.ok) {
      return Response.json(
        { error: 'Failed to fetch UDC snapshots' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return Response.json(data);
  } catch (error) {
    console.error('[UDC API] Snapshots fetch failed:', error?.message);
    return Response.json(
      { error: 'Failed to fetch UDC snapshots' },
      { status: 500 },
    );
  }
}
