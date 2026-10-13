'use client';

import { Alert, Badge, Button, Field, Input, Textarea, cn } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage, unwrap } from '@/core/api';
import { formatDate, formatMoney } from '@/core/format';
import { CardStep } from './card-step';

type Plan = Schemas['Plan'];
type Step = 'company' | 'verify' | 'card' | 'done';

const STEPS: { key: Step; label: string }[] = [
  { key: 'company', label: '1 Plan & company' },
  { key: 'verify', label: '2 Verify email' },
  { key: 'card', label: '3 Card' },
];

const VAT = 0.05;

/**
 * Public sign-up and 14-day free trial (SRS §12, wireframe "Sign-up and free trial").
 * The bot check token comes from Cloudflare Turnstile in AWS; locally the API's dev bot check accepts any token.
 */
export function SignupScreen() {
  const plans = useQuery({ queryKey: ['plans'], queryFn: async () => unwrap(await api.GET('/public/plans')).data });
  const [step, setStep] = useState<Step>('company');
  const [planKey, setPlanKey] = useState('team');
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [seats, setSeats] = useState(5);
  const [form, setForm] = useState<Partial<Schemas['SignupStart']>>({ tenantType: 'brokerage' });
  const [signup, setSignup] = useState<Schemas['Signup'] | null>(null);
  const [done, setDone] = useState<Schemas['SignupComplete'] | null>(null);
  const [code, setCode] = useState('');
  const [accepted, setAccepted] = useState(false);

  const plan = plans.data?.find((p) => p.key === planKey);
  const enterprise = plan && !plan.selfService;
  const individual = plan?.tenantType === 'individual';
  const users = individual ? 1 : seats;
  const price = Number(cycle === 'monthly' ? (plan?.priceMonthly ?? 0) : (plan?.priceYearly ?? 0));
  const subtotal = price * users;
  const set = (p: Partial<Schemas['SignupStart']>) => setForm((f) => ({ ...f, ...p }));

  const start = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/public/signup', {
          body: {
            ...(form as Schemas['SignupStart']),
            tenantType: individual ? 'individual' : 'brokerage',
            planKey,
            seats: users,
            billingCycle: cycle,
            acceptTerms: true,
            turnstileToken: 'dev-local',
          },
        }),
      ),
    onSuccess: (s) => {
      setSignup(s);
      setStep(s.emailVerified ? 'card' : 'verify');
    },
  });
  const verify = useMutation({
    mutationFn: async () => unwrap(await api.POST('/public/signup/{id}/verify-email', { params: { path: { id: signup!.signupId } }, body: { code } })),
    onSuccess: (s) => {
      setSignup(s);
      setStep('card');
    },
  });
  const resend = useMutation({ mutationFn: async () => unwrap(await api.POST('/public/signup/{id}/resend-code', { params: { path: { id: signup!.signupId } } })) });
  const complete = useMutation({
    mutationFn: async (setupIntentId: string) => unwrap(await api.POST('/public/signup/{id}/complete', { params: { path: { id: signup!.signupId } }, body: { setupIntentId } })),
    onSuccess: (r) => {
      setDone(r);
      setStep('done');
    },
  });
  const fieldErr = (f: string) => (start.error instanceof ApiError ? start.error.fieldError(f) : undefined);

  function submitCompany(e: FormEvent) {
    e.preventDefault();
    start.mutate();
  }

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="mx-auto max-w-5xl rounded-lg border border-border bg-surface p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">
            ● Estate<span className="text-primary">CRM</span> · Start your 14-day free trial
          </p>
          {!enterprise ? (
            <div className="flex gap-1">
              {STEPS.map((s) => {
                const idx = STEPS.findIndex((x) => x.key === step);
                const mine = STEPS.findIndex((x) => x.key === s.key);
                return (
                  <Badge key={s.key} tone={s.key === step ? 'primary' : mine < idx || step === 'done' ? 'success' : 'neutral'}>
                    {s.label} {mine < idx || step === 'done' ? <Check className="ml-1 size-3" /> : null}
                  </Badge>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase text-muted-foreground">Choose a plan · prices exclude 5% VAT</p>
            <div className="grid grid-cols-3 gap-2">
              {plans.data?.map((p: Plan) => (
                <button
                  key={p.key}
                  type="button"
                  disabled={step !== 'company'}
                  onClick={() => setPlanKey(p.key)}
                  aria-label={`${p.name} plan`}
                  aria-pressed={p.key === planKey}
                  className={cn('rounded-lg border p-3 text-left', p.key === planKey ? 'border-2 border-primary' : 'border-border hover:bg-muted')}
                >
                  <p className="text-xs text-muted-foreground">{p.name}</p>
                  <p className="text-lg font-semibold">{p.selfService ? formatMoney(p.priceMonthly, p.currency) : 'Custom'}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.selfService ? 'per user / month' : 'talk to sales'} · {p.tenantType === 'individual' ? '1 agent' : p.selfService ? 'brokerage, any size' : 'large brokerage'}
                  </p>
                </button>
              ))}
            </div>
            {!enterprise ? (
              <>
                {!individual ? (
                  <Field label="Users">
                    <Input type="number" min={plan?.minSeats ?? 1} value={seats} disabled={step !== 'company'} onChange={(e) => setSeats(Math.max(1, Number(e.target.value)))} />
                  </Field>
                ) : null}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Billing</span>
                  {(['monthly', 'yearly'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={step !== 'company'}
                      onClick={() => setCycle(c)}
                      className={cn('rounded-full px-3 py-1 text-xs', cycle === c ? 'bg-primary text-primary-foreground' : 'bg-muted')}
                    >
                      {c === 'monthly' ? 'Monthly' : 'Yearly'}
                    </button>
                  ))}
                </div>
                <p className="text-sm">
                  <span className="text-muted-foreground">Estimate:</span> {users} × {formatMoney(String(price))} = {formatMoney(String(subtotal))} + VAT {formatMoney((subtotal * VAT).toFixed(2))} /{' '}
                  {cycle === 'monthly' ? 'month' : 'year'}
                </p>
              </>
            ) : null}
          </section>

          <section className="rounded-lg border border-border p-4">
            {enterprise ? (
              <SalesEnquiryForm />
            ) : step === 'company' ? (
              <form onSubmit={submitCompany} className="grid gap-3">
                <p className="text-xs font-semibold uppercase text-muted-foreground">Your company</p>
                <Field label="Company" error={fieldErr('companyName')}>
                  <Input value={form.companyName ?? ''} onChange={(e) => set({ companyName: e.target.value })} required placeholder={individual ? 'Your trading name' : 'Skyline Realty LLC'} />
                </Field>
                {individual ? (
                  <Field label="RERA broker card no. (BRN)" error={fieldErr('reraBrn')}>
                    <Input value={form.reraBrn ?? ''} onChange={(e) => set({ reraBrn: e.target.value })} required />
                  </Field>
                ) : (
                  <>
                    <Field label="Trade licence no." error={fieldErr('tradeLicenseNo')}>
                      <Input value={form.tradeLicenseNo ?? ''} onChange={(e) => set({ tradeLicenseNo: e.target.value })} required />
                    </Field>
                    <Field label="RERA ORN" error={fieldErr('reraOrn')}>
                      <Input value={form.reraOrn ?? ''} onChange={(e) => set({ reraOrn: e.target.value })} required />
                    </Field>
                  </>
                )}
                <Field label="Your name" error={fieldErr('adminFullName')}>
                  <Input value={form.adminFullName ?? ''} onChange={(e) => set({ adminFullName: e.target.value })} required />
                </Field>
                <Field label="Work email" error={fieldErr('adminEmail')}>
                  <Input type="email" value={form.adminEmail ?? ''} onChange={(e) => set({ adminEmail: e.target.value })} required />
                </Field>
                <Field label="Mobile" error={fieldErr('adminPhone')}>
                  <Input value={form.adminPhone ?? ''} onChange={(e) => set({ adminPhone: e.target.value })} required placeholder="+971 50 222 3344" />
                </Field>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} required />I accept the terms of service
                  and privacy policy.
                </label>
                <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                  {individual ? 'Brokerages enter their trade licence and RERA ORN instead.' : 'Individual agents enter their RERA broker card number (BRN) instead.'} A card is needed to
                  start the trial; you are charged only after 14 days.
                </p>
                {start.error ? <Alert>{errorMessage(start.error)}</Alert> : null}
                <div className="flex justify-end">
                  <Button type="submit" disabled={start.isPending}>
                    {start.isPending ? 'Please wait…' : 'Continue'}
                  </Button>
                </div>
              </form>
            ) : step === 'verify' ? (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  verify.mutate();
                }}
              >
                <p className="text-sm">
                  We sent a 6-digit code to <b>{form.adminEmail}</b>.
                </p>
                <Field label="Code">
                  <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus />
                </Field>
                {verify.error || resend.error ? <Alert>{errorMessage(verify.error ?? resend.error)}</Alert> : null}
                {resend.isSuccess ? <Alert tone="success">A new code was sent.</Alert> : null}
                <div className="flex justify-between">
                  <Button type="button" variant="link" onClick={() => resend.mutate()} disabled={resend.isPending}>
                    Send a new code
                  </Button>
                  <Button type="submit" disabled={code.length !== 6 || verify.isPending}>
                    Verify
                  </Button>
                </div>
              </form>
            ) : step === 'card' && signup ? (
              <>
                <CardStep cardSetup={signup.cardSetup} busy={complete.isPending} onConfirmed={(id) => complete.mutate(id)} />
                {complete.error ? <Alert className="mt-3">{errorMessage(complete.error)}</Alert> : null}
              </>
            ) : done ? (
              <div className="space-y-3">
                <Alert tone="success">
                  Your company is ready. The free trial ends on <b>{formatDate(done.trialEndsAt)}</b>. Check your email for the sign-in invitation.
                </Alert>
                <Button asChild>
                  <a href={done.loginUrl}>Go to sign in</a>
                </Button>
              </div>
            ) : null}
          </section>
        </div>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already a customer?{' '}
          <a href="/login" className="text-primary hover:underline">
            Sign in
          </a>
        </p>
      </div>
    </div>
  );
}

