import { redirect } from 'next/navigation';
import { authMode } from '@/core/config';
import { CognitoSignInError } from '@/features/auth/cognito-error';
import { ConsoleLogin } from '@/features/platform/console-login';

// Locally: the dev owner-console login. In AWS: the owner console's own Cognito pool (two-factor).
export default async function ConsoleLoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { error, message } = await searchParams;
  if (authMode() === 'cognito') {
    if (!error) redirect('/auth/platform-signin');
    return <CognitoSignInError title="EstateCRM · Owner console" dark error={error} message={message} retryHref="/auth/platform-signin" />;
  }
  return <ConsoleLogin />;
}
