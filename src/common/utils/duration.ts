const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** Parses "15m", "12h", "30s", "7d" into milliseconds. */
export function durationToMs(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match)
    throw new Error(`Invalid duration "${value}". Use a number followed by s, m, h or d.`);
  return Number(match[1]) * UNITS[match[2]];
}
