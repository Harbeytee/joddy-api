/**
 * Streams a job-scraper `jobs.jsonl` file into the API's ingest endpoint in batches,
 * then marks jobs that weren't in the file as inactive.
 *
 *   npm run jobs:import -- ../../job-scraper/data/jobs.jsonl [--limit 5000] [--api http://localhost:4000]
 */
import 'dotenv/config';
import { parseArgs } from 'node:util';
import { readFeedBatches } from '../src/modules/jobs/feed/job-feed';

const BATCH_SIZE = 500;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    api: {
      type: 'string',
      default: process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`,
    },
    limit: { type: 'string' },
    'keep-stale': { type: 'boolean', default: false },
  },
});

const file = positionals[0];
if (!file) {
  console.error(
    'Usage: npm run jobs:import -- <path/to/jobs.jsonl> [--limit N] [--api URL] [--keep-stale]',
  );
  process.exit(1);
}

const key = process.env.INGEST_API_KEY;
if (!key) {
  console.error('INGEST_API_KEY is not set');
  process.exit(1);
}

const base = `${values.api.replace(/\/$/, '')}/api/v1/jobs/ingest`;
const limit = values.limit ? Number(values.limit) : Infinity;

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`${status} ${body}`);
  }
}

async function post(path: string, body: unknown): Promise<Record<string, number>> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ingest-key': key! },
      body: JSON.stringify(body),
    });
    if (res.ok) return (await res.json()) as Record<string, number>;
    if (attempt < 3 && res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    throw new HttpError(res.status, await res.text());
  }
}

/** Validation errors look like "jobs.12.url must be a URL address"; returns the offending indexes. */
function invalidIndexes(err: unknown): Set<number> {
  if (!(err instanceof HttpError) || err.status !== 400) return new Set();
  const indexes = [...err.body.matchAll(/jobs\.(\d+)\./g)].map((m) => Number(m[1]));
  return new Set(indexes);
}

async function main() {
  const startedAt = new Date().toISOString();
  let batch: unknown[] = [];
  let sent = 0;
  let skipped = 0;

  const flush = async () => {
    if (!batch.length) return;
    try {
      await post('', { jobs: batch });
    } catch (err) {
      const bad = invalidIndexes(err);
      if (!bad.size) throw err;
      for (const i of bad)
        console.warn(`\n  skipping invalid job ${String((batch[i] as { id?: unknown })?.id)}`);
      skipped += bad.size;
      batch = batch.filter((_, i) => !bad.has(i));
      return flush();
    }
    sent += batch.length;
    process.stdout.write(`\r  imported ${sent} jobs`);
    batch = [];
  };

  feed: for await (const jobs of readFeedBatches(file, BATCH_SIZE)) {
    for (const job of jobs) {
      batch.push(job);
      if (batch.length >= BATCH_SIZE) await flush();
      if (sent + batch.length >= limit) break feed;
    }
  }
  await flush();
  console.log(`\nDone: ${sent} jobs imported${skipped ? `, ${skipped} skipped as invalid` : ''}`);

  // A partial import (--limit) must not deactivate everything that wasn't included.
  if (!values['keep-stale'] && limit === Infinity) {
    const { deactivated } = await post('/deactivate-stale', { notSeenSince: startedAt });
    console.log(`Marked ${deactivated} jobs that are no longer listed as inactive`);
  }
}

main().catch((err) => {
  console.error(`\nImport failed: ${(err as Error).message}`);
  process.exit(1);
});
