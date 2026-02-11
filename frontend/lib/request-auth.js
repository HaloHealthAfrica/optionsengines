import { verifyToken } from './auth';

const BACKEND_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

async function verifyBackendToken(token) {
  if (!token) return null;
  try {
    const response = await fetch(`${BACKEND_URL}/auth/verify-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.payload || null;
  } catch {
    return null;
  }
}

export async function getUserFromRequest(request) {
  const token = request.cookies.get('auth_token')?.value;
  if (!token) return null;
  const user = await verifyToken(token);
  if (user) return { ...user, token };
  const backendUser = await verifyBackendToken(token);
  return backendUser ? { ...backendUser, token } : null;
}

export async function requireAuth(request) {
  const cookieHeader = request.headers.get('cookie');
  const cookies = Object.fromEntries(
    (cookieHeader || '').split('; ').map(c => {
      const [key, ...v] = c.split('=');
      return [key, v.join('=')];
    })
  );
  const token = cookies['auth_token'];
  
  if (!token) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }
  
  let user = await verifyToken(token);
  if (!user) {
    user = await verifyBackendToken(token);
  }
  if (!user) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
    };
  }
  
  return { ok: true, user, token };
}
