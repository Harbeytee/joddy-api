import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from 'pg';
import { BASE_URL, TEST_DATABASE_URL, TEST_ENV } from './setup-env';

declare global {
  var __JODDY_API__: ChildProcess | undefined;
}

/**
 * Black-box e2e: migrate and empty the test database, build the API and run the real
 * `dist/main.js` against it. (NestJS ships ESM-only, which Jest can't load in-process on Node 22.)
 */
export default async function globalSetup() {
  const env = { ...process.env, ...TEST_ENV };

  execSync('npx prisma migrate deploy', { stdio: 'ignore', env });
  await truncateAll();
  execSync('npm run build', { stdio: 'ignore', env });

  const child = spawn(process.execPath, ['dist/main.js'], {
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  globalThis.__JODDY_API__ = child;

  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null)
      throw new Error(`API exited during startup with code ${child.exitCode}`);
    try {
      if ((await fetch(`${BASE_URL}/api/v1/health/ready`)).ok) return;
    } catch {
      // not listening yet
    }
    await sleep(100);
  }
  child.kill();
  throw new Error('API did not become ready within 10s');
}

async function truncateAll() {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length) {
      await client.query(
        `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
      );
    }
  } finally {
    await client.end();
  }
}
