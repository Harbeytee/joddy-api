import { createHash } from 'node:crypto';
import { Client } from 'pg';
import request from 'supertest';
import { BASE_URL, TEST_DATABASE_URL, TEST_ENV } from './setup-env';

const API = '/api/v1';
const INGEST_KEY = TEST_ENV.INGEST_API_KEY;
const http = request(BASE_URL);

/** Collapses Set-Cookie headers into a name -> value map (empty value = cleared). */
function cookiesOf(res: request.Response): Record<string, string> {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return Object.fromEntries(
    (raw ?? []).map((c) => {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      return [pair.slice(0, i), decodeURIComponent(pair.slice(i + 1))];
    }),
  );
}

const sampleJob = (id: string, overrides: Record<string, unknown> = {}) => ({
  id: `lever:acme:${id}`,
  source: 'lever',
  company: 'acme',
  companyName: 'Acme',
  title: 'Frontend Engineer',
  location: 'London, UK',
  locations: ['London, UK'],
  workplaceType: 'hybrid',
  salary: { min: 60000, max: 75000.5, currency: 'GBP', interval: 'year', source: 'structured' },
  postedAt: new Date().toISOString(),
  url: `https://jobs.lever.co/acme/${id}`,
  applyUrl: `https://jobs.lever.co/acme/${id}/apply`,
  description: 'We build with TypeScript and Vue.',
  ...overrides,
});

