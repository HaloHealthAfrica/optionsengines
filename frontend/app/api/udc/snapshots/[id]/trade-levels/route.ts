import { requireAuth } from '@/lib/request-auth';
import { backendFetch } from '@/lib/backend-api';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const { id } = await params;

  try {
    const body = await request.json();

    const response = await backendFetch(`/api/udc/snapshots/${id}/trade-levels`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => null);
      return Response.json(
        { error: error?.error || 'Failed to save trade levels' },
        { status: response.status },
      );
    }

    const data = await response.json();
    return Response.json(data);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[UDC API] Trade levels save failed:', message);
    return Response.json(
      { error: 'Failed to save trade levels' },
      { status: 500 },
    );
  }
}