/** Enterprise: "Talk to sales" (SRS §12 Signing up 7). */
function SalesEnquiryForm() {
  const [f, setF] = useState<Partial<Schemas['SalesEnquiry']>>({});
  const send = useMutation({
    mutationFn: async () => unwrap(await api.POST('/public/sales-enquiries', { body: { ...(f as Schemas['SalesEnquiry']), turnstileToken: 'dev-local' } as Schemas['SalesEnquiry'] })),
  });
  if (send.isSuccess) return <Alert tone="success">Thank you. Our sales team will contact you shortly.</Alert>;
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        send.mutate();
      }}
    >
      <p className="text-xs font-semibold uppercase text-muted-foreground">Talk to sales</p>
      <Field label="Company">
        <Input value={f.companyName ?? ''} onChange={(e) => setF({ ...f, companyName: e.target.value })} required />
      </Field>
      <Field label="Your name">
        <Input value={f.contactName ?? ''} onChange={(e) => setF({ ...f, contactName: e.target.value })} required />
      </Field>
      <Field label="Work email">
        <Input type="email" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} required />
      </Field>
      <Field label="Phone">
        <Input value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </Field>
      <Field label="Number of users (estimate)">
        <Input type="number" min={1} value={f.usersEstimate ?? ''} onChange={(e) => setF({ ...f, usersEstimate: Number(e.target.value) })} />
      </Field>
      <Field label="Message">
        <Textarea value={f.message ?? ''} onChange={(e) => setF({ ...f, message: e.target.value })} />
      </Field>
      {send.error ? <Alert>{errorMessage(send.error)}</Alert> : null}
      <div className="flex justify-end">
        <Button type="submit" disabled={send.isPending}>
          Send
        </Button>
      </div>
    </form>
  );
}
