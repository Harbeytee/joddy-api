import type { AppConfigService } from '../../config/app-config.service';
import type { PrismaService } from '../../prisma/prisma.service';
import { AiQuotaError } from './ai-errors';
import { AiQuotaService, pacificDay } from './ai-quota.service';

// Unit tests can't load Nest's ES modules or the Prisma client.
jest.mock('@nestjs/common', () => ({
  Injectable: () => () => undefined,
  Logger: class {
    warn() {}
  },
}));
jest.mock('../../config/app-config.service', () => ({ AppConfigService: class {} }));
jest.mock('../../prisma/prisma.service', () => ({ PrismaService: class {} }));

/** A fake ai_usage table: the upsert adds one while under the limit, like the real query. */
function setup(limits = { AI_DAILY_LIMIT: 3, AI_USER_DAILY_LIMIT: 2 }) {
  const counts = new Map<string, number>();
  const deleteMany = jest.fn(() => Promise.resolve({ count: 0 }));
  const prisma = {
    aiUsage: { deleteMany },
    $transaction: async (fn: (tx: unknown) => Promise<void>) => {
      const pending = new Map(counts);
      const tx = {
        $queryRaw: (_sql: TemplateStringsArray, day: string, scope: string, limit: number) => {
          const key = `${day}|${scope}`;
          const count = pending.get(key) ?? 0;
          if (count >= limit) return Promise.resolve([]);
          pending.set(key, count + 1);
          return Promise.resolve([{ count: count + 1 }]);
        },
      };
      await fn(tx);
      pending.forEach((v, k) => counts.set(k, v));
    },
  } as unknown as PrismaService;
  const config = { get: (k: keyof typeof limits) => limits[k] } as unknown as AppConfigService;
  return { quota: new AiQuotaService(prisma, config), counts, deleteMany };
}

describe('pacificDay', () => {
  it("uses the date in California, where Google's daily quota resets", () => {
    expect(pacificDay(new Date('2026-10-18T06:59:00Z'))).toBe('2026-10-17');
    expect(pacificDay(new Date('2026-10-18T07:00:00Z'))).toBe('2026-10-18');
    expect(pacificDay(new Date('2026-01-15T07:59:00Z'))).toBe('2026-01-14');
  });
});

describe('AiQuotaService', () => {
  const now = new Date('2026-10-18T12:00:00Z');

  it('stops a user at their daily limit without using up the app-wide count', async () => {
    const { quota, counts } = setup();
    await quota.consume('a', now);
    await quota.consume('a', now);
    await expect(quota.consume('a', now)).rejects.toEqual(new AiQuotaError('user'));
    expect(counts.get('2026-10-18|a')).toBe(2);
    expect(counts.get('2026-10-18|all')).toBe(2);
  });

  it("stops everyone at the app's limit, and doesn't count the refused call for the user", async () => {
    const { quota, counts } = setup();
    await quota.consume('a', now);
    await quota.consume('b', now);
    await quota.consume('c', now);
    const error = await quota.consume('d', now).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiQuotaError);
    expect((error as AiQuotaError).scope).toBe('all');
    expect(counts.has('2026-10-18|d')).toBe(false);
  });

  it('starts again the next day and prunes old counts once a day', async () => {
    const { quota, deleteMany } = setup();
    await quota.consume('a', now);
    await quota.consume('a', now);
    await expect(quota.consume('a', new Date('2026-10-19T12:00:00Z'))).resolves.toBeUndefined();
    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(deleteMany).toHaveBeenLastCalledWith({
      where: { day: { lt: new Date('2026-10-12T00:00:00Z') } },
    });
  });
});
