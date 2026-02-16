/**
 * Proxy for Strat Command Center API
 * Forwards requests to backend /api/strat/*
 */

import { requireAuth } from '@/lib/request-auth';
import { backendFetch } from '@/lib/backend-api';

async function handleRequest(request, params, method) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const path = params.path?.join('/') || '';
  const search = request.nextUrl.searchParams.toString();
  const url = `/api/strat/${path}${search ? `?${search}` : ''}`;

  const options = {
    method,
    headers: { Authorization: `Bearer ${auth.token}` },
  };
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      options.body = await request.text();
      if (options.body) options.headers['Content-Type'] = 'application/json';
    } catch {
      options.body = undefined;
    }
  }

  try {
    const response = await backendFetch(url, options);
    const data = await response.json().catch(() => ({}));
    return Response.json(data, { status: response.status });
  } catch (error) {
    console.error(`[Strat API] ${method} failed:`, error);
    return Response.json(
      { error: error?.message || 'Strat API failed' },
      { status: 502 }
    );
  }
}

export async function GET(request, { params }) {
  return handleRequest(request, params, 'GET');
}

export async function POST(request, { params }) {
  return handleRequest(request, params, 'POST');
}

export async function PATCH(request, { params }) {
  return handleRequest(request, params, 'PATCH');
}

export async function DELETE(request, { params }) {
  return handleRequest(request, params, 'DELETE');
}
