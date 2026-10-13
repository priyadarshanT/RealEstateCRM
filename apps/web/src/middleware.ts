import { NextRequest, NextResponse } from 'next/server';
import { PLATFORM_SESSION_COOKIE, SESSION_COOKIE } from '@/core/config';

// Signed-out visitors to CRM screens are sent to the login page. The API still checks every token itself.

const PUBLIC_PREFIXES = ['/login', '/signup', '/auth/', '/api/', '/_next/', '/favicon'];

export function middleware(req: NextRequest): Response {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  // Owner console: its own login page and cookie.
  if (pathname === '/console/login') return NextResponse.next();
  if (pathname === '/console' || pathname.startsWith('/console/')) {
    return req.cookies.has(PLATFORM_SESSION_COOKIE) ? NextResponse.next() : NextResponse.redirect(new URL('/console/login', req.url));
  }
  if (req.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  const login = new URL('/login', req.url);
  if (pathname !== '/') login.searchParams.set('next', pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = { matcher: ['/((?!_next/static|_next/image).*)'] };
