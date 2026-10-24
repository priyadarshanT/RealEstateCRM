'use client';

import { Alert, Button, Field, Input, Loading, Textarea, cn } from '@crm/ui';
import type { Schemas } from '@crm/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api, ApiError, errorMessage, unwrap } from '@/core/api';
import { useTurnstile } from '@/core/turnstile';

const CHANNEL: Record<string, string> = { google_meet: 'Google Meet', teams: 'Microsoft Teams', in_person: 'In person', phone: 'Phone call' };

/**
 * The client's booking page (SRS §3.9–3.12, wireframe "Client booking page"): no login, free times shown in the
 * client's own time zone, then name and phone. The meeting link and confirmation are created automatically.
 */
export function PublicBookingScreen({ slug, turnstileSiteKey }: { slug: string; turnstileSiteKey?: string }) {
  const timezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Dubai', []);
  const page = useQuery({
    queryKey: ['public-booking', slug],
    retry: false,
    queryFn: async () => unwrap(await api.GET('/public/booking/{slug}', { params: { path: { slug }, query: { timezone } } })),
  });
  const [picked, setPicked] = useState<string | null>(null);
  const botCheck = useTurnstile(turnstileSiteKey);
  const [form, setForm] = useState({ fullName: '', phone: '', email: '', message: '', consentWhatsApp: true });
  const book = useMutation({
    mutationFn: async () =>
      unwrap(
        await api.POST('/public/booking/{slug}', {
          params: { path: { slug } },
          headers: { 'CF-Turnstile-Token': botCheck.token! },
          body: { startsAt: picked!, fullName: form.fullName.trim(), phone: form.phone.replace(/\s/g, ''), timezone, consentWhatsApp: form.consentWhatsApp, ...(form.email.trim() ? { email: form.email.trim() } : {}), ...(form.message.trim() ? { message: form.message.trim() } : {}) } as Schemas['PublicBookingRequest'],
        }),
      ),
    onError: () => void page.refetch(),
    onSettled: () => botCheck.reset(),
  });

  const days = useMemo(() => {
    const byDay = new Map<string, string[]>();
    for (const s of page.data?.slots ?? []) {
      if (!s.startsAt) continue;
      const key = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(s.startsAt));
      byDay.set(key, [...(byDay.get(key) ?? []), s.startsAt]);
    }
    return [...byDay.entries()].slice(0, 10);
  }, [page.data, timezone]);
  const time = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const full = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  const taken = book.error instanceof ApiError && book.error.problem.code === 'SLOT_TAKEN';

  return (
    <div className="min-h-screen bg-sidebar px-4 py-8">
      <div className="mx-auto max-w-md overflow-hidden rounded-3xl bg-surface shadow-2xl">
        <div className="bg-sidebar px-5 py-3 text-center text-sm text-sidebar-foreground">{page.data?.companyName ?? 'Book a meeting'}</div>
        <div className="space-y-4 p-5">
          {page.isLoading ? <Loading /> : null}
          {page.error ? <Alert>{page.error instanceof ApiError && page.error.status === 404 ? 'This booking page does not exist or is switched off.' : errorMessage(page.error)}</Alert> : null}
          {book.data ? (
            <div className="space-y-3 text-center">
              <CheckCircle2 className="mx-auto size-12 text-primary" />
              <p className="text-lg font-semibold">You are booked</p>
              <p>{full(book.data.startsAt)}</p>
              <p className="text-sm text-muted-foreground">Times shown in your time zone ({book.data.timezone}).</p>
              {book.data.joinUrl ? (
                <a href={book.data.joinUrl} target="_blank" rel="noreferrer" className="block break-all font-medium text-primary hover:underline">
                  {book.data.joinUrl}
                </a>
              ) : null}
              <p className="text-sm text-muted-foreground">A confirmation is on its way.</p>
            </div>
          ) : page.data ? (
            <>
              <div>
                <h1 className="text-lg font-semibold">{page.data.title}</h1>
                <p className="text-sm text-muted-foreground">
                  {page.data.agentName} · {page.data.durationMinutes} min · {CHANNEL[page.data.meetingChannel ?? ''] ?? page.data.meetingChannel}
                </p>
                <p className="text-xs text-muted-foreground">Times shown in your time zone ({timezone})</p>
              </div>
              {days.length === 0 ? <Alert tone="info">No free times in the next two weeks. Please check again later.</Alert> : null}
              <div className="max-h-72 space-y-3 overflow-y-auto">
                {days.map(([day, starts]) => (
                  <div key={day}>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{day}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {starts.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setPicked(s)}
                          className={cn('rounded-lg border px-3 py-1.5 text-sm font-medium', picked === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted')}
                        >
                          {time(s)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {picked ? (
                <form
                  className="space-y-3 border-t border-border pt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    book.mutate();
                  }}
                >
                  <p className="text-sm font-medium">{full(picked)}</p>
                  <Field label="Name *">
                    <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required autoComplete="name" />
                  </Field>
                  <Field label="Phone (with country code) *" error={book.error instanceof ApiError ? book.error.fieldError('phone') : undefined}>
                    <Input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required placeholder="+44 7700 900123" autoComplete="tel" />
                  </Field>
                  <Field label="Email">
                    <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" />
                  </Field>
                  <Field label="Message">
                    <Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="min-h-16" />
                  </Field>
                  <label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-1" checked={form.consentWhatsApp} onChange={(e) => setForm({ ...form, consentWhatsApp: e.target.checked })} />
                    You may contact me on WhatsApp about this meeting.
                  </label>
                  {botCheck.widget}
                  {taken ? <Alert>Someone just booked this time. Please pick another one.</Alert> : book.error ? <Alert>{errorMessage(book.error)}</Alert> : null}
                  <Button type="submit" className="h-11 w-full text-base" disabled={book.isPending || !botCheck.token}>
                    {book.isPending ? 'Booking…' : 'Confirm'}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">The meeting link and confirmation are sent automatically.</p>
                </form>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
