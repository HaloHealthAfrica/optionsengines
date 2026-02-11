import { verifyToken } from './auth';

export async function getUserFromRequest(request) {
  const token = request.cookies.get('auth_token')?.value;
  if (!token) return null;
  const user = await verifyToken(token);
  return user ? { ...user, token } : null;
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
  
  const user = await verifyToken(token);
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
