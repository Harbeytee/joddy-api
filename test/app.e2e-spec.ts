import { spawnSync } from 'node:child_process';
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

  describe('request size', () => {
    const padding = 'x'.repeat(1.5 * 1024 * 1024);

    it('refuses bodies over 1 MB on ordinary routes', async () => {
      const res = await http
        .post(`${API}/auth/login`)
        .send({ ...credentials, padding })
        .expect(413);
      expect(res.body).toMatchObject({ statusCode: 413 });
    });

    it('allows bigger bodies for job imports and resumes', async () => {
      // Past the body parser, so these fail on auth or validation instead.
      await http
        .post(`${API}/jobs/ingest`)
        .set('x-ingest-key', INGEST_KEY)
        .send({ jobs: [], padding })
        .expect(400);
      await http.post(`${API}/resumes`).send({ padding }).expect(401);
      await http
        .post(`${API}/resumes`)
        .send({ padding: 'x'.repeat(6 * 1024 * 1024) })
        .expect(413);
    });
  });

  describe('auth', () => {
    it('rejects unauthenticated requests', async () => {
      await http.get(`${API}/auth/me`).expect(401);
      await http.get(`${API}/applications`).expect(401);
      await http.get(`${API}/agent/summary`).expect(401);
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
      expect(res.body.items[0].postedAt).toBe('2020-01-01T00:00:00.000Z');
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

    it('matches titles containing any of several phrases', async () => {
      const titles = async (query: string) => {
        const res = await http.get(`${API}/jobs?${query}`).set('Cookie', auth()).expect(200);
        return (res.body.items as { title: string }[]).map((j) => j.title).sort();
      };
      expect(await titles('title=front-end,frontend,qa')).toEqual([
        'Frontend Engineer',
        'Senior QA Engineer',
      ]);
      expect(await titles('title=backend%20engineer')).toEqual(['Backend Engineer']);
      expect(await titles('title=frontend&seniority=SENIOR')).toEqual([]);
      const facets = await http.get(`${API}/jobs/facets?title=engineer`).expect(200);
      expect(facets.body.total).toBe(3);
      await http.get(`${API}/jobs?title=${'x'.repeat(61)}`).expect(400);
    });

    it('needs an account for AI search, and turns it off when no Gemini key is set', async () => {
      await http.get(`${API}/ai/status`).expect(200, { enabled: false });
      const prompt = { prompt: 'remote frontend jobs in Europe' };
      await http.post(`${API}/jobs/ai-search`).send(prompt).expect(401);
      const res = await http
        .post(`${API}/jobs/ai-search`)
        .set('Cookie', auth())
        .send(prompt)
        .expect(503);
      expect(res.body.message).toMatch(/isn’t available/);
    });

    it('validates AI search prompts', async () => {
      const send = (body: object) =>
        http.post(`${API}/jobs/ai-search`).set('Cookie', auth()).send(body).expect(400);
      await send({ prompt: ' a ' });
      await send({ prompt: 'x'.repeat(501) });
      await send({ prompt: 'nurse jobs near me', homeCountry: 'ZZ' });
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

    it('lets guests browse jobs without anyone else’s personal data', async () => {
      await http.put(`${API}/jobs/${jobId}/save`).set('Cookie', auth()).expect(204);
      await http.put(`${API}/jobs/${jobId}/hide`).set('Cookie', auth()).expect(204);

      const list = await http.get(`${API}/jobs`).expect(200);
      const listed = (list.body.items as { id: string }[]).find((j) => j.id === jobId);
      expect(listed).toMatchObject({ match: null, isSaved: false, applicationStatus: null });

      const detail = await http.get(`${API}/jobs/${jobId}`).expect(200);
      expect(detail.body).toMatchObject({ match: null, isSaved: false, application: null });

      const facets = await http.get(`${API}/jobs/facets`).expect(200);
      expect(facets.body.total).toBe(list.body.total);
      await http.get(`${API}/jobs/locations`).expect(200);

      await http.get(`${API}/jobs/saved`).expect(401);
      await http.put(`${API}/jobs/${jobId}/save`).expect(401);
      await http.put(`${API}/jobs/${jobId}/hide`).expect(401);
      await http.post(`${API}/applications`).send({ jobId }).expect(401);

      await http.delete(`${API}/jobs/${jobId}/hide`).set('Cookie', auth()).expect(204);
      await http.delete(`${API}/jobs/${jobId}/save`).set('Cookie', auth()).expect(204);
    });

    it('rejects a bad token on guest-friendly routes so the client refreshes', async () => {
      await http.get(`${API}/jobs`).set('Cookie', 'joddy_at=not-a-real-token').expect(401);
      await http.get(`${API}/jobs/${jobId}`).set('Cookie', 'joddy_at=not-a-real-token').expect(401);
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
      // All of these list £60K–£75K a year.
      expect(await titles('country=NG&salaryMin=70000&salaryMax=80000')).toHaveLength(3);
      expect(await titles('country=NG&salaryMax=50000')).toEqual([]);
      expect(await titles('country=NG&salaryMin=80000')).toEqual([]);

      const facets = await http
        .get(`${API}/jobs/facets?country=NG&workplaceType=ONSITE`)
        .set('Cookie', auth())
        .expect(200);
      expect(facets.body.total).toBe(1);
      // The workplace counts ignore the workplace filter itself.
      expect(facets.body.workplaceType).toEqual({ REMOTE: 2, ONSITE: 1 });
      const byType = await http
        .get(`${API}/jobs/facets?country=NG&jobType=FULL_TIME`)
        .set('Cookie', auth())
        .expect(200);
      expect(byType.body.total).toBe(1);
      expect(byType.body.jobType).toEqual({ FULL_TIME: 1, PART_TIME: 1 });

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

  describe('resumes', () => {
    const content = {
      personal: { fullName: 'Test User', headline: 'Frontend Engineer' },
      summary: 'Builds fast interfaces.',
      experience: [{ position: 'Engineer', company: 'Monzo', current: true }],
      skills: ['Vue'],
      projects: [{ name: 'Design system', url: 'github.com/test/ds' }],
      certifications: [{ name: 'AWS Developer', issuer: 'Amazon', date: '2025' }],
      languages: [{ name: 'English', level: 'native' }],
      interests: ['Chess'],
    };

    it('stores the template, design and every section', async () => {
      const created = await http
        .post(`${API}/resumes`)
        .set('Cookie', auth())
        .send({
          title: 'Frontend',
          template: 'sidebar',
          design: {
            accent: '#0F766E',
            font: 'lora',
            spacing: 'compact',
            sectionOrder: ['skills', 'experience'],
          },
          content,
        })
        .expect(201);
      expect(created.body).toMatchObject({
        template: 'sidebar',
        isDefault: true,
        design: {
          accent: '#0F766E',
          font: 'lora',
          spacing: 'compact',
          sectionOrder: ['skills', 'experience'],
        },
        content: { ...content, education: [] },
      });

      const updated = await http
        .patch(`${API}/resumes/${created.body.id}`)
        .set('Cookie', auth())
        .send({ template: 'harvard', design: { fontSize: 'lg' } })
        .expect(200);
      expect(updated.body).toMatchObject({
        template: 'harvard',
        design: { fontSize: 'lg' },
        content,
      });

      const copy = await http
        .post(`${API}/resumes/${created.body.id}/duplicate`)
        .set('Cookie', auth())
        .expect(201);
      expect(copy.body).toMatchObject({
        title: 'Frontend (copy)',
        template: 'harvard',
        design: { fontSize: 'lg' },
      });

      for (const id of [created.body.id, copy.body.id]) {
        await http.delete(`${API}/resumes/${id}`).set('Cookie', auth()).expect(204);
      }
    });

    it('starts with an empty design', async () => {
      const created = await http
        .post(`${API}/resumes`)
        .set('Cookie', auth())
        .send({ title: 'Plain' })
        .expect(201);
      expect(created.body).toMatchObject({
        template: 'classic',
        design: {},
        content: { custom: [] },
      });
      await http.delete(`${API}/resumes/${created.body.id}`).set('Cookie', auth()).expect(204);
    });

    it('stores custom sections, their place in the order, and link text', async () => {
      const custom = [
        {
          id: 'volunteering',
          title: 'Volunteering',
          entries: [
            {
              title: 'Mentor',
              subtitle: 'Code First Girls',
              date: '2024 – Present',
              url: 'codefirstgirls.com',
              urlLabel: 'Website',
              description: 'Mentored 12 students',
            },
          ],
        },
        { id: 'k2x9', title: 'Awards', entries: [] },
      ];
      const created = await http
        .post(`${API}/resumes`)
        .set('Cookie', auth())
        .send({
          title: 'Custom',
          design: { sectionOrder: ['summary', 'custom:volunteering', 'experience'] },
          content: {
            projects: [{ name: 'Icons', url: 'github.com/test/icons', urlLabel: 'GitHub' }],
            custom,
          },
        })
        .expect(201);
      expect(created.body).toMatchObject({
        design: { sectionOrder: ['summary', 'custom:volunteering', 'experience'] },
        content: { projects: [{ urlLabel: 'GitHub' }], custom },
      });
      await http.delete(`${API}/resumes/${created.body.id}`).set('Cookie', auth()).expect(204);
    });

    it.each([
      ['an unknown template', { template: 'fancy' }],
      ['a colour that is not hex', { design: { accent: 'red' } }],
      ['an unknown font', { design: { font: 'comic-sans' } }],
      ['a repeated section', { design: { sectionOrder: ['skills', 'skills'] } }],
      ['an unknown section', { design: { sectionOrder: ['hobbies'] } }],
      ['an unknown language level', { content: { languages: [{ name: 'French', level: 'pro' }] } }],
      ['a project without a name', { content: { projects: [{ url: 'x.com' }] } }],
      [
        'link text over 60 characters',
        { content: { projects: [{ name: 'X', urlLabel: 'x'.repeat(61) }] } },
      ],
      [
        'a custom section without an id',
        { content: { custom: [{ title: 'Awards', entries: [] }] } },
      ],
      [
        'a custom section id with spaces',
        { content: { custom: [{ id: 'my awards', entries: [] }] } },
      ],
      [
        'two custom sections with the same id',
        {
          content: {
            custom: [
              { id: 'a', entries: [] },
              { id: 'a', entries: [] },
            ],
          },
        },
      ],
      [
        'more than 10 custom sections',
        {
          content: { custom: Array.from({ length: 11 }, (_, i) => ({ id: `s${i}`, entries: [] })) },
        },
      ],
      ['an empty custom section key', { design: { sectionOrder: ['custom:'] } }],
    ])('rejects %s', async (_, body) => {
      await http
        .post(`${API}/resumes`)
        .set('Cookie', auth())
        .send({ title: 'Bad', ...body })
        .expect(400);
    });

    describe('AI suggestions', () => {
      const text = 'built the checkout\nmade pages faster';

      it('needs a signed-in user', async () => {
        await http.post(`${API}/resumes/ai/refine`).send({ field: 'highlights', text }).expect(401);
      });

      it('is off when no Gemini key is set', async () => {
        const res = await http
          .post(`${API}/resumes/ai/refine`)
          .set('Cookie', auth())
          .send({ field: 'highlights', text, context: { position: 'Engineer' } })
          .expect(503);
        expect(res.body.message).toMatch(/aren’t available/);
      });

      it.each([
        ['an unknown field', { field: 'title', text }],
        ['text that is too short', { field: 'summary', text: '  short  ' }],
        ['text that is too long', { field: 'highlights', text: 'x'.repeat(5001) }],
        ['a tiny length limit', { field: 'summary', text, maxLength: 50 }],
        [
          'context that is too long',
          { field: 'summary', text, context: { position: 'x'.repeat(151) } },
        ],
      ])('rejects %s', async (_, body) => {
        await http.post(`${API}/resumes/ai/refine`).set('Cookie', auth()).send(body).expect(400);
      });
    });
  });

  describe('dashboard', () => {
    const inNewYork = (iso: string) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        weekday: 'short',
        hour: '2-digit',
        hourCycle: 'h23',
      }).format(new Date(iso));

    it("groups weekly activity by the viewer's own weeks", async () => {
      const ny = await http
        .get(`${API}/dashboard`)
        .query({ tz: 'America/New_York' })
        .set('Cookie', auth())
        .expect(200);
      const weeks = ny.body.weekly as { weekStart: string; count: number }[];
      expect(weeks).toHaveLength(8);
      expect(weeks.every((w) => inNewYork(w.weekStart) === 'Mon, 00')).toBe(true);

      // Sunday 22:00 in New York is already Monday in UTC.
      const sundayNight = new Date(new Date(weeks[7].weekStart).getTime() - 2 * 3_600_000);
      const created = await http
        .post(`${API}/applications`)
        .set('Cookie', auth())
        .send({ role: 'Designer', company: 'Late Night Co', appliedAt: sundayNight.toISOString() })
        .expect(201);

      const after = await http
        .get(`${API}/dashboard`)
        .query({ tz: 'America/New_York' })
        .set('Cookie', auth())
        .expect(200);
      expect(after.body.weekly[6].count).toBe(weeks[6].count + 1);
      expect(after.body.weekly[7].count).toBe(weeks[7].count);

      await http.delete(`${API}/applications/${created.body.id}`).set('Cookie', auth()).expect(204);
    });

    it('rejects an unknown time zone', async () => {
      await http
        .get(`${API}/dashboard`)
        .query({ tz: 'Mars/Olympus' })
        .set('Cookie', auth())
        .expect(400);
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

    it('searches on its own every interval for users who have it on', async () => {
      const searchDue = () => {
        const run = spawnSync(process.execPath, ['test/support/match-worker.cjs'], {
          env: { ...process.env, ...TEST_ENV },
          encoding: 'utf8',
          timeout: 60_000,
        });
        expect(run.stderr).toBe('');
        expect(run.status).toBe(0);
      };
      const lastRunAt = async () =>
        (await http.get(`${API}/agent/settings`).set('Cookie', auth()).expect(200)).body
          .lastRunAt as string;
      const backdate = () =>
        db.query(
          `UPDATE agent_settings SET "lastRunAt" = (now() AT TIME ZONE 'utc') - interval '2 hours'
           WHERE "userId" = (SELECT id FROM users WHERE email = $1)`,
          [user.email],
        );
      const toChoose = async () => {
        const res = await http
          .get(`${API}/agent/tasks`)
          .query({ status: 'NEEDS_REVIEW' })
          .set('Cookie', auth())
          .expect(200);
        return (res.body.items as { job: { title: string } }[]).map((t) => t.job.title);
      };

      await http
        .post(`${API}/jobs/ingest`)
        .set('x-ingest-key', INGEST_KEY)
        .send({ jobs: [sampleJob('scheduled', { title: 'Vue Engineer Scheduled' })] })
        .expect(200);

      // "Find jobs now" in the last test counts as this interval's search.
      searchDue();
      expect(await toChoose()).toEqual([]);

      await backdate();
      searchDue();
      expect(await toChoose()).toEqual(['Vue Engineer Scheduled']);
      expect(Date.now() - new Date(await lastRunAt()).getTime()).toBeLessThan(60_000);

      await http
        .put(`${API}/agent/settings`)
        .set('Cookie', auth())
        .send({ enabled: false })
        .expect(200);
      await backdate();
      const before = await lastRunAt();
      searchDue();
      expect(await lastRunAt()).toBe(before);
    });
  });

  describe('auto-apply', () => {
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
    const drainWorker = () => {
      const run = spawnSync(process.execPath, ['test/support/drain-worker.cjs'], {
        env: { ...process.env, ...TEST_ENV, AUTO_APPLY_SUBMIT: 'true' },
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(run.error).toBeUndefined();
      expect(run.stderr).toBe('');
      expect(run.status).toBe(0);
    };
    const tasksIn = async (status: string) =>
      (
        await http
          .get(`${API}/agent/tasks`)
          .query({ status, pageSize: 50 })
          .set('Cookie', auth())
          .expect(200)
      ).body.items as Array<{
        id: string;
        status: string;
        error: string | null;
        missing: unknown[];
        submittedByAgent: boolean;
        job: { title: string };
      }>;
    const byTitle = (tasks: Awaited<ReturnType<typeof tasksIn>>, title: string) =>
      tasks.find((t) => t.job.title === title)!;

    it('starts the profile from the account and lists what is missing', async () => {
      const res = await http.get(`${API}/agent/profile`).set('Cookie', auth()).expect(200);
      expect(res.body).toMatchObject({
        firstName: 'Test',
        lastName: 'User',
        email: user.email,
        ready: false,
        cv: null,
      });
      expect(res.body.missing).toEqual(['phone', 'cv', 'consent']);
    });

    it('validates profile details', async () => {
      await http
        .put(`${API}/agent/profile`)
        .set('Cookie', auth())
        .send({ phone: 'call me' })
        .expect(400);
      await http
        .put(`${API}/agent/profile`)
        .set('Cookie', auth())
        .send({ linkedinUrl: 'linkedin.com/in/me' })
        .expect(400);
      await http
        .put(`${API}/agent/profile`)
        .set('Cookie', auth())
        .send({ answers: { 'Why us?': 42 } })
        .expect(400);
    });

    it('saves details and consent', async () => {
      const res = await http
        .put(`${API}/agent/profile`)
        .set('Cookie', auth())
        .send({
          phone: '+44 7700 900123',
          city: 'London',
          country: 'United Kingdom',
          workCountries: ['United Kingdom', ' United Kingdom '],
          linkedinUrl: '',
          consent: true,
        })
        .expect(200);
      expect(res.body).toMatchObject({
        phone: '+44 7700 900123',
        workCountries: ['United Kingdom'],
        linkedinUrl: null,
        missing: ['cv'],
      });
      expect(res.body.consentAt).toEqual(expect.any(String));
    });

    it('accepts PDF and Word CVs only', async () => {
      await http
        .put(`${API}/agent/profile/cv`)
        .set('Cookie', auth())
        .attach('file', Buffer.from('hello'), { filename: 'cv.txt', contentType: 'text/plain' })
        .expect(400);
      await http.put(`${API}/agent/profile/cv`).set('Cookie', auth()).expect(400);

      const res = await http
        .put(`${API}/agent/profile/cv`)
        .set('Cookie', auth())
        .attach('file', pdf, { filename: 'Test User CV.pdf', contentType: 'application/pdf' })
        .expect(200);
      expect(res.body).toMatchObject({
        ready: true,
        missing: [],
        cv: { fileName: 'Test User CV.pdf', mimeType: 'application/pdf', size: pdf.length },
      });

      const file = await http
        .get(`${API}/agent/profile/cv`)
        .set('Cookie', auth())
        .buffer(true)
        .parse((r, done) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => done(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(file.headers['content-type']).toBe('application/pdf');
      expect(Buffer.compare(file.body as Buffer, pdf)).toBe(0);
    });

    it('applies to every match in AUTO mode and hands back what it cannot finish', async () => {
      await http
        .put(`${API}/agent/settings`)
        .set('Cookie', auth())
        .send({ enabled: true, mode: 'AUTO', keywords: ['engineer'], dailyLimit: 50 })
        .expect(200);
      await http
        .post(`${API}/jobs/ingest`)
        .set('x-ingest-key', INGEST_KEY)
        .send({
          jobs: [
            sampleJob('submit-1', { title: 'Vue Engineer Submit' }),
            sampleJob('question-1', { title: 'Vue Engineer Question' }),
            sampleJob('captcha-1', { title: 'Vue Engineer Captcha' }),
            sampleJob('crash-1', { title: 'Vue Engineer Crash' }),
            {
              ...sampleJob('elsewhere-1', { title: 'Vue Engineer Elsewhere' }),
              id: 'workable:acme:elsewhere-1',
              source: 'workable',
              url: 'https://apply.workable.com/acme/j/1',
              applyUrl: 'https://apply.workable.com/acme/j/1',
            },
          ],
        })
        .expect(200);
      const run = await http.post(`${API}/agent/run`).set('Cookie', auth()).expect(200);
      expect(run.body.queued).toBe(5);

      const queued = await tasksIn('QUEUED');
      expect(queued.map((t) => t.job.title).sort()).toEqual([
        'Vue Engineer Captcha',
        'Vue Engineer Crash',
        'Vue Engineer Question',
        'Vue Engineer Submit',
      ]);
      const unsupported = byTitle(await tasksIn('FAILED'), 'Vue Engineer Elsewhere');
      expect(unsupported.error).toBe('unsupported-site');

      drainWorker();

      const submitted = byTitle(await tasksIn('SUBMITTED'), 'Vue Engineer Submit');
      expect(submitted.submittedByAgent).toBe(true);
      const apps = await http
        .get(`${API}/applications`)
        .query({ pageSize: 50 })
        .set('Cookie', auth())
        .expect(200);
      expect(apps.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ role: 'Vue Engineer Submit', appliedVia: 'AGENT' }),
        ]),
      );

      const needsYou = await tasksIn('FAILED');
      expect(byTitle(needsYou, 'Vue Engineer Captcha').error).toBe('captcha');
      expect(byTitle(needsYou, 'Vue Engineer Crash').error).toBe('error');
      const question = byTitle(needsYou, 'Vue Engineer Question');
      expect(question).toMatchObject({
        error: 'missing-answers',
        missing: [
          {
            label: 'Are you open to relocation?',
            kind: 'select',
            required: true,
            options: ['Yes', 'No'],
          },
        ],
      });
    });

    it('lets the user answer the questions Joddy got stuck on, then tries again', async () => {
      const question = byTitle(await tasksIn('FAILED'), 'Vue Engineer Question');
      const res = await http
        .post(`${API}/agent/tasks/${question.id}/answers`)
        .set('Cookie', auth())
        .send({ answers: { 'Are you open to relocation?*': 'No' } })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'QUEUED', error: null, missing: [] });

      const profile = await http.get(`${API}/agent/profile`).set('Cookie', auth()).expect(200);
      expect(profile.body.answers).toEqual({ 'are you open to relocation': 'No' });

      drainWorker();
      const submitted = await tasksIn('SUBMITTED');
      expect(byTitle(submitted, 'Vue Engineer Question').submittedByAgent).toBe(true);
    });

    it('only retries jobs on sites Joddy can fill in', async () => {
      const failed = await tasksIn('FAILED');
      await http
        .post(`${API}/agent/tasks/${byTitle(failed, 'Vue Engineer Elsewhere').id}/retry`)
        .set('Cookie', auth())
        .expect(400);
      const retried = await http
        .post(`${API}/agent/tasks/${byTitle(failed, 'Vue Engineer Captcha').id}/retry`)
        .set('Cookie', auth())
        .expect(200);
      expect(retried.body.status).toBe('QUEUED');
    });

    it('leaves the queue alone once the user withdraws consent', async () => {
      await http
        .put(`${API}/agent/profile`)
        .set('Cookie', auth())
        .send({ consent: false })
        .expect(200);
      drainWorker();
      expect(byTitle(await tasksIn('QUEUED'), 'Vue Engineer Captcha').status).toBe('QUEUED');
    });

    it('waits for the user to pick jobs in REVIEW mode', async () => {
      await http
        .put(`${API}/agent/settings`)
        .set('Cookie', auth())
        .send({ mode: 'REVIEW' })
        .expect(200);
      await http
        .post(`${API}/jobs/ingest`)
        .set('x-ingest-key', INGEST_KEY)
        .send({
          jobs: [
            sampleJob('pick-1', { title: 'Vue Engineer Pick' }),
            {
              ...sampleJob('pick-2', { title: 'Vue Engineer Pick Elsewhere' }),
              id: 'workable:acme:pick-2',
              source: 'workable',
            },
          ],
        })
        .expect(200);
      await http.post(`${API}/agent/run`).set('Cookie', auth()).expect(200);

      const toChoose = await tasksIn('NEEDS_REVIEW');
      const picked = await http
        .post(`${API}/agent/tasks/${byTitle(toChoose, 'Vue Engineer Pick').id}/approve`)
        .set('Cookie', auth())
        .expect(200);
      expect(picked.body.status).toBe('QUEUED');
      const elsewhere = await http
        .post(`${API}/agent/tasks/${byTitle(toChoose, 'Vue Engineer Pick Elsewhere').id}/approve`)
        .set('Cookie', auth())
        .expect(200);
      expect(elsewhere.body).toMatchObject({ status: 'FAILED', error: 'unsupported-site' });
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
