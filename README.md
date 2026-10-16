# joddy-api

Backend for **Joddy**: job feed (scraped from ATS boards), application tracker, resume builder and the auto-apply agent.

NestJS 12 · Prisma 7 (Postgres, `pg` driver adapter) · cookie-based JWT auth · Pino logs · OpenAPI docs.

## Getting started

Requirements: Node 22+, Postgres 14+ (or Docker).

```bash
cp .env.example .env          # then set DATABASE_URL and the secrets
npm install                   # also generates the Prisma client
npm run db:deploy             # apply migrations
npm run db:seed               # optional demo account: demo@joddy.app / joddy-demo-2026
npm run start:dev             # http://localhost:4000/api/v1, docs at /docs
```

Import jobs produced by the `job-scraper` project:

```bash
npm run jobs:import -- ~/job-scraper/data/jobs.jsonl
```

The import upserts in batches of 500 through `POST /jobs/ingest` (protected by `INGEST_API_KEY`) and then marks jobs that are no longer listed as inactive. Pass `--keep-stale` to skip that step, or `--limit N` for a partial import.

Ingest derives each job's seniority, job type and remote scope (countries and regions such as EMEA or Worldwide) from its title, employment type and locations. After changing the location parser in `src/modules/jobs/geo`, re-derive the scope of existing jobs with:

```bash
npm run jobs:backfill-geo
```

## Scripts

| Script                          | What it does                                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `start:dev`                     | Compile in watch mode and restart on change                                                    |
| `build` / `start`               | Production build to `dist/` and run it                                                         |
| `test`                          | Unit tests                                                                                     |
| `test:e2e`                      | Builds the API, starts it against `joddy_test` (or `TEST_DATABASE_URL`) and tests it over HTTP |
| `lint` / `typecheck` / `format` | Code quality                                                                                   |
| `db:migrate`                    | Create a migration from schema changes (dev)                                                   |
| `db:deploy`                     | Apply migrations (CI / prod)                                                                   |

## Docker

```bash
docker compose up --build     # Postgres on :5433, migrations, API on :4000
```

The image is multi-stage: the `migrate` target runs `prisma migrate deploy` as a one-off job and the `runtime` target only contains compiled code and production dependencies, runs as the `node` user and has a health check.

## Architecture

```
src/
  config/           env validation (zod); the app refuses to boot with bad config
  prisma/           PrismaService (global)
  common/           guards, decorators, exception filter, pagination
  modules/
    auth/           register, login, refresh rotation, logout
    users/          profile, password, account deletion
    jobs/           search, skill matching, saved jobs, ingest
    applications/   tracker CRUD + stats
    resumes/        resume documents (JSON content + template)
    agent/          auto-apply settings, matching runs, task queue
    dashboard/      aggregated home-page data
    health/         liveness / readiness probes
```

All routes are under `/api/v1` and require auth unless marked otherwise:

- `@Public()` routes ignore auth entirely.
- `@OptionalAuth()` routes are open to guests but personalised for signed-in users. Job search, facets and job details use it. Guests get no hidden jobs, saved state or match scores. A token that is present but invalid still gets a 401, so the client refreshes instead of quietly getting guest data.

### Auth

- The access token (JWT, 15 min) is set in the `joddy_at` httpOnly cookie. `Authorization: Bearer` also works for non-browser clients. The cookie lives as long as the refresh token, so an expired session is still recognised on `@OptionalAuth()` routes.
- The refresh token is an opaque random value in `joddy_rt`, scoped to `/api/v1/auth`. Only its SHA-256 hash is stored.
- Refresh tokens rotate on every use. Replaying a rotated token (outside a 30s grace window for concurrent tabs) revokes all of the user's sessions.
- Changing your password signs out every device. Deleting your account requires your password.

### Job search

Search uses `pg_trgm` GIN indexes on title, company and location, so `ILIKE` stays fast across ~250k jobs. Skill-match scores are computed per page from the user's profile skills (`modules/jobs/matching.ts`).

### Auto-apply agent

`POST /agent/run` scans the newest matching jobs and scores them against the user's skills (or their chosen resume). It queues the best ones up to the daily limit, either for review or straight into the queue depending on the mode. Submitting applications to ATS forms is not automated yet: the user opens each queued job, applies, and marks it as applied, which also records it in the tracker.

## Configuration

See `.env.example`. Required in every environment: `DATABASE_URL`, `JWT_ACCESS_SECRET` (32+ chars), `INGEST_API_KEY` (24+ chars) and `CORS_ORIGINS` (the frontend origin). Set `COOKIE_DOMAIN` when the API and frontend are on different subdomains of the same site.
