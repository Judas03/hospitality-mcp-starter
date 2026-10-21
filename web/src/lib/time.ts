// All listings are in Thailand, so dates and times are read and shown in Bangkok time
// (UTC+7, no daylight saving) whatever the viewer's own clock says.

export const TIME_ZONE = 'Asia/Bangkok';
const OFFSET = '+07:00';
const OFFSET_MS = 7 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Today's date in Bangkok as YYYY-MM-DD. */
export function bangkokDate(now: Date): string {
  const local = new Date(now.getTime() + OFFSET_MS);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

/** Day of the week (0 = Sunday) for a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** YYYY-MM-DD + HH:MM in Bangkok -> ISO 8601 with offset. */
export function toIsoDateTime(date: string, time: string): string {
  return `${date}T${time}:00${OFFSET}`;
}

/** Shift an ISO date-time by whole minutes, keeping the Bangkok offset. */
export function addMinutes(iso: string, minutes: number): string {
  const local = new Date(new Date(iso).getTime() + minutes * 60_000 + OFFSET_MS);
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  return toIsoDateTime(date, `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`);
}

/** An instant as a Bangkok ISO 8601 date-time with seconds. */
export function toBangkokIso(epochMs: number): string {
  const local = new Date(epochMs + OFFSET_MS);
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  return `${date}T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}${OFFSET}`;
}

/** The Bangkok YYYY-MM-DD and HH:MM parts of an ISO date-time. */
export function splitIso(iso: string): { date: string; time: string } {
  const local = new Date(new Date(iso).getTime() + OFFSET_MS);
  return {
    date: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
  };
}

const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TIME_ZONE,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
});

/** "7:00 PM" */
export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

/** "Thu 22 Oct" from an ISO date-time or a YYYY-MM-DD date. */
export function formatDate(value: string): string {
  const iso = value.length === 10 ? toIsoDateTime(value, '12:00') : value;
  return dateFormat.format(new Date(iso)).replace(',', '');
}

/** "Thu 22 Oct, 7:00 – 9:00 PM", or both dates when the range crosses midnight (hotels). */
export function formatRange(start: string, end: string): string {
  if (splitIso(start).date === splitIso(end).date) {
    return `${formatDate(start)}, ${formatTime(start)} – ${formatTime(end)}`;
  }
  return `${formatDate(start)} ${formatTime(start)} → ${formatDate(end)} ${formatTime(end)}`;
}

/** "13:05:09" in Bangkok time, for the activity log. */
export function formatClock(epochMs: number): string {
  const local = new Date(epochMs + OFFSET_MS);
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
}

/** "HH:MM" (24-hour) -> "7:00 PM" */
export function formatClockTime(time: string): string {
  return formatTime(toIsoDateTime('2026-01-01', time));
}
