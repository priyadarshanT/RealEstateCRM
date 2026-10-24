import { turnstileSiteKey } from '@/core/config';
import { SignupScreen } from '@/features/signup/signup-screen';

// Rendered per request so the site key comes from the server's settings, not from build time.
export const dynamic = 'force-dynamic';

export default function SignupPage() {
  return <SignupScreen turnstileSiteKey={turnstileSiteKey()} />;
}
