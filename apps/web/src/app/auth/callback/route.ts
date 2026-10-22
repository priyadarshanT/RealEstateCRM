import { NextRequest, NextResponse } from 'next/server';
import { authMode } from '@/core/config';
import { finishSignIn } from '@/core/oidc';

/** Cognito returns here after sign-in (callback URL of the app client in Terraform). */
export async function GET(req: NextRequest): Promise<Response> {
  if (authMode() !== 'cognito') return NextResponse.redirect(new URL('/login', req.url));
  return finishSignIn('users', req.nextUrl.searchParams);
}
