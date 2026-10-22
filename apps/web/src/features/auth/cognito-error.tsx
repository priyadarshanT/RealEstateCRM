import { Alert } from '@crm/ui';

const MESSAGES: Record<string, string> = {
  expired: 'The sign-in took too long or was started in another tab. Please try again.',
  exchange: 'We could not finish signing you in. Please try again.',
  cognito: 'The sign-in was cancelled or refused.',
  access: 'This login has no active account here.',
};

/** Shown instead of going straight to the Cognito sign-in when the last attempt failed (AUTH_MODE=cognito). */
export function CognitoSignInError({ error, message, retryHref, title, dark }: { error: string; message?: string; retryHref: string; title: string; dark?: boolean }) {
  return (
    <div className={`flex min-h-screen items-center justify-center p-4 ${dark ? 'bg-slate-900' : 'bg-sidebar'}`}>
      <div className="w-full max-w-sm space-y-4 rounded-lg bg-surface p-6 shadow-xl">
        <p className="text-lg font-semibold">{title}</p>
        <Alert>
          {MESSAGES[error] ?? MESSAGES.exchange}
          {message ? <span className="mt-1 block text-xs">{message}</span> : null}
        </Alert>
        <a href={retryHref} className="flex h-9 w-full items-center justify-center rounded-md bg-primary text-sm font-medium text-white hover:bg-primary/90">
          Try again
        </a>
      </div>
    </div>
  );
}
