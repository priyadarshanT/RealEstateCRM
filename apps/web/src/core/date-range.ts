// Date filter presets shared by lists, the dashboard and reports (SRS §1.4, §8.1, §10.6).
// The API takes filter dates as YYYY-MM-DD (format: date) with `to` inclusive.

export const DATE_PRESETS = [
  { key: 'any', label: 'Any time' },
  { key: 'today', label: 'Today' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'thisYear', label: 'This year' },
] as const;

export type DatePreset = (typeof DATE_PRESETS)[number]['key'];

/** Local calendar date as YYYY-MM-DD. */
export function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** First and last day (inclusive) of a preset, as YYYY-MM-DD. */
export function presetRange(preset: DatePreset, now = new Date()): { from?: string; to?: string } {
  const day = (y: number, m: number, d: number) => new Date(y, m, d);
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = day(y, m, now.getDate());
  switch (preset) {
    case 'today':
      return { from: ymd(today), to: ymd(today) };
    case 'last7':
      return { from: ymd(day(y, m, now.getDate() - 6)), to: ymd(today) };
    case 'last30':
      return { from: ymd(day(y, m, now.getDate() - 29)), to: ymd(today) };
    case 'thisMonth':
      return { from: ymd(day(y, m, 1)), to: ymd(today) };
    case 'lastMonth':
      return { from: ymd(day(y, m - 1, 1)), to: ymd(day(y, m, 0)) };
    case 'thisYear':
      return { from: ymd(day(y, 0, 1)), to: ymd(today) };
    default:
      return {};
  }
}
