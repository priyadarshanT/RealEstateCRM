import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { authMode } from '@/core/config';
import { CognitoSignInError } from '@/features/auth/cognito-error';
import { LoginScreen } from '@/features/auth/login-screen';

// Locally: the dev login screen. In AWS (AUTH_MODE=cognito): straight to the Cognito sign-in, unless the last
// attempt failed, then the reason and "Try again".
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { next, error, message } = await searchParams;
  if (authMode() === 'cognito') {
    const signIn = `/auth/signin${next ? `?next=${encodeURIComponent(next)}` : ''}`;
    if (!error) redirect(signIn);
    return <CognitoSignInError title="EstateCRM" error={error} message={message} retryHref={signIn} />;
  }
  return (
    <Suspense>
      <LoginScreen />
    </Suspense>
  );
}
