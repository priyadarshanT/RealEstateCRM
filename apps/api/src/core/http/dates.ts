// Date-only values (OpenAPI `format: date`, e.g. "2026-10-01"). Filters use UTC days with `to` inclusive (API guide §4).

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date written as YYYY-MM-DD ("2026-02-30" and timestamps are rejected). */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_ONLY.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** Start of the UTC day: the lower bound of a `from` filter. */
export function dayStart(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** Start of the next UTC day: the exclusive upper bound of an inclusive `to` filter. */
export function dayAfter(date: string): Date {
  return new Date(dayStart(date).getTime() + 86_400_000);
}

/** Midnight of a calendar day in a time zone, as a UTC moment (date filters "in the company time zone"). */
export function zonedDayStart(date: string, timeZone: string): Date {
  const guess = dayStart(date).getTime();
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const shown = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!);
  return new Date(guess - (shown - guess));
}

/** Midnight of the next day in the time zone: the exclusive upper bound of an inclusive `to` date. */
export function zonedDayAfter(date: string, timeZone: string): Date {
  const next = new Date(dayStart(date).getTime() + 86_400_000).toISOString().slice(0, 10);
  return zonedDayStart(next, timeZone);
}
