// Shift windows of rotation rules: days of the week (0 = Sunday) and hours in a time zone. Overnight shifts
// (start after end, e.g. 22:00–06:00) belong to the day they start.

export interface Shift {
  days: number[];
  /** 'HH:MM' or 'HH:MM:SS'; both empty = all day. */
  start: string | null;
  end: string | null;
  timeZone: string;
}

const minutesOf = (t: string): number => {
  const [h, m] = t.split(':').map(Number);
  return h! * 60 + m!;
};

/** Weekday (0–6) and minutes after midnight of a moment, in the time zone. */
function localParts(at: Date, timeZone: string): { day: number; minutes: number; y: number; m: number; d: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday!);
  return { day, minutes: Number(parts.hour) * 60 + Number(parts.minute), y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

/** The UTC moment of a local date and time in the time zone. */
function zoned(y: number, m: number, d: number, minutes: number, timeZone: string): Date {
  const guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  const p = localParts(new Date(guess), timeZone);
  const shownAsUtc = Date.UTC(p.y, p.m - 1, p.d, Math.floor(p.minutes / 60), p.minutes % 60);
  return new Date(guess - (shownAsUtc - guess));
}

/** True when the moment falls inside the shift. */
export function inShift(shift: Shift, at: Date = new Date()): boolean {
  const { day, minutes } = localParts(at, shift.timeZone);
  if (!shift.start || !shift.end) return shift.days.includes(day);
  const start = minutesOf(shift.start);
  const end = minutesOf(shift.end);
  if (start <= end) return shift.days.includes(day) && minutes >= start && minutes < end;
  // Overnight: the evening part counts for today, the early-morning part for yesterday.
  if (minutes >= start) return shift.days.includes(day);
  return minutes < end && shift.days.includes((day + 6) % 7);
}

/** When the shift next starts after the moment (within a week). */
export function nextShiftStart(shift: Shift, at: Date = new Date()): Date {
  const start = shift.start ? minutesOf(shift.start) : 0;
  const local = localParts(at, shift.timeZone);
  for (let i = 0; i <= 7; i++) {
    const date = new Date(Date.UTC(local.y, local.m - 1, local.d + i));
    const day = date.getUTCDay();
    if (!shift.days.includes(day)) continue;
    const candidate = zoned(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), start, shift.timeZone);
    if (candidate > at) return candidate;
  }
  return new Date(at.getTime() + 24 * 3_600_000);
}
