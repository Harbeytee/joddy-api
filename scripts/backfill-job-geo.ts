/**
 * Fills jobs.countries / jobs.regions from the location strings for rows ingested before
 * those columns existed. Safe to re-run; ingest keeps them current afterwards.
 *
 *   npm run jobs:backfill-geo
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { prismaAdapter } from '../src/prisma/adapter';
import { locationScope } from '../src/modules/jobs/geo/location-scope';

const BATCH = 2000;

async function main() {
  const prisma = new PrismaClient({
    adapter: prismaAdapter(process.env.DATABASE_URL),
  });
  const started = Date.now();
  let cursor: string | undefined;
  let done = 0;

  try {
    for (;;) {
      const jobs = await prisma.job.findMany({
        select: { id: true, location: true, locations: true },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!jobs.length) break;

      const rows = jobs.map((j) => ({ id: j.id, ...locationScope([j.location, ...j.locations]) }));
      await prisma.$executeRaw`
        UPDATE jobs SET countries = r.countries, regions = r.regions::"Region"[]
        FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(id uuid, countries text[], regions text[])
        WHERE jobs.id = r.id
      `;

      done += jobs.length;
      cursor = jobs.at(-1)!.id;
      process.stdout.write(`\rUpdated ${done.toLocaleString()} jobs`);
    }
    console.log(`\nDone in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
