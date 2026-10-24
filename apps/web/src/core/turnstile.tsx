'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render(el: HTMLElement, options: Record<string, unknown>): string;
      reset(widgetId: string): void;
      remove(widgetId: string): void;
    };
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
/** Without a site key (local development) the API's development bot check accepts any token. */
const DEV_TOKEN = 'dev-local';

let scriptLoading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptLoading ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptLoading = null;
      reject(new Error('Cloudflare Turnstile did not load'));
    };
    document.head.appendChild(script);
  });
  return scriptLoading;
}

/**
 * Cloudflare Turnstile bot check for the public forms (sign-up, talk to sales, booking page).
 * `token` is null until the check passes; a token is single-use, so call `reset()` after each submit.
 * The site key comes from the server (TURNSTILE_SITE_KEY); without it the widget is hidden and the dev token is used.
 */
export function useTurnstile(siteKey: string | undefined): { token: string | null; widget: ReactNode; reset: () => void } {
  const [token, setToken] = useState<string | null>(siteKey ? null : DEV_TOKEN);
  const mountRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    void loadScript().then(() => {
      if (cancelled || !mountRef.current || !window.turnstile) return;
      widgetId.current = window.turnstile.render(mountRef.current, {
        sitekey: siteKey,
        callback: (t: string) => setToken(t),
        'expired-callback': () => setToken(null),
        'error-callback': () => setToken(null),
      });
    });
    return () => {
      cancelled = true;
      if (widgetId.current) window.turnstile?.remove(widgetId.current);
      widgetId.current = null;
    };
  }, [siteKey]);

  const reset = useCallback(() => {
    if (!siteKey) return;
    setToken(null);
    if (widgetId.current) window.turnstile?.reset(widgetId.current);
  }, [siteKey]);

  return { token, widget: siteKey ? <div ref={mountRef} className="min-h-[65px]" /> : null, reset };
}
