import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AiQuotaError } from './ai-errors';

const ALL = 'all';
const KEEP_DAYS = 7;
const DAY_MS = 24 * 60 * 60_000;

/** The date in Pacific time (YYYY-MM-DD): Google resets the free Gemini quota at midnight there. */
export function pacificDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(now);
}

/**
 * Daily caps on Gemini calls, per user and for the whole app, counted in Postgres so every API
 * instance shares them. Each call is counted when it's made, whether or not Gemini then succeeds.
 */
@Injectable()
export class AiQuotaService {
  private readonly logger = new Logger(AiQuotaService.name);
  private prunedDay = '';

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /** Counts one call for `userId`, or throws AiQuotaError (and counts nothing) if a cap is reached. */
  async consume(userId: string, now = new Date()): Promise<void> {
    const day = pacificDay(now);
    await this.prisma.$transaction(async (tx) => {
      const add = async (scope: string, limit: number) => {
        // Only adds while under the limit, so concurrent calls can't go past it.
        const rows = await tx.$queryRaw<{ count: number }[]>`
          INSERT INTO "ai_usage" ("day", "scope", "count") VALUES (${day}::date, ${scope}, 1)
          ON CONFLICT ("day", "scope") DO UPDATE SET "count" = "ai_usage"."count" + 1
          WHERE "ai_usage"."count" < ${limit}
          RETURNING "count"`;
        return rows.length > 0;
      };
      if (!(await add(userId, this.config.get('AI_USER_DAILY_LIMIT')))) {
        throw new AiQuotaError('user');
      }
      if (!(await add(ALL, this.config.get('AI_DAILY_LIMIT')))) throw new AiQuotaError('all');
    });
    this.prune(day, now);
  }

  /** Once a day, drops counts older than KEEP_DAYS. */
  private prune(day: string, now: Date): void {
    if (this.prunedDay === day) return;
    this.prunedDay = day;
    const before = pacificDay(new Date(now.getTime() - KEEP_DAYS * DAY_MS));
    this.prisma.aiUsage
      .deleteMany({ where: { day: { lt: new Date(`${before}T00:00:00Z`) } } })
      .catch((err: unknown) => this.logger.warn(`Couldn't prune old AI usage: ${String(err)}`));
  }
}
