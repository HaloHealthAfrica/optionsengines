import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const encoder = new TextEncoder();
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:8080';

const BACKEND_JWT_ISSUER = process.env.JWT_ISSUER || 'dual-engine-trading-platform';
const BACKEND_JWT_AUDIENCE = process.env.JWT_AUDIENCE || 'trading-platform-users';
const LEGACY_JWT_ISSUER = 'optionagents';
const LEGACY_JWT_AUDIENCE = 'optionagents-users';

async function verifyAuth(token) {
  if (!process.env.JWT_SECRET) return false;
  try {
    await jwtVerify(token, encoder.encode(process.env.JWT_SECRET), {
      issuer: BACKEND_JWT_ISSUER,
      audience: BACKEND_JWT_AUDIENCE,
    });
    return true;
  } catch (error) {
    try {
      await jwtVerify(token, encoder.encode(process.env.JWT_SECRET), {
        issuer: LEGACY_JWT_ISSUER,
        audience: LEGACY_JWT_AUDIENCE,
      });
      return true;
    } catch {
      return false;
    }
  }
}

async function verifyBackendAuth(token) {
  if (!BACKEND_URL || !token) return false;
  try {
    const response = await fetch(`${BACKEND_URL}/auth/verify-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return false;
    const result = await response.json();
    return Boolean(result?.success);
  } catch {
    return false;
  }
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/webhook') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get('auth_token')?.value;
  const localOk = token ? await verifyAuth(token) : false;
  const backendOk = token && !localOk ? await verifyBackendAuth(token) : false;

  if (!token || (!localOk && !backendOk)) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