describe('Joddy API (e2e)', () => {
  const db = new Client({ connectionString: TEST_DATABASE_URL });

  const user = {
    name: 'Test User',
    email: `e2e-${Date.now()}@joddy.test`,
    password: 'correct-horse-battery',
  };
  let access = '';
  let refresh = '';
  const credentials = { email: user.email, password: user.password };
  const auth = () => `joddy_at=${access}`;

  beforeAll(() => db.connect());
  afterAll(() => db.end());

  describe('health', () => {
    it('reports liveness and database readiness', async () => {
      await http.get(`${API}/health/live`).expect(200);
      const res = await http.get(`${API}/health/ready`).expect(200);
      expect(res.body).toEqual({ status: 'ok', database: 'up' });
    });
  });

  describe('auth', () => {
    it('rejects unauthenticated requests', async () => {
      await http.get(`${API}/auth/me`).expect(401);
      await http.get(`${API}/jobs`).expect(401);
    });

    it('validates registration input', async () => {
      const res = await http
        .post(`${API}/auth/register`)
        .send({ email: 'nope', password: 'short' })
        .expect(400);
      expect(res.body.message).toEqual(expect.arrayContaining([expect.stringMatching(/email/)]));
    });

    it('registers a user and sets httpOnly session cookies', async () => {
      const res = await http.post(`${API}/auth/register`).send(user).expect(201);
      expect(res.body).toMatchObject({ email: user.email, name: user.name, skills: [] });
      expect(res.body).not.toHaveProperty('passwordHash');

      const raw = (res.headers['set-cookie'] as unknown as string[]).join('\n');
      expect(raw).toMatch(/joddy_at=.+; Path=\/; .*HttpOnly/);
      expect(raw).toMatch(/joddy_rt=.+; Path=\/api\/v1\/auth; .*HttpOnly/);
      ({ joddy_at: access, joddy_rt: refresh } = cookiesOf(res));
    });

    it('refuses duplicate emails', async () => {
      await http.post(`${API}/auth/register`).send(user).expect(409);
    });

    it('rejects a wrong password without revealing whether the email exists', async () => {
      const wrong = await http
        .post(`${API}/auth/login`)
        .send({ email: user.email, password: 'wrong-password' })
        .expect(401);
      const missing = await http
        .post(`${API}/auth/login`)
        .send({ email: 'nobody@joddy.test', password: 'wrong-password' })
        .expect(401);
      expect(wrong.body.message).toBe(missing.body.message);
    });

    it('logs in and returns the current user', async () => {
      const res = await http.post(`${API}/auth/login`).send(credentials).expect(200);
      ({ joddy_at: access, joddy_rt: refresh } = cookiesOf(res));
      const me = await http.get(`${API}/auth/me`).set('Cookie', auth()).expect(200);
      expect(me.body.email).toBe(user.email);
    });

    it('also accepts a Bearer access token', async () => {
      await http.get(`${API}/auth/me`).set('Authorization', `Bearer ${access}`).expect(200);
    });

    it('rotates the refresh token', async () => {
      const res = await http
        .post(`${API}/auth/refresh`)
        .set('Cookie', `joddy_rt=${refresh}`)
        .expect(200);
      const next = cookiesOf(res);
      expect(next.joddy_rt).toBeTruthy();
      expect(next.joddy_rt).not.toBe(refresh);

      // Reusing the old token right away (e.g. two tabs) fails but doesn't sign the user out.
      await http.post(`${API}/auth/refresh`).set('Cookie', `joddy_rt=${refresh}`).expect(401);
      refresh = next.joddy_rt;
      access = next.joddy_at;
      await http
        .post(`${API}/auth/refresh`)
        .set('Cookie', `joddy_rt=${refresh}`)
        .expect(200)
        .then((r) => {
          ({ joddy_at: access, joddy_rt: refresh } = cookiesOf(r));
        });
    });

    it('revokes every session when a rotated token is reused later', async () => {
      const victim = await http.post(`${API}/auth/login`).send(credentials).expect(200);
      const stolen = cookiesOf(victim).joddy_rt;
      const rotated = await http
        .post(`${API}/auth/refresh`)
        .set('Cookie', `joddy_rt=${stolen}`)
        .expect(200);

      // Move the rotation outside the concurrent-refresh grace window, as if replayed later.
      await db.query(
        `UPDATE sessions SET "revokedAt" = (now() AT TIME ZONE 'utc') - interval '5 minutes' WHERE "tokenHash" = $1`,
        [createHash('sha256').update(stolen).digest('hex')],
      );
      await http.post(`${API}/auth/refresh`).set('Cookie', `joddy_rt=${stolen}`).expect(401);

      // The legitimately rotated token and the main session were both revoked.
      await http
        .post(`${API}/auth/refresh`)
        .set('Cookie', `joddy_rt=${cookiesOf(rotated).joddy_rt}`)
        .expect(401);
      await http.post(`${API}/auth/refresh`).set('Cookie', `joddy_rt=${refresh}`).expect(401);

      const res = await http.post(`${API}/auth/login`).send(credentials).expect(200);
      ({ joddy_at: access, joddy_rt: refresh } = cookiesOf(res));
    });
  });

  describe('jobs', () => {
    let jobId = '';

    it('protects ingest with the ingest key', async () => {
      await http
        .post(`${API}/jobs/ingest`)
        .send({ jobs: [sampleJob('1')] })
        .expect(401);
      await http
        .post(`${API}/jobs/ingest`)
        .set('x-ingest-key', 'wrong-key-wrong-key-wrong')
        .send({ jobs: [sampleJob('1')] })
        .expect(401);
    });

    it('upserts jobs idempotently', async () => {
      const batch = {
        jobs: [
          sampleJob('1'),
          sampleJob('2', { title: 'Backend Engineer', description: 'Go and AWS' }),
        ],
      };
      await http.post(`${API}/jobs/ingest`).set('x-ingest-key', INGEST_KEY).send(batch).expect(200);
      await http.post(`${API}/jobs/ingest`).set('x-ingest-key', INGEST_KEY).send(batch).expect(200);

      const res = await http.get(`${API}/jobs`).set('Cookie', auth()).expect(200);
      expect(res.body.total).toBe(2);
      expect(res.body.items[0]).not.toHaveProperty('description');
    });

    it('scores matches against profile skills', async () => {
      await http
        .patch(`${API}/users/me`)
        .set('Cookie', auth())
        .send({ skills: ['TypeScript', 'Vue'] })
        .expect(200);
      const res = await http
        .get(`${API}/jobs`)
        .query({ q: 'frontend' })
        .set('Cookie', auth())
        .expect(200);
      expect(res.body.total).toBe(1);
      const [job] = res.body.items;
      expect(job.match).toEqual({ score: 100, matched: ['TypeScript', 'Vue'], missing: [] });
      expect(job.salaryMax).toBe(75001);
      expect(job.snippet).toBe('We build with TypeScript and Vue.');
      expect(job.seniority).toBeNull();
      jobId = job.id;
    });

    it('sorts by posting date', async () => {
      await http
        .post(`${API}/jobs/ingest`)
        .set('x-ingest-key', INGEST_KEY)
        .send({
          jobs: [
            sampleJob('old', { title: 'Senior QA Engineer', postedAt: '2020-01-01T00:00:00Z' }),
          ],
        })
        .expect(200);
      const titles = async (sort?: string) => {
        const res = await http.get(`${API}/jobs`).query({ sort }).set('Cookie', auth()).expect(200);
        return (res.body.items as { title: string }[]).map((j) => j.title);
      };
      expect((await titles()).at(-1)).toBe('Senior QA Engineer');
      expect((await titles('oldest'))[0]).toBe('Senior QA Engineer');
      await http.get(`${API}/jobs`).query({ sort: 'salary' }).set('Cookie', auth()).expect(400);

      const res = await http
        .get(`${API}/jobs`)
        .query({ q: 'QA' })
        .set('Cookie', auth())
        .expect(200);
      expect(res.body.items[0].seniority).toBe('SENIOR');
    });

    it('filters by seniority, treating titles without a level as mid level', async () => {
      const titles = async (query: string) => {
        const res = await http.get(`${API}/jobs?${query}`).set('Cookie', auth()).expect(200);
        return (res.body.items as { title: string }[]).map((j) => j.title).sort();
      };
      expect(await titles('seniority=SENIOR')).toEqual(['Senior QA Engineer']);
      expect(await titles('seniority=MID')).toEqual(['Backend Engineer', 'Frontend Engineer']);
      expect(await titles('seniority=SENIOR&seniority=MID')).toHaveLength(3);
      expect(await titles('seniority=SENIOR,INTERN')).toEqual(['Senior QA Engineer']);
      await http.get(`${API}/jobs?seniority=WIZARD`).set('Cookie', auth()).expect(400);
    });

    it('hides a job from search and saved jobs until it is unhidden', async () => {
      await http.put(`${API}/jobs/${jobId}/save`).set('Cookie', auth()).expect(204);
      await http.put(`${API}/jobs/${jobId}/hide`).set('Cookie', auth()).expect(204);

      const ids = async (path: string) => {
        const res = await http.get(`${API}${path}`).set('Cookie', auth()).expect(200);
        return (res.body.items as { id: string }[]).map((j) => j.id);
      };
      expect(await ids('/jobs')).not.toContain(jobId);
      expect(await ids('/jobs/saved')).not.toContain(jobId);

      await http.delete(`${API}/jobs/${jobId}/hide`).set('Cookie', auth()).expect(204);
      expect(await ids('/jobs')).toContain(jobId);
      await http
        .put(`${API}/jobs/00000000-0000-4000-8000-000000000000/hide`)
        .set('Cookie', auth())
        .expect(404);
    });

    it('saves and unsaves a job', async () => {
      await http.put(`${API}/jobs/${jobId}/save`).set('Cookie', auth()).expect(204);
      const saved = await http.get(`${API}/jobs/saved`).set('Cookie', auth()).expect(200);
      expect((saved.body.items as { id: string }[]).map((j) => j.id)).toEqual([jobId]);
      await http.delete(`${API}/jobs/${jobId}/save`).set('Cookie', auth()).expect(204);
      const after = await http.get(`${API}/jobs/saved`).set('Cookie', auth()).expect(200);
      expect(after.body.total).toBe(0);
    });

    it('returns 404 for unknown jobs and 400 for malformed ids', async () => {
      await http
        .get(`${API}/jobs/00000000-0000-4000-8000-000000000000`)
        .set('Cookie', auth())
        .expect(404);
      await http.get(`${API}/jobs/not-a-uuid`).set('Cookie', auth()).expect(400);
    });

    it('tracks an application from a job', async () => {
      const created = await http
        .post(`${API}/applications`)
        .set('Cookie', auth())
        .send({ jobId })
        .expect(201);
      expect(created.body).toMatchObject({
        role: 'Frontend Engineer',
        company: 'Acme',
        status: 'APPLIED',
        jobId,
      });

      const job = await http.get(`${API}/jobs/${jobId}`).set('Cookie', auth()).expect(200);
      expect(job.body.application).toMatchObject({ status: 'APPLIED' });
    });

    it('filters by workplace, job type and location', async () => {
      const remote = (id: string, overrides: Record<string, unknown>) =>
        sampleJob(id, { workplaceType: 'remote', description: '', locations: [], ...overrides });
      await http
        .post(`${API}/jobs/ingest`)
        .set('x-ingest-key', INGEST_KEY)
        .send({
          jobs: [
            remote('emea', {
              title: 'Account Manager',
              location: 'Remote - EMEA',
              employmentType: 'Full-time',
            }),
            remote('us', {
              title: 'Support Specialist',
              location: 'Remote - USA',
              employmentType: 'Contract',
            }),
            // No workplace type from the ATS: inferred from the location.
            remote('ww', {
              title: 'Community Lead',
              location: 'World Wide - Remote',
              workplaceType: undefined,
              employmentType: 'parttime permanent',
            }),
            sampleJob('lagos', {
              title: 'Field Engineer',
              location: 'Lagos, Nigeria',
              locations: [],
              workplaceType: 'onsite',
              description: '',
            }),
          ],
        })
        .expect(200);

      const titles = async (query: string) => {
        const res = await http.get(`${API}/jobs?${query}`).set('Cookie', auth()).expect(200);
        return (res.body.items as { title: string }[]).map((j) => j.title).sort();
      };
      // A country also matches remote jobs open to a region containing it, and worldwide ones.
      expect(await titles('country=ng')).toEqual([
        'Account Manager',
        'Community Lead',
        'Field Engineer',
      ]);
      expect(await titles('country=US')).toEqual(['Community Lead', 'Support Specialist']);
      expect(await titles('country=US,NG&workplaceType=ONSITE')).toEqual(['Field Engineer']);
      expect(await titles('region=AFRICA&workplaceType=REMOTE')).toEqual([
        'Account Manager',
        'Community Lead',
      ]);
      expect(await titles('region=WORLDWIDE')).toEqual(['Community Lead']);
      expect(await titles('workplaceType=REMOTE,ONSITE&jobType=CONTRACT,PART_TIME')).toEqual([
        'Community Lead',
        'Support Specialist',
      ]);
      for (const bad of ['country=XX', 'region=MARS', 'jobType=GIG', 'workplaceType=SPACE']) {
        await http.get(`${API}/jobs?${bad}`).set('Cookie', auth()).expect(400);
      }

      const list = await http.get(`${API}/jobs?q=account+manager`).set('Cookie', auth());
      expect(list.body.items[0]).toMatchObject({
        jobType: 'FULL_TIME',
        regions: ['EMEA'],
        countries: [],
      });

      const locations = await http.get(`${API}/jobs/locations`).set('Cookie', auth()).expect(200);
      expect(locations.body.regions[0]).toBe('WORLDWIDE');
      expect(locations.body.countries).toEqual(expect.arrayContaining(['NG', 'GB', 'US']));
    });

    it("derives the profile's country for the default location filter", async () => {
      const res = await http
        .patch(`${API}/users/me`)
        .set('Cookie', auth())
        .send({ location: 'Lagos, Nigeria' })
        .expect(200);
      expect(res.body.countryCode).toBe('NG');
      const me = await http.get(`${API}/auth/me`).set('Cookie', auth()).expect(200);
      expect(me.body.countryCode).toBe('NG');
    });
  });

  describe('applications', () => {
    let id = '';

    it('requires role and company when not linked to a job', async () => {
      await http
        .post(`${API}/applications`)
        .set('Cookie', auth())
        .send({ company: 'Monzo' })
        .expect(400);
    });

    it('creates, updates, filters and deletes', async () => {
      const created = await http
        .post(`${API}/applications`)
        .set('Cookie', auth())
        .send({ role: 'Product Engineer', company: 'Monzo', status: 'INTERVIEW' })
        .expect(201);
      id = created.body.id;

      await http
        .patch(`${API}/applications/${id}`)
        .set('Cookie', auth())
        .send({ status: 'OFFER', notes: 'Yay' })
        .expect(200);

      const stats = await http.get(`${API}/applications/stats`).set('Cookie', auth()).expect(200);
      expect(stats.body).toMatchObject({ ALL: 2, APPLIED: 1, OFFER: 1, INTERVIEW: 0 });

      const offers = await http
        .get(`${API}/applications`)
        .query({ status: 'OFFER' })
        .set('Cookie', auth())
        .expect(200);
      expect(offers.body.items).toHaveLength(1);

      await http.delete(`${API}/applications/${id}`).set('Cookie', auth()).expect(204);
      await http.get(`${API}/applications/${id}`).set('Cookie', auth()).expect(404);
    });

    it("doesn't expose other users' applications", async () => {
      const other = await http
        .post(`${API}/auth/register`)
        .send({
          name: 'Other',
          email: `other-${Date.now()}@joddy.test`,
          password: 'another-password',
        })
        .expect(201);
      const otherAccess = cookiesOf(other).joddy_at;
      const mine = await http.get(`${API}/applications`).set('Cookie', auth()).expect(200);
      const target = mine.body.items[0].id as string;

      await http
        .get(`${API}/applications/${target}`)
        .set('Cookie', `joddy_at=${otherAccess}`)
        .expect(404);
      await http
        .delete(`${API}/applications/${target}`)
        .set('Cookie', `joddy_at=${otherAccess}`)
        .expect(404);
    });
  });

  describe('agent', () => {
    it('refuses to run while disabled, then queues matches for review', async () => {
      await http.post(`${API}/agent/run`).set('Cookie', auth()).expect(400);

      await http
        .put(`${API}/agent/settings`)
        .set('Cookie', auth())
        .send({
          enabled: true,
          mode: 'REVIEW',
          keywords: ['engineer'],
          minMatchScore: 50,
          dailyLimit: 5,
        })
        .expect(200);

      // The only matching job already has an application, so nothing new is queued.
      const first = await http.post(`${API}/agent/run`).set('Cookie', auth()).expect(200);
      expect(first.body.queued).toBe(0);

      await http
        .post(`${API}/jobs/ingest`)
        .set('x-ingest-key', INGEST_KEY)
        .send({ jobs: [sampleJob('3', { title: 'Vue Engineer' })] })
        .expect(200);
      const second = await http.post(`${API}/agent/run`).set('Cookie', auth()).expect(200);
      expect(second.body.queued).toBe(1);

      const tasks = await http
        .get(`${API}/agent/tasks`)
        .query({ status: 'NEEDS_REVIEW' })
        .set('Cookie', auth())
        .expect(200);
      const [task] = tasks.body.items;
      expect(task.job.title).toBe('Vue Engineer');

      await http.post(`${API}/agent/tasks/${task.id}/approve`).set('Cookie', auth()).expect(200);
      await http
        .post(`${API}/agent/tasks/${task.id}/mark-applied`)
        .set('Cookie', auth())
        .expect(200);

      const summary = await http.get(`${API}/agent/summary`).set('Cookie', auth()).expect(200);
      expect(summary.body).toMatchObject({ SUBMITTED: 1, NEEDS_REVIEW: 0 });
    });
  });

  describe('account', () => {
    it('requires the current password to delete the account', async () => {
      await http
        .delete(`${API}/users/me`)
        .set('Cookie', auth())
        .send({ password: 'wrong-password' })
        .expect(400);
      await http
        .delete(`${API}/users/me`)
        .set('Cookie', auth())
        .send({ password: user.password })
        .expect(204);
      await http.get(`${API}/auth/me`).set('Cookie', auth()).expect(401);
    });
  });
});
