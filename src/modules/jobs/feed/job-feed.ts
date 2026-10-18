import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** Mirrors IngestJobDto's MaxLength limits so one oversized field doesn't reject a whole batch. */
const MAX_LENGTHS: Record<string, number> = {
  companyName: 200,
  title: 300,
  department: 300,
  location: 500,
  employmentType: 100,
  description: 100_000,
};
const MAX_LOCATIONS = 200;

/** Scraper bookkeeping that isn't part of a job. */
const SCRAPER_FIELDS = ['isNew', 'firstSeenAt'];

/** Trims a job-scraper feed line to what the ingest API accepts. */
export function normalizeFeedJob(raw: Record<string, unknown>): Record<string, unknown> {
  const job = { ...raw };
  for (const field of SCRAPER_FIELDS) delete job[field];
  for (const [field, max] of Object.entries(MAX_LENGTHS)) {
    const value = job[field];
    if (typeof value === 'string' && value.length > max) job[field] = `${value.slice(0, max - 1)}…`;
  }
  if (Array.isArray(job.locations) && job.locations.length > MAX_LOCATIONS) {
    job.locations = job.locations.slice(0, MAX_LOCATIONS);
  }
  return job;
}

/**
 * Boards like BambooHR and Workable only publish the day a job went up. The scraper turns that
 * into midnight UTC, so a bare date or an exact UTC midnight means the time of day is unknown.
 */
export function isDateOnly(postedAt: string | null | undefined): boolean {
  if (!postedAt) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(postedAt) || /T00:00:00(\.0+)?(Z|[+-]00:?00)$/.test(postedAt);
}

/** Streams a JSON Lines feed in batches, so a multi-gigabyte file never sits in memory at once. */
export async function* readFeedBatches(
  file: string,
  size: number,
): AsyncGenerator<Record<string, unknown>[]> {
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let batch: Record<string, unknown>[] = [];
  for await (const line of lines) {
    if (!line.trim()) continue;
    batch.push(normalizeFeedJob(JSON.parse(line) as Record<string, unknown>));
    if (batch.length >= size) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}
