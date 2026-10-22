import { NextRequest, NextResponse } from 'next/server';
import { authMode } from '@/core/config';
import { finishSignIn } from '@/core/oidc';

/** Cognito returns here after sign-in to the owner console (callback URL of the app client in Terraform). */
export async function GET(req: NextRequest): Promise<Response> {
  if (authMode() !== 'cognito') return NextResponse.redirect(new URL('/console/login', req.url));
  return finishSignIn('platform', req.nextUrl.searchParams);
}
