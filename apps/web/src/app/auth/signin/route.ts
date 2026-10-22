import { NextRequest, NextResponse } from 'next/server';
import { authMode } from '@/core/config';
import { startSignIn } from '@/core/oidc';

/** Starts the Cognito sign-in; locally the dev login page is used instead. */
export async function GET(req: NextRequest): Promise<Response> {
  if (authMode() !== 'cognito') return NextResponse.redirect(new URL('/login', req.url));
  return startSignIn('users', req.nextUrl.searchParams.get('next'));
}
