import { isTimeZone, startOfWeekIn, weekStartsIn } from './time-zone';

describe('isTimeZone', () => {
  it.each(['UTC', 'Europe/London', 'Africa/Lagos', 'America/New_York'])('accepts %s', (tz) => {
    expect(isTimeZone(tz)).toBe(true);
  });

  it.each(['', 'Mars/Olympus', 'GMT+25', 42, null])('rejects %p', (tz) => {
    expect(isTimeZone(tz)).toBe(false);
  });
});

describe('startOfWeekIn', () => {
  const iso = (d: Date) => d.toISOString();

  it('uses Monday midnight in the given zone', () => {
    const sunday = new Date('2026-10-18T13:00:00Z');
    expect(iso(startOfWeekIn(sunday, 'UTC'))).toBe('2026-10-12T00:00:00.000Z');
    expect(iso(startOfWeekIn(sunday, 'Africa/Lagos'))).toBe('2026-10-11T23:00:00.000Z');
  });

  it('goes by the local day, not the UTC day', () => {
    // Monday 02:00 UTC is still Sunday evening in New York.
    const instant = new Date('2026-10-19T02:00:00Z');
    expect(iso(startOfWeekIn(instant, 'UTC'))).toBe('2026-10-19T00:00:00.000Z');
    expect(iso(startOfWeekIn(instant, 'America/New_York'))).toBe('2026-10-12T04:00:00.000Z');
  });
});

describe('weekStartsIn', () => {
  it('handles a week in which the clocks change', () => {
    // UK clocks go back on Sunday 25 October 2026.
    const weeks = weekStartsIn(new Date('2026-10-28T12:00:00Z'), 3, 'Europe/London');
    expect(weeks.map((d) => d.toISOString())).toEqual([
      '2026-10-11T23:00:00.000Z',
      '2026-10-18T23:00:00.000Z',
      '2026-10-26T00:00:00.000Z',
    ]);
  });
});
