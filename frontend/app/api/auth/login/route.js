import { NextResponse } from 'next/server';
import { backendLogin } from '@/lib/backend-api';
import { signToken, validateCredentials } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

const COOKIE_MAX_AGE = 60 * 60 * 24;

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

function authResponse(body, token) {
  const secure = process.env.NODE_ENV === 'production' ? ' Secure;' : '';
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'no-store',
      'Set-Cookie': `auth_token=${token}; HttpOnly; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Strict;${secure}`,
    },
  });
}

export async function POST(request) {
  try {
    const rate = rateLimit({
      key: `login:${request.headers.get('x-forwarded-for') || 'unknown'}`,
      limit: 8,
      windowMs: 5 * 60 * 1000,
    });

    if (!rate.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429 }
      );
    }

    if (!validateCsrfToken(request)) {
      return NextResponse.json({ error: 'Invalid CSRF token' }, { status: 403 });
    }

    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 });
    }

    // Try backend authentication first, fall back to local demo credentials
    try {
      console.log('[Login] Attempting backend authentication');
      const result = await backendLogin(email, password);

      if (result?.success && result.token) {
        console.log('[Login] Backend authentication successful');
        return authResponse({ success: true, mode: 'backend' }, result.token);
      }
    } catch (backendError) {
      console.warn('[Login] Backend auth unavailable, trying local fallback:', backendError.message);
    }

    // Local / demo credential fallback
    if (validateCredentials(email, password)) {
      console.log('[Login] Local authentication successful (fallback mode)');
      const token = await signToken({ email, role: 'admin' });
      return authResponse({ success: true, mode: 'local' }, token);
    }

    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  } catch (error) {
    console.error('[Login] Error:', error);
    const message = error?.message || 'Login failed. Please try again.';
    const status = message.includes('Backend fetch failed') ? 502 : 500;
    const hint = message.includes('Backend fetch failed')
      ? 'Backend unreachable. Check NEXT_PUBLIC_API_URL and backend uptime.'
      : undefined;
    return NextResponse.json({ error: message, hint }, { status });
  }
}
