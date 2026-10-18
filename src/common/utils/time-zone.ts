const DAY_MS = 86_400_000;

/** True for IANA zone names the runtime knows, e.g. "Europe/London" or "UTC". */
export function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function partsIn(instant: number, timeZone: string) {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  const p = Object.fromEntries(
    f.formatToParts(instant).map(({ type, value }) => [type, Number(value)]),
  ) as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
  return p;
}

/** How far `timeZone` is ahead of UTC at `instant`, in ms. */
function offsetAt(instant: number, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(instant / 1000) * 1000;
}

/** The instant of midnight on calendar day y-m-d in `timeZone` (month is 1-based; days may overflow). */
function midnightOf(year: number, month: number, day: number, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, day);
  // Offsets differ either side of a DST change, so correct the first guess once.
  const guess = wall - offsetAt(wall, timeZone);
  return new Date(wall - offsetAt(guess, timeZone));
}

/** Midnight at the start of the Monday-based week containing `instant`, in `timeZone`. */
export function startOfWeekIn(instant: Date, timeZone: string): Date {
  const p = partsIn(instant.getTime(), timeZone);
  const weekday = (new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() + 6) % 7; // Monday = 0
  return midnightOf(p.year, p.month, p.day - weekday, timeZone);
}

/**
 * Starts of `count` consecutive weeks in `timeZone`, the last being the current week.
 * Computed one by one because a week with a DST change is an hour shorter or longer.
 */
export function weekStartsIn(now: Date, count: number, timeZone: string): Date[] {
  const current = startOfWeekIn(now, timeZone);
  return Array.from({ length: count }, (_, i) =>
    startOfWeekIn(new Date(current.getTime() - (count - 1 - i) * 7 * DAY_MS + DAY_MS), timeZone),
  );
}
