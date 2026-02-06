import { backendLogin } from '@/lib/backend-api';
import { signToken, validateCredentials } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';

function validateCsrfToken(request) {
  const cookieHeader = request.headers.get('cookie');
  const cookies = Object.fromEntries(
    (cookieHeader || '').split('; ').map(c => {
      const [key, ...v] = c.split('=');
      return [key, v.join('=')];
    })
  );
  const cookieToken = cookies['csrf_token'];
  const headerToken = request.headers.get('x-csrf-token');
  return Boolean(cookieToken && headerToken && cookieToken === headerToken);
}

export async function POST(request) {
  try {
    const rate = rateLimit({
      key: `login:${request.headers.get('x-forwarded-for') || 'unknown'}`,
      limit: 8,
      windowMs: 5 * 60 * 1000,
    });

    if (!rate.allowed) {
      return Response.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429 }
      );
    }

    if (!validateCsrfToken(request)) {
      return Response.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const { email, password } = await request.json();
    if (!email || !password) {
      return Response.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Try to authenticate with backend first
    try {
      console.log('[Login] Attempting backend authentication');
      const result = await backendLogin(email, password);
      
      if (result.success && result.token) {
        console.log('[Login] Backend authentication successful');
        const response = Response.json({ success: true, mode: 'backend' });
        response.headers.set('Cache-Control', 'no-store');
        response.headers.set(
          'Set-Cookie',
          `auth_token=${result.token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24}; SameSite=Strict;${
            process.env.NODE_ENV === 'production' ? ' Secure;' : ''
          }`
        );
        return response;
      }
    } catch (backendError) {
      console.warn('[Login] Backend authentication failed, falling back to local auth:', backendError.message);
      
      // Fallback to local authentication if backend is unavailable
      if (!validateCredentials(email, password)) {
        return Response.json({ error: 'Invalid credentials' }, { status: 401 });
      }

      console.log('[Login] Local authentication successful (fallback mode)');
      const token = await signToken({ email, role: 'admin' });

      const response = Response.json({ success: true, mode: 'local' });
      response.headers.set('Cache-Control', 'no-store');
      response.headers.set(
        'Set-Cookie',
        `auth_token=${token}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24}; SameSite=Strict;${
          process.env.NODE_ENV === 'production' ? ' Secure;' : ''
        }`
      );
      return response;
    }

    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  } catch (error) {
    console.error('[Login] Error:', error);
    return Response.json(
      { error: error.message || 'Login failed. Please try again.' },
      { status: 500 }
    );
  }
}
