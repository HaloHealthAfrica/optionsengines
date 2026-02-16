/**
 * Proxy for Strat Plan Lifecycle API
 * Forwards requests to backend /api/strat-plan/*
 */

import { requireAuth } from '@/lib/request-auth';
import { backendFetch } from '@/lib/backend-api';

export async function GET(request, { params }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const path = params.path?.join('/') || '';
  const search = request.nextUrl.searchParams.toString();
  const url = `/api/strat-plan/${path}${search ? `?${search}` : ''}`;

  try {
    const response = await backendFetch(url, {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    console.error('[Strat Plan API] GET failed:', error);
    return Response.json(
      { error: error?.message || 'Strat Plan API failed' },
      { status: 502 }
    );
  }
}

export async function POST(request, { params }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const path = params.path?.join('/') || '';
  const url = `/api/strat-plan/${path}`;
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const response = await backendFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    console.error('[Strat Plan API] POST failed:', error);
    return Response.json(
      { error: error?.message || 'Strat Plan API failed' },
      { status: 502 }
    );
  }
}

export async function PUT(request, { params }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const path = params.path?.join('/') || '';
  const url = `/api/strat-plan/${path}`;
  let body;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  try {
    const response = await backendFetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${auth.token}` },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    console.error('[Strat Plan API] PUT failed:', error);
    return Response.json(
      { error: error?.message || 'Strat Plan API failed' },
      { status: 502 }
    );
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const path = params.path?.join('/') || '';
  const url = `/api/strat-plan/${path}`;

  try {
    const response = await backendFetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (error) {
    console.error('[Strat Plan API] DELETE failed:', error);
    return Response.json(
      { error: error?.message || 'Strat Plan API failed' },
      { status: 502 }
    );
  }
}
