'use client';

import { Alert, Button, Spinner } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { loadStripe, type Stripe, type StripeElements } from '@stripe/stripe-js';
import { useEffect, useRef, useState } from 'react';

/**
 * Card step (SRS §12 Signing up 4): card details go straight to Stripe (Payment Element + SetupIntent);
 * the CRM never sees them. Returns the SetupIntent id for POST /public/signup/{id}/complete.
 */
export function CardStep({ cardSetup, busy, onConfirmed }: { cardSetup: Schemas['CardSetup']; busy: boolean; onConfirmed: (setupIntentId: string) => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const stripeRef = useRef<Stripe | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const configured = !!cardSetup.stripePublishableKey && !!cardSetup.setupIntentClientSecret;

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    void loadStripe(cardSetup.stripePublishableKey).then((stripe) => {
      if (cancelled || !stripe || !mountRef.current) return;
      stripeRef.current = stripe;
      const elements = stripe.elements({ clientSecret: cardSetup.setupIntentClientSecret });
      elementsRef.current = elements;
      const payment = elements.create('payment');
      payment.on('ready', () => setReady(true));
      payment.mount(mountRef.current);
    });
    return () => {
      cancelled = true;
    };
  }, [configured, cardSetup.stripePublishableKey, cardSetup.setupIntentClientSecret]);

  async function confirm() {
    if (!stripeRef.current || !elementsRef.current) return;
    setConfirming(true);
    setError(null);
    const { error: err, setupIntent } = await stripeRef.current.confirmSetup({ elements: elementsRef.current, redirect: 'if_required' });
    setConfirming(false);
    if (err) return setError(err.message ?? 'The card could not be saved.');
    if (setupIntent?.status === 'succeeded') onConfirmed(setupIntent.id);
    else setError('The card needs another step. Please try again.');
  }

  if (!configured) {
    return <Alert>Card payments are not set up in this environment yet (Stripe keys missing), so the trial cannot be started here.</Alert>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">A card is needed to start the 14-day free trial. You are charged only after the trial unless you cancel.</p>
      <div ref={mountRef} className="min-h-24 rounded-md border border-border p-3">
        {!ready ? <Spinner /> : null}
      </div>
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex justify-end">
        <Button disabled={!ready || confirming || busy} onClick={confirm}>
          {confirming || busy ? 'Starting trial…' : 'Start free trial'}
        </Button>
      </div>
    </div>
  );
}
