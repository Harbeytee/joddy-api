import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma driver adapter whose sessions run in UTC. Columns are `timestamp` without a zone and hold
 * UTC; a server or database configured for another zone would otherwise store SQL `now()` and
 * `timestamptz` casts in that zone's local time.
 */
export const prismaAdapter = (connectionString: string | undefined) =>
  new PrismaPg({ connectionString, options: '-c TimeZone=UTC' });
