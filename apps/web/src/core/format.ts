// Display helpers. The API sends UTC ISO times and decimal-string money; screens show the user's time zone.

const DEFAULT_TZ = 'Asia/Dubai';

export function formatDateTime(iso: string | null | undefined, timeZone = DEFAULT_TZ): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function formatDate(iso: string | null | undefined, timeZone = DEFAULT_TZ): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

/** "Today 4:00 pm", "Tomorrow 11:00 am", "Yesterday", or a date. */
export function formatRelativeDay(iso: string | null | undefined, timeZone = DEFAULT_TZ): string {
  if (!iso) return '—';
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const target = new Date(iso);
  const now = new Date();
  const diffDays = Math.round((Date.parse(day(target)) - Date.parse(day(now))) / 86_400_000);
  if (diffDays === 0) return `Today ${formatTime(iso, timeZone)}`;
  if (diffDays === 1) return `Tomorrow ${formatTime(iso, timeZone)}`;
  if (diffDays === -1) return 'Yesterday';
  return formatDate(iso, timeZone);
}

export function formatMoney(amount: string | null | undefined, currency = 'AED'): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = Number(amount);
  return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Short money for cards: AED 38.6M, AED 412K. */
export function formatMoneyShort(amount: string | null | undefined, currency = 'AED'): string {
  if (!amount) return `${currency} 0`;
  const n = Number(amount);
  if (Math.abs(n) >= 1_000_000) return `${currency} ${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${currency} ${(n / 1_000).toFixed(0)}K`;
  return `${currency} ${n.toFixed(0)}`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/** Converts a value from <input type="datetime-local"> (local time) to UTC ISO. */
export function localInputToIso(value: string): string {
  return new Date(value).toISOString();
}

/** Converts UTC ISO to a value for <input type="datetime-local">. */
export function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
