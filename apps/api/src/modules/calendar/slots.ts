import { WeeklyHours } from './calendar.schema';

// Free slots for an agent (SRS §3.9–3.12): weekly bookable hours in the company time zone, minus meetings already
// booked (with the buffer around them) and anything sooner than the minimum notice. Clients see the times in their
// own time zone; the API always works in UTC.

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** Default bookable hours when an agent has not set their own: Monday to Friday, 9:00 to 18:00. */
export const DEFAULT_WEEKLY_HOURS: WeeklyHours = {
  mon: [['09:00', '18:00']],
  tue: [['09:00', '18:00']],
  wed: [['09:00', '18:00']],
  thu: [['09:00', '18:00']],
  fri: [['09:00', '18:00']],
};

export interface SlotInput {
  from: Date;
  to: Date;
  durationMinutes: number;
  bufferMinutes: number;
  minNoticeHours: number;
  weeklyHours: WeeklyHours;
  timeZone: string;
  busy: { startsAt: Date; endsAt: Date }[];
  now?: Date;
  /** Safety limit for very wide ranges. */
  max?: number;
}

export function freeSlots(input: SlotInput): { startsAt: Date; endsAt: Date }[] {
  const now = input.now ?? new Date();
  const earliest = Math.max(input.from.getTime(), now.getTime() + input.minNoticeHours * 3_600_000);
  const length = input.durationMinutes * 60_000;
  const step = (input.durationMinutes + input.bufferMinutes) * 60_000;
  const gap = input.bufferMinutes * 60_000;
  const busy = input.busy.map((b) => [b.startsAt.getTime() - gap, b.endsAt.getTime() + gap] as const);
  const out: { startsAt: Date; endsAt: Date }[] = [];

  // Walk the local calendar days that overlap [from, to].
  let day = localDate(input.from, input.timeZone);
  const last = localDate(input.to, input.timeZone);
  for (let guard = 0; compareDay(day, last) <= 0 && guard < 400; guard++, day = nextDay(day)) {
    const weekday = DAYS[new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay()]!;
    for (const [open, close] of input.weeklyHours[weekday] ?? []) {
      const start = zonedToUtc(day, open, input.timeZone);
      const end = zonedToUtc(day, close, input.timeZone);
      for (let t = start; t + length <= end; t += step) {
        if (t < earliest || t + length > input.to.getTime()) continue;
        if (busy.some(([bs, be]) => t < be && t + length > bs)) continue;
        out.push({ startsAt: new Date(t), endsAt: new Date(t + length) });
        if (out.length >= (input.max ?? 500)) return out;
      }
    }
  }
  return out;
}

/** True when the time is one of the agent's bookable slots right now (used when a client books). */
export function isFreeSlot(input: Omit<SlotInput, 'from' | 'to'>, startsAt: Date): boolean {
  const from = new Date(startsAt.getTime());
  const to = new Date(startsAt.getTime() + input.durationMinutes * 60_000);
  return freeSlots({ ...input, from, to }).some((s) => s.startsAt.getTime() === startsAt.getTime());
}

interface Day {
  y: number;
  m: number;
  d: number;
}

function localDate(at: Date, timeZone: string): Day {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

function nextDay(day: Day): Day {
  const n = new Date(Date.UTC(day.y, day.m - 1, day.d + 1));
  return { y: n.getUTCFullYear(), m: n.getUTCMonth() + 1, d: n.getUTCDate() };
}

function compareDay(a: Day, b: Day): number {
  return a.y - b.y || a.m - b.m || a.d - b.d;
}

/** Offset of the time zone from UTC at that instant, in milliseconds. */
function offsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - Math.floor(at / 1000) * 1000;
}

/** "09:00" on a local day in the time zone, as a UTC instant (handles daylight-saving changes). */
function zonedToUtc(day: Day, hhmm: string, timeZone: string): number {
  const [h, min] = hhmm.split(':').map(Number);
  const guess = Date.UTC(day.y, day.m - 1, day.d, h!, min!);
  let utc = guess - offsetMs(guess, timeZone);
  utc = guess - offsetMs(utc, timeZone);
  return utc;
}

/** Weekly hours as stored: only known weekdays and well-formed "HH:MM" pairs with open < close. */
export function checkWeeklyHours(value: Record<string, unknown>): { weeklyHours: WeeklyHours; errors: { field: string; message: string }[] } {
  const errors: { field: string; message: string }[] = [];
  const weeklyHours: WeeklyHours = {};
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const [key, ranges] of Object.entries(value)) {
    if (!(DAYS as readonly string[]).includes(key)) {
      errors.push({ field: `weeklyHours.${key}`, message: 'use sun, mon, tue, wed, thu, fri or sat' });
      continue;
    }
    if (!Array.isArray(ranges) || ranges.some((r) => !Array.isArray(r) || r.length !== 2 || !time.test(String(r[0])) || !time.test(String(r[1])) || String(r[0]) >= String(r[1]))) {
      errors.push({ field: `weeklyHours.${key}`, message: 'a list of ["HH:MM","HH:MM"] ranges, start before end' });
      continue;
    }
    weeklyHours[key as keyof WeeklyHours] = ranges as [string, string][];
  }
  return { weeklyHours, errors };
}
