import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  CORS_ORIGINS: csv,
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_DOMAIN: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  INGEST_API_KEY: z.string().min(24),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** The apply worker only clicks "Submit" when this is "true"; otherwise it fills forms and stops. */
  AUTO_APPLY_SUBMIT: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  AUTO_APPLY_POLL_MS: z.coerce.number().int().min(1000).default(15_000),
  /** How often the worker looks for new matches for each user who has auto-apply on. */
  AUTO_APPLY_MATCH_EVERY_MINUTES: z.coerce.number().int().min(5).default(60),
  /** Where the worker saves a screenshot of each form it fills; unset to keep none. */
  AUTO_APPLY_ARTIFACTS_DIR: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  /** Checkout of the job-scraper project. The worker scrapes and imports jobs on a schedule; unset to turn that off. */
  JOB_SYNC_SCRAPER_DIR: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  JOB_SYNC_EVERY_HOURS: z.coerce.number().positive().default(6),
  /** A scrape still running after this long is stopped and recorded as failed. */
  JOB_SYNC_TIMEOUT_MINUTES: z.coerce.number().int().min(5).default(240),
  /** Heap for the scraper process: it holds every known job in memory while it runs. */
  JOB_SYNC_SCRAPER_MEMORY_MB: z.coerce.number().int().min(512).default(6144),
  /** Google AI Studio key for the AI features (job search, resume suggestions); unset to turn them off. */
  GEMINI_API_KEY: z
    .string()
    .optional()
    .transform((v) => v || undefined),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  /** Gemini calls allowed per day across the whole app, kept under Google's free quota. Resets at midnight Pacific. */
  AI_DAILY_LIMIT: z.coerce.number().int().min(1).default(1000),
  /** Gemini calls allowed per user per day, so one account can't use up everyone's share. */
  AI_USER_DAILY_LIMIT: z.coerce.number().int().min(1).default(50),
});

export type Env = z.infer<typeof envSchema>;

/** Used by ConfigModule so the app refuses to boot with missing or invalid configuration. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
