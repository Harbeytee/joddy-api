import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';
import { TEST_DATABASE_URL, TEST_ENV } from './setup-env';

/** Stands in for job-scraper: does what plan.json says, like the real one writes data/jobs.jsonl. */
const FAKE_SCRAPER = `
const fs = require('node:fs');
const plan = JSON.parse(fs.readFileSync('plan.json', 'utf8'));
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/env.json', JSON.stringify({ argv: process.argv.slice(2), env: Object.keys(process.env) }));
if (plan.fail) {
  console.error('boom: ' + plan.fail);
  process.exit(2);
}
fs.writeFileSync('data/jobs.jsonl', plan.jobs.map((j) => JSON.stringify(j)).join('\\n') + '\\n');
`;

const feedJob = (n: number, overrides: Record<string, unknown> = {}) => ({
  id: `workable:sync-co:${n}`,
  source: 'workable',
  company: 'sync-co',
  companyName: 'Sync Co',
  title: `Sync Engineer ${n}`,
  location: 'Lagos, Nigeria',
  locations: ['Lagos, Nigeria'],
  postedAt: '2026-10-18T09:30:00.000Z',
  url: `https://apply.workable.com/sync-co/j/${n}`,
  description: 'TypeScript and Postgres.',
  isNew: true,
  firstSeenAt: '2026-10-18T10:00:00.000Z',
  ...overrides,
});

interface SyncRun {
  status: 'SUCCEEDED' | 'FAILED';
  imported: number;
  skipped: number;
  deactivated: number;
  error: string | null;
}

describe('Job sync (e2e)', () => {
  const db = new Client({ connectionString: TEST_DATABASE_URL });
  let dir = '';
  /** Jobs other e2e suites left active; closed during this suite so the stale-job maths is exact. */
  let otherActive: string[] = [];

  const plan = (p: { jobs?: unknown[]; fail?: string }) =>
    writeFile(join(dir, 'plan.json'), JSON.stringify(p));

  const sync = (): SyncRun | null => {
    const run = spawnSync(process.execPath, ['test/support/job-sync.cjs'], {
      env: { ...process.env, ...TEST_ENV, JOB_SYNC_SCRAPER_DIR: dir, JOB_SYNC_EVERY_HOURS: '6' },
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    return JSON.parse(run.stdout) as SyncRun | null;
  };

  /** Pretends the previous runs happened this long ago. */
  const backdate = (interval: string) =>
    db.query(`UPDATE job_sync_runs SET "startedAt" = "startedAt" - $1::interval`, [interval]);

  const job = async (n: number) =>
    (
      await db.query<{ isActive: boolean; postedDateOnly: boolean }>(
        `SELECT "isActive", "postedDateOnly" FROM jobs WHERE "externalId" = $1`,
        [`workable:sync-co:${n}`],
      )
    ).rows[0];

  beforeAll(async () => {
    await db.connect();
    await db.query(`DELETE FROM job_sync_runs`);
    const { rows } = await db.query<{ id: string }>(
      `UPDATE jobs SET "isActive" = false WHERE "isActive" RETURNING id`,
    );
    otherActive = rows.map((r) => r.id);

    dir = await mkdtemp(join(tmpdir(), 'joddy-scraper-'));
    await mkdir(join(dir, 'src'));
    await writeFile(join(dir, 'src', 'scrape.js'), FAKE_SCRAPER);
  });

  afterAll(async () => {
    await db.query(`DELETE FROM jobs WHERE "externalId" LIKE 'workable:sync-co:%'`);
    await db.query(`DELETE FROM job_sync_runs`);
    if (otherActive.length) {
      await db.query(`UPDATE jobs SET "isActive" = true WHERE id = ANY($1::uuid[])`, [otherActive]);
    }
    await db.end();
    await rm(dir, { recursive: true, force: true });
  });

  it('scrapes and imports the feed, skipping invalid jobs and flagging date-only posts', async () => {
    await plan({
      jobs: [
        feedJob(1, { postedAt: '2026-10-18T00:00:00.000Z' }),
        feedJob(2),
        feedJob(3, { url: 'not a url' }),
      ],
    });
    expect(sync()).toMatchObject({ status: 'SUCCEEDED', imported: 2, skipped: 1, deactivated: 0 });
    expect(await job(1)).toEqual({ isActive: true, postedDateOnly: true });
    expect(await job(2)).toEqual({ isActive: true, postedDateOnly: false });
    expect(await job(3)).toBeUndefined();
  });

  it('runs the scraper in feed-only mode without any of the API’s secrets', async () => {
    const { argv, env } = JSON.parse(await readFile(join(dir, 'data', 'env.json'), 'utf8')) as {
      argv: string[];
      env: string[];
    };
    expect(argv).toContain('--feed-only');
    for (const secret of ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'INGEST_API_KEY']) {
      expect(env).not.toContain(secret);
    }
  });

  it('waits for the interval before syncing again', () => {
    expect(sync()).toBeNull();
  });

  it('closes jobs that are no longer listed once the interval has passed', async () => {
    await backdate('7 hours');
    await plan({ jobs: [feedJob(1), feedJob(4)] });
    expect(sync()).toMatchObject({ status: 'SUCCEEDED', imported: 2, deactivated: 1 });
    expect((await job(2)).isActive).toBe(false);
    expect((await job(1)).isActive).toBe(true);
    // A job that now has a time of day is no longer date-only.
    expect((await job(1)).postedDateOnly).toBe(false);
  });

  it('closes nothing when the feed looks truncated', async () => {
    await backdate('7 hours');
    await plan({ jobs: [] });
    expect(sync()).toMatchObject({ status: 'SUCCEEDED', imported: 0, deactivated: 0 });
    expect((await job(1)).isActive).toBe(true);
    expect((await job(4)).isActive).toBe(true);
  });

  it('records a failed scrape and retries after a short wait instead of the full interval', async () => {
    await backdate('7 hours');
    await plan({ fail: 'board unreachable' });
    const failed = sync();
    expect(failed).toMatchObject({ status: 'FAILED' });
    expect(failed?.error).toContain('exited with code 2');
    expect(failed?.error).toContain('boom: board unreachable');

    expect(sync()).toBeNull();
    await backdate('31 minutes');
    await plan({ jobs: [feedJob(1), feedJob(4)] });
    expect(sync()).toMatchObject({ status: 'SUCCEEDED' });
  });

  it('never runs two syncs at once, and recovers a run left behind by a crashed worker', async () => {
    await backdate('7 hours');
    await db.query(
      `INSERT INTO job_sync_runs (id, status, "startedAt")
       VALUES (gen_random_uuid(), 'RUNNING', now() AT TIME ZONE 'UTC')`,
    );
    expect(sync()).toBeNull();

    await db.query(
      `UPDATE job_sync_runs SET "startedAt" = "startedAt" - interval '5 hours' WHERE status = 'RUNNING'`,
    );
    expect(sync()).toMatchObject({ status: 'SUCCEEDED' });
    const { rows } = await db.query<{ status: string; error: string }>(
      `SELECT status, error FROM job_sync_runs WHERE error LIKE 'Interrupted%'`,
    );
    expect(rows).toEqual([
      { status: 'FAILED', error: 'Interrupted: the worker stopped during this run' },
    ]);
  });
});
