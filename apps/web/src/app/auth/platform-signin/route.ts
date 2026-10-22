import { NextRequest, NextResponse } from 'next/server';
import { authMode } from '@/core/config';
import { startSignIn } from '@/core/oidc';

/** Starts the Cognito sign-in of the owner console (its own pool, two-factor); locally the dev login page is used instead. */
export async function GET(req: NextRequest): Promise<Response> {
  if (authMode() !== 'cognito') return NextResponse.redirect(new URL('/console/login', req.url));
  return startSignIn('platform', req.nextUrl.searchParams.get('next'));
}
