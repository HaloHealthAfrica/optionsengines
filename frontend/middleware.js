import { NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const encoder = new TextEncoder();

async function verifyAuth(token) {
  if (!process.env.JWT_SECRET) return false;
  try {
    await jwtVerify(token, encoder.encode(process.env.JWT_SECRET), {
      issuer: 'optionagents',
      audience: 'optionagents-users',
    });
    return true;
  } catch (error) {
    return false;
  }
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
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
