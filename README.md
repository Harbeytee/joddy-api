# Joddy — API

**Joddy** is an all-in-one job search app: find jobs straight from company career pages, track every application, build resumes with AI help, and let an agent apply for you. This repo is the backend that powers it. The web app lives in [joddy-fe](https://github.com/Harbeytee/joddy-fe).

![Joddy dashboard](https://github.com/Harbeytee/joddy-fe/raw/main/docs/screenshots/dashboard.png)

## What it does

- **Job feed.** Stores and searches hundreds of thousands of jobs scraped from company career pages (Greenhouse, Lever, Ashby, Workable and more).
  - Search is fast fuzzy matching on title, company and location.
  - Filters cover remote scope, job type, seniority, salary and posting date.
  - Each job gets a skill-match score for the signed-in user.
  - Jobs are re-imported on a schedule, and roles that disappear are closed.
- **Ask AI search.** Turns "remote React jobs in Europe paying over £70k" into normal search filters using Google Gemini.
- **Application tracker.** Records each application and its status, with stats for the dashboard.
- **Resume builder.** Stores resumes as structured content with 24 templates and design settings. Gemini suggests better wording without inventing anything.
- **Auto-apply agent.** A background worker:
  - finds jobs that match each user;
  - fills in Greenhouse, Lever and Ashby application forms in a headless browser, using the user's details and CV;
  - hands anything it can't answer with certainty back to the user.
- **Accounts.** Cookie-based sessions with rotating refresh tokens, password changes and account deletion.

**Built with:**
- NestJS 12 and TypeScript
- Postgres with Prisma 7
- Playwright, for the form-filling robot
- Google Gemini, for the AI features
- Pino logs and OpenAPI docs
- Docker

## Getting started

### Quickest: Docker

```bash
git clone https://github.com/Harbeytee/joddy-api.git
cd joddy-api
docker compose up --build     # Postgres on :5433, migrations, API on :4000, worker
```

### Local development

Requirements: **Node 22+** and **Postgres 14+**.

```bash
git clone https://github.com/Harbeytee/joddy-api.git
cd joddy-api
cp .env.example .env          # then set DATABASE_URL and replace the example secrets
npm install                   # also generates the Prisma client
npm run db:deploy             # apply migrations
npm run db:seed               # optional demo account: demo@joddy.app / joddy-demo-2026
npm run start:dev             # http://localhost:4000/api/v1, interactive docs at /docs
npm run start:worker          # optional, in another terminal: auto-apply and scheduled job imports
```

Then start [joddy-fe](https://github.com/Harbeytee/joddy-fe) and open http://localhost:3000.

To turn on the AI features, put a free [Google AI Studio](https://aistudio.google.com/apikey) key in `GEMINI_API_KEY`. Without one, the app simply hides them.

## Getting jobs into the database

Jobs come from a separate scraper that writes one JSON job per line. Import a file of them with:

```bash
npm run jobs:import -- ~/job-scraper/data/jobs.jsonl
```

The import upserts in batches of 500 through `POST /jobs/ingest` (protected by `INGEST_API_KEY`) and then marks jobs that are no longer listed as inactive. Pass `--keep-stale` to skip that step, or `--limit N` for a partial import.

### Keeping jobs fresh

Set `JOB_SYNC_SCRAPER_DIR` to a `job-scraper` checkout and the worker (`npm run start:worker`) scrapes and imports on its own every `JOB_SYNC_EVERY_HOURS` (default 6):

- The scraper runs as a child process (`src/scrape.js --feed-only`) with a minimal environment, so it never sees the API's secrets. It is stopped after `JOB_SYNC_TIMEOUT_MINUTES` (default 240).
- Each run is recorded in `job_sync_runs` with its counts or error. A failed run is retried after 30 minutes rather than waiting for the full interval.
- Only one sync runs at a time, even with several workers (Postgres advisory lock plus the `RUNNING` row). A run left behind by a crashed worker is marked `FAILED` once it is older than the timeout.
- Jobs missing from the feed are closed only if the feed holds at least half as many jobs as were active before, so a scrape that broke halfway can't empty the board.

Leave `JOB_SYNC_SCRAPER_DIR` unset to turn this off and import by hand. Some boards (BambooHR, Workable) only publish a date, not a time. Those jobs get `postedDateOnly`, so the app shows "Today" rather than a made-up number of hours.

Ingest derives each job's seniority, job type and remote scope (countries and regions such as EMEA or Worldwide) from its title, employment type and locations. After changing the location parser in `src/modules/jobs/geo`, re-derive the scope of existing jobs with:

```bash
npm run jobs:backfill-geo
```

## Scripts

| Script                          | What it does                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `start:dev`                     | Compile in watch mode and restart on change                                                               |
| `build` / `start`               | Production build to `dist/` and run it                                                                    |
| `start:worker`                  | Run the worker from `dist/`: apply robot (needs Chromium: `npx playwright install chromium`) and job sync |
| `robot:dry-run`                 | Fill real Greenhouse / Lever / Ashby forms with a sample applicant, without submitting                    |
| `test`                          | Unit tests                                                                                                |
| `test:e2e`                      | Builds the API, starts it against `joddy_test` (or `TEST_DATABASE_URL`) and tests it over HTTP            |
| `lint` / `typecheck` / `format` | Code quality                                                                                              |
| `db:migrate`                    | Create a migration from schema changes (dev)                                                              |
| `db:deploy`                     | Apply migrations (CI / prod)                                                                              |

## Docker

```bash
docker compose up --build     # Postgres on :5433, migrations, API on :4000, apply worker
```

The image is multi-stage: the `migrate` target runs `prisma migrate deploy` as a one-off job and the `runtime` target only contains compiled code and production dependencies, runs as the `node` user and has a health check. The `worker` target adds Chromium and runs the apply worker.

## Architecture

```
src/
  config/           env validation (zod); the app refuses to boot with bad config
  prisma/           PrismaService (global)
  common/           guards, decorators, exception filter, pagination
  modules/
    auth/           register, login, refresh rotation, logout
    users/          profile, password, account deletion
    jobs/           search, skill matching, saved jobs, ingest, AI search (ai/)
    job-sync/       scheduled scrape + import (runs in the worker)
    applications/   tracker CRUD + stats
    resumes/        resume documents (JSON content + template), AI wording suggestions (ai/)
    ai/             Gemini client, answer cache and GET /ai/status, shared by jobs and resumes
    agent/          auto-apply settings, matching runs, task queue, applicant profile,
                    apply worker and the Greenhouse / Lever / Ashby form robot (robot/)
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

Search uses `pg_trgm` GIN indexes on title, company and location, so `ILIKE` stays fast across ~250k jobs. Skill-match scores are computed per page from the user's profile skills (`modules/jobs/matching.ts`). `title` takes up to 10 comma-separated phrases and matches jobs whose title contains any of them.

### AI features

Both AI features use Google Gemini. Turn them on with a free key from [Google AI Studio](https://aistudio.google.com/apikey) in `GEMINI_API_KEY`. `GEMINI_MODEL` defaults to `gemini-3.5-flash-lite`, which is on the free tier. `GET /ai/status` returns `{ enabled }`, and without a key the app hides every AI control. The key is only sent in the `x-goog-api-key` header. Gemini answers against a JSON schema and every answer is checked again on our side. Answers are cached in memory per API instance, so repeating a request doesn't use the free quota twice. If Gemini's quota runs out, users are told to try again shortly.

Both features need an account, and every Gemini call counts against two daily limits kept in Postgres (`ai_usage`), so they hold across API instances: `AI_USER_DAILY_LIMIT` per user (default 50) and `AI_DAILY_LIMIT` for the whole app (default 1000, under the free tier). Days start at midnight Pacific time, when Google resets the free quota. Cached answers don't count. A user over their limit gets a 429 and everyone gets a 503 once the app's limit is reached, both with a message saying to try again tomorrow.

**Ask AI job search.** Users can describe the job they want ("remote React jobs in Europe paying over £80k") instead of setting filters. `POST /jobs/ai-search` turns the prompt into the same filters the normal search uses (title phrases, keyword, location, workplace, job type, seniority, posting date, salary). The app then runs a normal `GET /jobs` with them, so paging, facets and match scores work as usual, and "Refine with filters" hands them to the filter drawer.

- Only known countries and enums, capped lists and sane salaries are kept, so a bad answer can only produce a narrower or wider search.
- Answers are cached for 6 hours per prompt, day and home country. The endpoint is for signed-in users and allows 10 requests a minute. Prompts that aren't job searches get a 422.

**Resume wording suggestions.** "Improve with AI" under the summary, job and project highlights, education details and custom section descriptions. `POST /resumes/ai/refine` (signed-in users, 15 a minute) takes the field, the text and some context (job title, role, company) and returns up to two rewrites: `polished` and `concise`. Nothing is saved: the user picks one or keeps their own, and can undo.

- The prompt forbids inventing employers, tools, numbers or results, or making a vague point more specific, and treats the user's text as data rather than instructions.
- Suggestions are tidied (no bullet characters or markdown, one bullet per line), cut at a line or sentence boundary to fit the field's limit (`maxLength`), and dropped if they match the original. If nothing is left, or the text isn't resume content, the API returns a 422.

### Resume content

Besides the built-in sections, a resume can have up to 10 custom sections (`content.custom`), each with its own title and up to 30 entries (title, organisation, date, link, description). They take part in `design.sectionOrder` as `custom:<id>`. Project and custom-section links can have a `urlLabel` (e.g. "GitHub") that is shown in place of the address, which stays the link target in the PDF and Word file.

### Auto-apply agent

A search scans the newest matching jobs and scores them against the user's skills (or their chosen resume), keeping the best ones up to the daily limit. The worker searches on its own for every user who has auto-apply on, every `AUTO_APPLY_MATCH_EVERY_MINUTES` (default 60); `POST /agent/run` ("Find jobs now") searches straight away. `lastRunAt` on the settings records the latest search either way. New jobs only appear as often as the scraper import runs. What happens to matches depends on the mode:

- **AUTO**: Joddy applies to every match. Tasks go straight to `QUEUED`.
- **REVIEW**: the user picks which matches Joddy applies to. Tasks wait in `NEEDS_REVIEW` until approved (`POST /agent/tasks/:id/approve`), which queues them.

The **worker** (`npm run start:worker`, a separate process with no HTTP server) runs the scheduled searches and takes `QUEUED` tasks one at a time, opens the job's form in headless Chromium and fills it in from the user's applicant profile (`GET/PUT /agent/profile`, CV via `PUT /agent/profile/cv`). It only picks up tasks for users who turned the agent on, uploaded a CV, filled in their name and phone, and gave consent. Several workers can run at once; each claims a task with `FOR UPDATE SKIP LOCKED`, and tasks left mid-way by a crashed worker are picked up again after 15 minutes (three tries at most).

Form fillers exist for **Greenhouse**, **Lever** and **Ashby** (`modules/agent/robot/`). Jobs on other sites, and anything the robot can't finish safely, go back to the user as `FAILED` ("Needs you" in the app) with a reason in `error`:

| `error`            | Meaning                                                                         |
| ------------------ | ------------------------------------------------------------------------------- |
| `missing-answers`  | Required questions Joddy couldn't answer with certainty, listed in `missing`    |
| `captcha`          | The site showed a CAPTCHA challenge. Joddy never tries to solve them            |
| `unsupported-site` | No form filler for this site yet                                                |
| `form-rejected`    | The form wouldn't accept the CV or the submission                               |
| `job-closed`       | The posting is gone                                                             |
| `dry-run`          | The form was filled but not submitted, because `AUTO_APPLY_SUBMIT` isn't `true` |
| `error`            | Something went wrong three times in a row                                       |

The robot never guesses. Work-eligibility questions are only answered for countries named in the question, voluntary demographic questions are declined, and marketing opt-ins are left unticked. Everything else needs a saved answer: when the user answers the questions on a "Needs you" task (`POST /agent/tasks/:id/answers`), the answers are saved to their profile, reused on later forms with the same question, and the task is queued again. `POST /agent/tasks/:id/retry` re-queues without new answers, and `mark-applied` records a job the user applied to themselves.

To try the robot against live forms without submitting anything:

```bash
npm run robot:dry-run -- --source lever --count 3 [--answers answers.json]
```

## Configuration

See `.env.example`. Required in every environment: `DATABASE_URL`, `JWT_ACCESS_SECRET` (32+ chars), `INGEST_API_KEY` (24+ chars) and `CORS_ORIGINS` (the frontend origin). Set `COOKIE_DOMAIN` when the API and frontend are on different subdomains of the same site. The apply worker submits applications only when `AUTO_APPLY_SUBMIT=true`. Set `GEMINI_API_KEY` to turn on the AI features, and `AI_DAILY_LIMIT` / `AI_USER_DAILY_LIMIT` to change their daily limits.

**Before deploying**, replace the example secrets: generate `JWT_ACCESS_SECRET` and `INGEST_API_KEY` with `openssl rand -base64 48`.

## Security

- **Access.** Every route needs a signed-in user unless it's explicitly public: job browsing, sign-up and sign-in, AI status and health checks. Users only ever see their own data. Job import needs the secret ingest key.
- **Sessions.**
  - Access and refresh tokens live in httpOnly cookies, `Secure` and `SameSite=Lax` in production.
  - Refresh tokens rotate on every use, and only their hashes are stored.
  - Passwords are hashed with argon2.
- **Rate limits.** Each client gets 120 requests a minute, with tighter limits on sign-in and the AI endpoints. AI use also has the daily limits described above.
- **Request size.** Request bodies are limited to 1 MB, except job imports (`/jobs/ingest`, 25 MB) and resumes (5 MB); larger ones get a 413.
- **Input.** Every request body is validated, and unknown fields are rejected.
- **Headers.** `helmet` sets the security headers, CORS allows only `CORS_ORIGINS`, and the Swagger docs are off in production.
- **Proxy.** The API trusts one proxy hop for client IPs (`trust proxy` = 1). Run it behind a reverse proxy or load balancer, not directly exposed to the internet.

## Testing

```bash
npm test            # unit tests
npm run test:e2e    # builds the API and tests it over HTTP against a separate joddy_test database
npm run lint && npm run typecheck
```

The e2e suite creates and migrates `joddy_test` on the Postgres from `DATABASE_URL` (or `TEST_DATABASE_URL`). It never calls Gemini.
