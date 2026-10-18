import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDateOnly, normalizeFeedJob, readFeedBatches } from './job-feed';

describe('isDateOnly', () => {
  it.each([
    ['2026-10-08', true],
    ['2026-10-08T00:00:00.000Z', true],
    ['2026-10-08T00:00:00Z', true],
    ['2026-10-08T00:00:00+00:00', true],
    ['2026-10-08T20:50:22.000Z', false],
    ['2026-10-08T00:00:01.000Z', false],
    ['2026-10-08T00:00:00.000+01:00', false],
    [null, false],
    [undefined, false],
  ])('%s -> %s', (value, expected) => {
    expect(isDateOnly(value)).toBe(expected);
  });
});

describe('normalizeFeedJob', () => {
  it('drops scraper bookkeeping and trims oversized fields without touching the input', () => {
    const raw = {
      id: 'lever:acme:1',
      isNew: true,
      firstSeenAt: '2026-10-01T00:00:00.000Z',
      title: 'x'.repeat(400),
      locations: Array.from({ length: 250 }, (_, i) => `City ${i}`),
    };
    const job = normalizeFeedJob(raw);
    expect(job).not.toHaveProperty('isNew');
    expect(job).not.toHaveProperty('firstSeenAt');
    expect(job.title).toHaveLength(300);
    expect(String(job.title).endsWith('…')).toBe(true);
    expect(job.locations).toHaveLength(200);
    expect(raw.title).toHaveLength(400);
  });
});

describe('readFeedBatches', () => {
  let dir: string;
  beforeAll(async () => (dir = await mkdtemp(join(tmpdir(), 'joddy-feed-'))));
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('streams the feed in batches, skipping blank lines', async () => {
    const file = join(dir, 'jobs.jsonl');
    const lines = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ id: `job-${i}`, isNew: false }),
    );
    await writeFile(file, `${lines.slice(0, 3).join('\n')}\n\n${lines.slice(3).join('\n')}\n`);

    const batches: Record<string, unknown>[][] = [];
    for await (const batch of readFeedBatches(file, 2)) batches.push(batch);

    expect(batches.map((b) => b.map((j) => j.id))).toEqual([
      ['job-0', 'job-1'],
      ['job-2', 'job-3'],
      ['job-4'],
    ]);
    expect(batches[0][0]).not.toHaveProperty('isNew');
  });
});
