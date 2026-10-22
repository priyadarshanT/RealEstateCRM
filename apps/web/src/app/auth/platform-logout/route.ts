import { NextResponse } from 'next/server';
import { authMode, PLATFORM_REFRESH_COOKIE, PLATFORM_SESSION_COOKIE } from '@/core/config';
import { signOut } from '@/core/oidc';

/** Signs out of the owner console. With Cognito the answer says where the browser goes next to end that session too. */
export async function POST(): Promise<Response> {
  if (authMode() === 'cognito') return signOut('platform');
  const res = NextResponse.json({ ok: true, redirect: '/console/login' });
  res.cookies.delete(PLATFORM_SESSION_COOKIE);
  res.cookies.delete(PLATFORM_REFRESH_COOKIE);
  return res;
}
