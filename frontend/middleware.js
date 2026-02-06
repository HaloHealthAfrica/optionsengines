import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const encoder = new TextEncoder();

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
  if (!token || !(await verifyAuth(token))) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
