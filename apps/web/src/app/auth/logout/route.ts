import { NextResponse } from 'next/server';
import { authMode, REFRESH_COOKIE, SESSION_COOKIE } from '@/core/config';
import { signOut } from '@/core/oidc';

/** Signs out. With Cognito the answer says where the browser goes next to end the Cognito session too. */
export async function POST(): Promise<Response> {
  if (authMode() === 'cognito') return signOut('users');
  const res = NextResponse.json({ ok: true, redirect: '/login' });
  res.cookies.delete(SESSION_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}
